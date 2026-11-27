// Second faux PSP, « signal » : une notification sans montant ni statut, qui oblige à relire (`getStatus`).
// Construit par les tests seulement (aucune fabrique ne le crée). Jamais un modèle de sécurité.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { PspAdapter, PspVerification, VerifyNotificationInput } from '../psp-adapter.port';
import { PspProviderError } from '../psp-errors';
import type { PspSecrets } from '../psp-secret-store.port';
import type {
  PspInitiateRequest,
  PspInitiateResult,
  PspProviderName,
  PspStatement,
  PspStatusQuery,
  PspStatusResult,
} from '../psp.types';

export const SIGNAL_HEADER_NAME = 'x-fake-signal';

/** Valeur de l'en-tête : sha512 hexadécimal de la clé de notification courante. */
export function fakeSignalHeaderValue(currentKey: string): string {
  return createHash('sha512').update(currentKey, 'utf8').digest('hex');
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

export class FakeSignalPspAdapter implements PspAdapter {
  readonly isFake = true;
  private readonly statuses = new Map<string, PspStatusResult>();

  constructor(readonly provider: PspProviderName = 'PAYDUNYA') {}

  /** État rendu par `getStatus` pour une référence marchande. */
  setStatus(merchantReference: string, status: PspStatusResult): void {
    this.statuses.set(merchantReference, status);
  }

  initiate(_request: PspInitiateRequest, _secrets: PspSecrets): Promise<PspInitiateResult> {
    return Promise.reject(
      new PspProviderError('REJECTED', 'faux signal : initiate non pris en charge'),
    );
  }

  verifyNotification(input: VerifyNotificationInput): PspVerification {
    let header: string | undefined;
    for (const [name, value] of Object.entries(input.headers)) {
      if (name.toLowerCase() !== SIGNAL_HEADER_NAME) continue;
      header = Array.isArray(value) ? value[0] : value;
      break;
    }
    if (header === undefined || header.trim() === '')
      return { ok: false, reason: 'SIGNATURE_MISSING' };
    if (!/^[0-9a-f]{128}$/i.test(header.trim()))
      return { ok: false, reason: 'SIGNATURE_MALFORMED' };
    const expected = Buffer.from(
      fakeSignalHeaderValue(input.secrets.notification.current.reveal()),
      'hex',
    );
    const received = Buffer.from(header.trim(), 'hex');
    if (!timingSafeEqual(expected, received)) return { ok: false, reason: 'SIGNATURE_INVALID' };
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      return { ok: false, reason: 'BODY_MALFORMED' };
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      return { ok: false, reason: 'BODY_MALFORMED' };
    const { id, merchantReference, paymentId } = body as Record<string, unknown>;
    if (!nonEmpty(id) || !nonEmpty(paymentId)) return { ok: false, reason: 'BODY_MALFORMED' };
    if (
      merchantReference !== undefined &&
      merchantReference !== null &&
      !nonEmpty(merchantReference)
    )
      return { ok: false, reason: 'BODY_MALFORMED' };
    return {
      ok: true,
      kind: 'SIGNAL',
      notificationId: id,
      reference: { merchantReference: merchantReference ?? null, providerPaymentRef: paymentId },
      secretUsed: 'current',
    };
  }

  getStatus(query: PspStatusQuery, _secrets: PspSecrets): Promise<PspStatusResult> {
    return Promise.resolve(
      this.statuses.get(query.merchantReference) ?? { state: 'UNKNOWN', payment: null },
    );
  }

  cancel(_query: PspStatusQuery, _secrets: PspSecrets): Promise<{ cancelled: boolean }> {
    return Promise.resolve({ cancelled: false });
  }

  readStatement(_period: { from: Date; to: Date }, _secrets: PspSecrets): Promise<PspStatement> {
    return Promise.resolve({ supported: false });
  }
}
