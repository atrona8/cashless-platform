// Adaptateur PayDunya (mission 12b-1, WP06), d'après le code des SDK officiels (research.md R-05) :
// paydunya-node-master (`lib/checkout-invoice.js`) et paydunya-woocommerce-gateway (`callback_handler`).
//
// Écart de sécurité décidé par le porteur (D2) : la preuve d'origine d'une notification (IPN) est une valeur fixe,
// `data[hash] = sha512_hex(clé maître)`. Qui la connaît forge une notification. La notification n'est donc qu'un
// SIGNAL : aucun montant, aucune devise, aucune carte n'en est lu ; le crédit ne vient que de `getStatus`
// (`checkout-invoice/confirm/{token}`, appel authentifié par les trois clés). Borne OP PayDunya : un signal forgé ne
// déclenche qu'une relecture. Carte (D7) : la confirmation ne porte ni preuve 3-D Secure ni empreinte, donc
// `threeDs: 'NOT_PERFORMED'` et la recharge est reçue, non créditée.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../config/config';
import type { PspAdapter, PspVerification, VerifyNotificationInput } from '../psp-adapter.port';
import { PspProviderError } from '../psp-errors';
import type { PspSecrets } from '../psp-secret-store.port';
import type {
  NormalizedPayment,
  PspInitiateRequest,
  PspInitiateResult,
  PspStatement,
  PspStatusQuery,
  PspStatusResult,
} from '../psp.types';
import { PspHttpClient, PspHttpError } from '../http/psp-http';

/** Aucune échéance de facture n'est documentée : 30 minutes. À confirmer à l'essai. */
export const PAYDUNYA_INVOICE_TTL_MS = 30 * 60 * 1000;
/** Devise de la configuration : la confirmation n'en rend pas. À confirmer à l'essai. */
const CURRENCY = 'XOF';
/** Statuts connus : `completed` et `pending` des SDK ; `cancelled` et `failed` à confirmer à l'essai. */
const STATUS_MAP: Readonly<Record<string, PspStatusResult['state']>> = {
  completed: 'PAID',
  pending: 'PENDING',
  cancelled: 'CANCELLED',
  failed: 'FAILED',
};
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_RE = /^[0-9a-fA-F]{128}$/;
const STATUS_RE = /^[a-z_]{1,32}$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

function decodeForm(part: string): string | null {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** Valeur brute (non décodée) de chaque entrée dont la clé décodée est `name`. Ne lit aucune autre valeur. */
function rawFormValues(rawBody: string, name: string): string[] {
  const values: string[] = [];
  for (const pair of rawBody.split('&')) {
    const eq = pair.indexOf('=');
    const key = decodeForm(eq < 0 ? pair : pair.slice(0, eq));
    if (key === name) values.push(eq < 0 ? '' : pair.slice(eq + 1));
  }
  return values;
}

export class PayDunyaPspAdapter implements PspAdapter {
  readonly provider = 'PAYDUNYA' as const;
  readonly isFake = false;
  readonly service = 'psp.paydunya' as const;

  constructor(
    private readonly http: PspHttpClient,
    private readonly config: Pick<AppConfig, 'pspBases'>,
  ) {}

  private headers(secrets: PspSecrets): Record<string, string> {
    const credentials = secrets.credentials;
    if (credentials.provider !== 'PAYDUNYA')
      throw new PspProviderError('REJECTED', 'PayDunya : identifiants d’un autre fournisseur');
    return {
      'PAYDUNYA-MASTER-KEY': credentials.masterKey.reveal(),
      'PAYDUNYA-PRIVATE-KEY': credentials.privateKey.reveal(),
      'PAYDUNYA-TOKEN': credentials.token.reveal(),
      'Content-Type': 'application/json',
    };
  }

  private url(path: string): string {
    return `${this.config.pspBases.paydunya.replace(/\/+$/, '')}/${path}`;
  }

  /** Corps JSON d'une réponse ; échec de transport ou corps illisible : le fournisseur est indisponible. */
  private async call(
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    secrets: PspSecrets,
    body: string | undefined,
    idempotent: boolean,
  ): Promise<Json> {
    const headers = this.headers(secrets);
    let status: number;
    let raw: Buffer;
    try {
      const response = await this.http.send({
        provider: 'PAYDUNYA',
        operation,
        method,
        url: this.url(path),
        headers,
        body,
        idempotent,
      });
      status = response.status;
      raw = response.body;
    } catch (error) {
      if (error instanceof PspHttpError)
        throw new PspProviderError('UNAVAILABLE', `PayDunya ${operation} : ${error.kind}`);
      throw error;
    }
    if (status >= 500)
      throw new PspProviderError('UNAVAILABLE', `PayDunya ${operation} : HTTP ${status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      parsed = null;
    }
    if (!isObject(parsed))
      throw new PspProviderError(
        status >= 500 ? 'UNAVAILABLE' : 'REJECTED',
        `PayDunya ${operation} : réponse inexploitable (HTTP ${status})`,
      );
    return parsed;
  }

  async initiate(request: PspInitiateRequest, secrets: PspSecrets): Promise<PspInitiateResult> {
    if (request.currency !== CURRENCY)
      throw new PspProviderError('REJECTED', 'PayDunya : seule la devise XOF est servie');
    if (request.amount <= 0n || request.amount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new PspProviderError('REJECTED', 'PayDunya : montant hors bornes');
    const body = JSON.stringify({
      invoice: { total_amount: Number(request.amount), description: 'Recharge' },
      store: { name: 'Cashless' },
      actions: {
        callback_url: request.notificationUrl,
        ...(request.returnUrl === null
          ? {}
          : { return_url: request.returnUrl, cancel_url: request.returnUrl }),
      },
      custom_data: { psp_topup_id: request.pspTopupId },
    });
    // Création non idempotente : aucun nouvel essai ; sur délai, la recharge expirera (le token n'est pas connu).
    const json = await this.call(
      'checkout-invoice/create',
      'POST',
      'checkout-invoice/create',
      secrets,
      body,
      false,
    );
    if (json.response_code !== '00')
      throw new PspProviderError(
        'REJECTED',
        `PayDunya création refusée (response_code ${
          typeof json.response_code === 'string' && /^[0-9A-Za-z]{1,8}$/.test(json.response_code)
            ? json.response_code
            : 'inconnu'
        })`,
      );
    const token = json.token;
    const url = json.response_text;
    if (!nonEmpty(token) || !TOKEN_RE.test(token) || !nonEmpty(url))
      throw new PspProviderError('REJECTED', 'PayDunya création : réponse incomplète');
    return {
      providerPaymentRef: token,
      action: { kind: 'REDIRECT', url },
      expiresAt: new Date(Date.now() + PAYDUNYA_INVOICE_TTL_MS),
    };
  }

  /** Notification = signal (D2). Seul `data[hash]` est lu avant la comparaison. */
  verifyNotification(input: VerifyNotificationInput): PspVerification {
    if (input.contentType !== 'form') return { ok: false, reason: 'BODY_MALFORMED' };
    const raw = input.rawBody.toString('utf8');
    const hashes = rawFormValues(raw, 'data[hash]');
    if (hashes.length === 0) return { ok: false, reason: 'SIGNATURE_MISSING' };
    const received = hashes.length === 1 ? decodeForm(hashes[0]!) : null;
    if (received === null || !HASH_RE.test(received))
      return { ok: false, reason: 'SIGNATURE_MALFORMED' };
    // La clé maître est rangée comme secret de notification (data-model.md). `previous` n'est jamais utilisé.
    const expected = createHash('sha512')
      .update(input.secrets.notification.current.reveal(), 'utf8')
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(received, 'hex')))
      return { ok: false, reason: 'SIGNATURE_INVALID' };

    // Preuve établie : seulement maintenant, les autres champs.
    const form = new URLSearchParams(raw);
    const token = form.get('data[invoice][token]');
    const status = form.get('data[status]');
    if (token === null || !TOKEN_RE.test(token) || status === null || !STATUS_RE.test(status))
      return { ok: false, reason: 'BODY_MALFORMED' };
    const merchant = form.get('data[custom_data][psp_topup_id]');
    return {
      ok: true,
      kind: 'SIGNAL',
      notificationId: `paydunya:${token}:${status}`,
      reference: {
        merchantReference: merchant !== null && merchant !== '' ? merchant : null,
        providerPaymentRef: token,
      },
      secretUsed: 'current',
    };
  }

  /** Confirmation authentifiée : seule source d'un crédit. */
  async getStatus(query: PspStatusQuery, secrets: PspSecrets): Promise<PspStatusResult> {
    const token = query.providerPaymentRef;
    if (token === null || !TOKEN_RE.test(token)) return { state: 'UNKNOWN', payment: null };
    const path = `checkout-invoice/confirm/${token}`;
    const json = await this.call('checkout-invoice/confirm', 'GET', path, secrets, undefined, true);
    if (json.response_code !== '00') return { state: 'UNKNOWN', payment: null };
    const state =
      typeof json.status === 'string' ? (STATUS_MAP[json.status] ?? 'UNKNOWN') : 'UNKNOWN';
    if (state === 'UNKNOWN') return { state, payment: null };
    const invoice = isObject(json.invoice) ? json.invoice : null;
    const raw = invoice?.total_amount;
    const amountOk =
      (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) ||
      (typeof raw === 'string' && /^[1-9][0-9]{0,15}$/.test(raw));
    // Un statut sans montant entier exigé n'est jamais payé.
    if (!amountOk) return { state: 'UNKNOWN', payment: null };
    const custom = isObject(json.custom_data) ? json.custom_data : null;
    const merchant = custom?.psp_topup_id;
    const payment: NormalizedPayment = {
      merchantReference: nonEmpty(merchant) ? merchant : null,
      providerPaymentRef: token,
      amount: BigInt(raw as number | string),
      currency: CURRENCY,
      // D7 : la confirmation ne porte ni preuve 3-D Secure ni empreinte.
      card: { fingerprint: null, threeDs: 'NOT_PERFORMED' },
    };
    return { state, payment };
  }

  /** Aucune annulation documentée par PayDunya. */
  cancel(_query: PspStatusQuery, _secrets: PspSecrets): Promise<{ cancelled: boolean }> {
    return Promise.resolve({ cancelled: false });
  }

  /** Aucun relevé documenté : rapprochement PayDunya manuel (consigné par WP13). */
  readStatement(_period: { from: Date; to: Date }, _secrets: PspSecrets): Promise<PspStatement> {
    return Promise.resolve({ supported: false });
  }
}
