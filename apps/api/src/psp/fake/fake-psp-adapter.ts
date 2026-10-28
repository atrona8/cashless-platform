// Faux PSP (un par fournisseur), hors production seulement : jamais un modèle de sécurité. Importé par le seul
// `psp.providers.ts` (borne OP-N81). Domaine factice en `.invalid`, aucun secret par défaut.
import { randomBytes } from 'node:crypto';
import { verifyHmacSignature } from '../hmac-signature';
import type { PspAdapter, PspVerification, VerifyNotificationInput } from '../psp-adapter.port';
import { PspProviderError } from '../psp-errors';
import type { PspSecrets } from '../psp-secret-store.port';
import {
  PROVIDER_METHOD,
  type NormalizedCard,
  type NormalizedNotification,
  type NormalizedPayment,
  type PspInitiateRequest,
  type PspInitiateResult,
  type PspProviderName,
  type PspStatementLine,
  type PspStatusQuery,
  type PspStatusResult,
} from '../psp.types';

export function signatureHeaderName(provider: PspProviderName): string {
  return provider === 'WAVE' ? 'wave-signature' : 'x-webhook-signature';
}

const EVENT_KINDS: Record<string, NormalizedNotification['kind']> = {
  'payment.succeeded': 'PAYMENT_SUCCEEDED',
  'payment.failed': 'PAYMENT_FAILED',
  'payment.cancelled': 'PAYMENT_CANCELLED',
  'dispute.created': 'DISPUTE',
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Entier strictement positif et sûr, sinon null (montant négatif, nul, décimal, hors plage). */
function amountOf(value: unknown): bigint | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? BigInt(value)
    : null;
}

/** Carte normalisée : empreinte absente -> null ; 3-D Secure absent ou inconnu -> NOT_PERFORMED. */
export function normalizeCard(raw: unknown): NormalizedCard | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) return null;
  const threeDs = raw.three_ds ?? raw.threeDs;
  return {
    fingerprint: nonEmpty(raw.fingerprint) ? raw.fingerprint : null,
    threeDs: threeDs === 'SUCCEEDED' || threeDs === 'FAILED' ? threeDs : 'NOT_PERFORMED',
  };
}

export interface FakeCardInput {
  fingerprint?: string | null;
  threeDs?: string | null;
}

export class FakePspAdapter implements PspAdapter {
  readonly isFake = true;
  private readonly expiresInSeconds: number;
  private readonly payments = new Map<
    string,
    { payment: NormalizedPayment; state: PspStatusResult['state'] }
  >();
  private readonly requests: Omit<PspInitiateRequest, never>[] = [];
  private nextFailure: 'UNAVAILABLE' | 'REJECTED' | null = null;
  private cancelAccepted = true;

  constructor(
    readonly provider: PspProviderName,
    options: { expiresInSeconds?: number } = {},
  ) {
    this.expiresInSeconds = options.expiresInSeconds ?? 900;
  }

  /** Demandes reçues, en lecture seule, sans secret. */
  get initiated(): readonly Readonly<PspInitiateRequest>[] {
    return [...this.requests];
  }

  setStatus(
    merchantReference: string,
    state: PspStatusResult['state'],
    options: { card?: FakeCardInput } = {},
  ): void {
    const entry = this.payments.get(merchantReference);
    if (entry === undefined) throw new Error('paiement inconnu du faux');
    entry.state = state;
    if (options.card !== undefined) entry.payment.card = normalizeCard(options.card);
  }

  failNextInitiate(kind: 'UNAVAILABLE' | 'REJECTED'): void {
    this.nextFailure = kind;
  }

  acceptCancel(accepted: boolean): void {
    this.cancelAccepted = accepted;
  }

  reset(): void {
    this.payments.clear();
    this.requests.length = 0;
    this.nextFailure = null;
    this.cancelAccepted = true;
  }

  initiate(request: PspInitiateRequest, _secrets: PspSecrets): Promise<PspInitiateResult> {
    if (this.nextFailure !== null) {
      const kind = this.nextFailure;
      this.nextFailure = null;
      return Promise.reject(new PspProviderError(kind, 'faux PSP : échec demandé'));
    }
    if (PROVIDER_METHOD[this.provider] !== request.method)
      return Promise.reject(new PspProviderError('REJECTED', 'moyen non pris en charge'));
    this.requests.push({ ...request });
    const providerPaymentRef = `fake_${randomBytes(8).toString('hex')}`;
    this.payments.set(request.pspTopupId, {
      state: 'PENDING',
      payment: {
        merchantReference: request.pspTopupId,
        providerPaymentRef,
        amount: request.amount,
        currency: request.currency,
        card: null,
      },
    });
    return Promise.resolve({
      providerPaymentRef,
      action: {
        kind: 'REDIRECT',
        url: `https://fake-psp.invalid/${this.provider.toLowerCase()}/${providerPaymentRef}`,
      },
      expiresAt: new Date(Date.now() + this.expiresInSeconds * 1000),
    });
  }

  /**
   * Ordre (1) à (5) du port. En-tête répété : le premier est pris, les autres sont ignorés.
   * Montant nul ou négatif (paiement ou contestation) : BODY_MALFORMED (le contrat ne dit pas
   * qu'un zéro est admis pour une contestation : refus, signalé dans le compte rendu du lot).
   */
  verifyNotification(input: VerifyNotificationInput): PspVerification {
    const wanted = signatureHeaderName(this.provider);
    let header: string | undefined;
    for (const [name, value] of Object.entries(input.headers)) {
      if (name.toLowerCase() !== wanted) continue;
      header = Array.isArray(value) ? value[0] : value;
      break;
    }
    const verified = verifyHmacSignature({
      header,
      rawBody: input.rawBody,
      secrets: input.secrets,
      now: input.now,
    });
    if (!verified.ok) return verified;
    const notification = this.parseBody(input.rawBody);
    if (notification === null) return { ok: false, reason: 'BODY_MALFORMED' };
    return {
      ok: true,
      notification,
      signedAt: verified.signedAt,
      secretUsed: verified.secretUsed,
    };
  }

  private parseBody(rawBody: Buffer): NormalizedNotification | null {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    if (!isObject(body)) return null;
    const amount = amountOf(body.amount);
    if (
      !nonEmpty(body.id) ||
      !nonEmpty(body.type) ||
      !nonEmpty(body.payment_id) ||
      !nonEmpty(body.currency) ||
      amount === null
    )
      return null;
    if (
      body.merchant_reference !== undefined &&
      body.merchant_reference !== null &&
      !nonEmpty(body.merchant_reference)
    )
      return null;
    const kind = EVENT_KINDS[body.type] ?? 'UNKNOWN';
    let dispute: NormalizedNotification['dispute'] = null;
    if (kind === 'DISPUTE') {
      const raw = body.dispute;
      const disputeAmount = isObject(raw) ? amountOf(raw.amount) : null;
      if (!isObject(raw) || !nonEmpty(raw.id) || disputeAmount === null) return null;
      dispute = { providerDisputeId: raw.id, amount: disputeAmount };
    }
    return {
      notificationId: body.id,
      kind,
      payment: {
        merchantReference: body.merchant_reference ?? null,
        providerPaymentRef: body.payment_id,
        amount,
        currency: body.currency,
        card: normalizeCard(body.card),
      },
      dispute,
    };
  }

  getStatus(query: PspStatusQuery, _secrets: PspSecrets): Promise<PspStatusResult> {
    const entry = this.payments.get(query.merchantReference);
    if (entry === undefined) return Promise.resolve({ state: 'UNKNOWN', payment: null });
    return Promise.resolve({
      state: entry.state,
      payment: { ...entry.payment, card: entry.payment.card && { ...entry.payment.card } },
    });
  }

  cancel(query: PspStatusQuery, _secrets: PspSecrets): Promise<{ cancelled: boolean }> {
    const entry = this.payments.get(query.merchantReference);
    const cancelled = this.cancelAccepted && entry?.state === 'PENDING';
    if (cancelled && entry) entry.state = 'CANCELLED';
    return Promise.resolve({ cancelled });
  }

  readStatement(
    _period: { from: Date; to: Date },
    _secrets: PspSecrets,
  ): Promise<PspStatementLine[]> {
    return Promise.resolve([]);
  }
}
