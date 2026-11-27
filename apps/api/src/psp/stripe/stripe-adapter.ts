// Adaptateur Stripe (mission 12b-1, WP07 ; research.md R-06, R-03). Checkout Session en paiement par carte,
// 3-D Secure demandé (`any`), notification `Stripe-Signature` (HMAC de `t.corps`), relevé par
// `balance_transactions`. La carte n'est jamais dans la notification : un succès est `confirmationRequired`
// et le crédit vient de `getStatus` (session puis PaymentIntent avec `latest_charge` développé).
// Aucun secret, corps ni en-tête dans un message d'erreur : seuls `error.type` et `error.code` (listes courtes)
// et le statut HTTP en sortent.
import type { AppConfig } from '../../config/config';
import { STRIPE_SCHEME, verifyHmacSignature } from '../hmac-signature';
import type { PspAdapter, PspVerification, VerifyNotificationInput } from '../psp-adapter.port';
import { PspProviderError } from '../psp-errors';
import type { PspSecrets } from '../psp-secret-store.port';
import type { PspHttpClient, PspHttpResponse } from '../http/psp-http';
import type {
  NormalizedCard,
  NormalizedNotification,
  NormalizedPayment,
  PspInitiateRequest,
  PspInitiateResult,
  PspStatement,
  PspStatementLine,
  PspStatusQuery,
  PspStatusResult,
} from '../psp.types';

/** Durée minimale d'une session documentée par Stripe : 30 minutes après la création. */
const SESSION_MIN_LIFETIME_MS = 30 * 60 * 1000;
/** Marge ajoutée : `expires_at` est calculé avant l'envoi, et Stripe le compare à l'heure de réception. */
const SESSION_EXPIRY_MARGIN_MS = 60 * 1000;
/**
 * XOF « sans décimale » : le montant part en francs entiers, sans conversion. À CONFIRMER À L'ESSAI (la page des
 * devises de Stripe est à relire avec un compte réel ; une erreur ici fausserait le montant facturé).
 */
const XOF_MINOR_UNIT_FACTOR = 1n;
const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const STATEMENT_MAX_PAGES = 100;
const STATEMENT_PAGE_SIZE = 100;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';
const safeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const SHORT_TOKEN = /^[a-z0-9_]{1,64}$/;

const THREE_DS: Readonly<Record<string, NormalizedCard['threeDs']>> = {
  authenticated: 'SUCCEEDED',
  // Décision du porteur (26/11/2026) : une tentative simplement actée n'est pas une authentification.
  attempt_acknowledged: 'NOT_PERFORMED',
  failed: 'FAILED',
  processing_error: 'FAILED',
  not_supported: 'NOT_PERFORMED',
  exempted: 'NOT_PERFORMED',
  data_share_only: 'NOT_PERFORMED',
};

export class StripePspAdapter implements PspAdapter {
  readonly provider = 'STRIPE' as const;
  readonly isFake = false;
  readonly service = 'psp.stripe' as const;

  constructor(
    private readonly http: PspHttpClient,
    private readonly config: Pick<AppConfig, 'pspBases'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * `expires_at` figé à la première tentative de chaque recharge : une reprise renvoie le même corps, donc jamais
   * la même `Idempotency-Key` avec un autre corps (erreur `idempotency_error`). Mémoire du processus, bornée ;
   * Stripe garde une clé 24 h.
   */
  private readonly expiryByTopup = new Map<string, { seconds: number; at: number }>();

  private expiresAtSeconds(pspTopupId: string): number {
    const now = this.clock().getTime();
    for (const [id, entry] of this.expiryByTopup)
      if (now - entry.at > IDEMPOTENCY_KEY_TTL_MS || this.expiryByTopup.size > 5000)
        this.expiryByTopup.delete(id);
    const known = this.expiryByTopup.get(pspTopupId);
    if (known !== undefined) return known.seconds;
    const seconds = Math.floor((now + SESSION_MIN_LIFETIME_MS + SESSION_EXPIRY_MARGIN_MS) / 1000);
    this.expiryByTopup.set(pspTopupId, { seconds, at: now });
    return seconds;
  }

  // ---------------------------------------------------------------- initiate

  async initiate(request: PspInitiateRequest, secrets: PspSecrets): Promise<PspInitiateResult> {
    const key = this.secretKey(secrets);
    if (request.method !== 'CARD')
      throw new PspProviderError('REJECTED', 'Stripe : moyen non pris en charge');
    if (request.currency !== 'XOF')
      throw new PspProviderError('REJECTED', 'Stripe : seule la devise XOF est prise en charge');
    const unitAmount = request.amount * XOF_MINOR_UNIT_FACTOR;
    if (unitAmount <= 0n || unitAmount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new PspProviderError('REJECTED', 'Stripe : montant hors plage');
    if (request.returnUrl === null || request.returnUrl === '')
      throw new PspProviderError('REJECTED', 'Stripe : adresse de retour obligatoire');

    const expiresAtSeconds = this.expiresAtSeconds(request.pspTopupId);
    const form = new URLSearchParams();
    form.append('mode', 'payment');
    form.append('line_items[0][price_data][currency]', 'xof');
    form.append('line_items[0][price_data][unit_amount]', unitAmount.toString());
    form.append('line_items[0][price_data][product_data][name]', 'Recharge');
    form.append('line_items[0][quantity]', '1');
    form.append('payment_method_types[0]', 'card');
    form.append('payment_method_options[card][request_three_d_secure]', 'any');
    form.append('client_reference_id', request.pspTopupId);
    form.append('metadata[psp_topup_id]', request.pspTopupId);
    form.append('success_url', request.returnUrl);
    form.append('cancel_url', request.returnUrl);
    form.append('expires_at', String(expiresAtSeconds));

    const body = await this.call('initiate', {
      method: 'POST',
      path: '/v1/checkout/sessions',
      key,
      form: form.toString(),
      idempotencyKey: request.pspTopupId,
    });
    const session = body.json;
    if (!nonEmpty(session.id) || !nonEmpty(session.url) || !safeInt(session.expires_at))
      throw new PspProviderError('UNAVAILABLE', 'Stripe : réponse de création inattendue');
    return {
      providerPaymentRef: session.id,
      action: { kind: 'REDIRECT', url: session.url },
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  // ------------------------------------------------------ verifyNotification

  verifyNotification(input: VerifyNotificationInput): PspVerification {
    let header: string | undefined;
    for (const [name, value] of Object.entries(input.headers)) {
      if (name.toLowerCase() !== 'stripe-signature') continue;
      header = Array.isArray(value) ? value[0] : value;
      break;
    }
    const verified = verifyHmacSignature({
      header,
      rawBody: input.rawBody,
      secrets: input.secrets,
      now: input.now,
      scheme: STRIPE_SCHEME,
    });
    if (!verified.ok) return verified;
    if (input.contentType !== 'json') return { ok: false, reason: 'BODY_MALFORMED' };
    const parsed = this.parseEvent(input.rawBody);
    if (parsed === null) return { ok: false, reason: 'BODY_MALFORMED' };
    return {
      ok: true,
      kind: 'NOTIFICATION',
      notification: parsed.notification,
      signedAt: verified.signedAt,
      secretUsed: verified.secretUsed,
      confirmationRequired: parsed.confirmationRequired,
    };
  }

  private parseEvent(
    rawBody: Buffer,
  ): { notification: NormalizedNotification; confirmationRequired: boolean } | null {
    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    if (!isObject(event) || !nonEmpty(event.id) || !nonEmpty(event.type)) return null;
    if (!isObject(event.data) || !isObject(event.data.object)) return null;
    const object = event.data.object;
    const notificationId = event.id;

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        // `completed` sans `paid` (paiement différé) : rien à créditer, la suite viendra d'un autre événement.
        const paid =
          event.type === 'checkout.session.async_payment_succeeded' ||
          object.payment_status === 'paid';
        if (!paid) return this.unknown(notificationId, object);
        const payment = this.sessionPayment(object);
        // La carte n'est pas dans la notification : le crédit vient de `getStatus`.
        return payment && this.result(notificationId, 'PAYMENT_SUCCEEDED', payment, true);
      }
      case 'checkout.session.async_payment_failed': {
        const payment = this.sessionPayment(object);
        return payment && this.result(notificationId, 'PAYMENT_FAILED', payment, false);
      }
      case 'checkout.session.expired': {
        const payment = this.sessionPayment(object);
        return payment && this.result(notificationId, 'PAYMENT_CANCELLED', payment, false);
      }
      case 'charge.dispute.created': {
        if (!nonEmpty(object.id) || !safeInt(object.amount) || object.amount <= 0) return null;
        if (!nonEmpty(object.currency)) return null;
        // Un litige ne porte pas la session : la recharge est retrouvée par relecture, à partir du
        // PaymentIntent (`resolvePaymentReference`). Sans PaymentIntent, rien à relire : refus.
        if (!nonEmpty(object.payment_intent)) return null;
        const ref = object.payment_intent;
        const amount = BigInt(object.amount);
        return {
          confirmationRequired: true,
          notification: {
            notificationId,
            kind: 'DISPUTE',
            payment: {
              merchantReference: null,
              providerPaymentRef: ref,
              amount,
              currency: object.currency.toUpperCase(),
              card: null,
            },
            dispute: { providerDisputeId: object.id, amount },
          },
        };
      }
      default:
        return this.unknown(notificationId, object);
    }
  }

  private sessionPayment(object: Json): NormalizedPayment | null {
    if (!nonEmpty(object.id) || !safeInt(object.amount_total) || object.amount_total <= 0)
      return null;
    if (!nonEmpty(object.currency)) return null;
    const reference = object.client_reference_id;
    if (reference !== undefined && reference !== null && !nonEmpty(reference)) return null;
    return {
      merchantReference: reference ?? null,
      providerPaymentRef: object.id,
      amount: BigInt(object.amount_total),
      currency: object.currency.toUpperCase(),
      card: null,
    };
  }

  private result(
    notificationId: string,
    kind: NormalizedNotification['kind'],
    payment: NormalizedPayment,
    confirmationRequired: boolean,
  ) {
    return {
      confirmationRequired,
      notification: { notificationId, kind, payment, dispute: null },
    };
  }

  /** Événement non pris en charge : conservé sans effet (kind UNKNOWN, aucun montant). */
  private unknown(notificationId: string, object: Json) {
    const reference = object.client_reference_id;
    return this.result(
      notificationId,
      'UNKNOWN',
      {
        merchantReference: nonEmpty(reference) ? reference : null,
        providerPaymentRef: nonEmpty(object.id) ? object.id : notificationId,
        amount: 0n,
        currency: nonEmpty(object.currency) ? object.currency.toUpperCase() : 'XOF',
        card: null,
      },
      false,
    );
  }

  // --------------------------------------------------------------- getStatus

  async getStatus(query: PspStatusQuery, secrets: PspSecrets): Promise<PspStatusResult> {
    const key = this.secretKey(secrets);
    const unknown: PspStatusResult = { state: 'UNKNOWN', payment: null };
    // Stripe n'offre pas de recherche de session par référence marchande : sans `cs_…`, rien à relire.
    if (query.providerPaymentRef === null) return unknown;
    const id = encodeURIComponent(query.providerPaymentRef);
    const sessionRes = await this.call('getStatus', {
      method: 'GET',
      path: `/v1/checkout/sessions/${id}`,
      key,
      acceptMissing: true,
    });
    if (sessionRes.missing) return unknown;
    const session = sessionRes.json;
    if (session.id !== query.providerPaymentRef) return unknown;
    // La session doit être celle de la recharge demandée : une autre référence n'est jamais créditée.
    if (session.client_reference_id !== query.merchantReference) return unknown;
    if (!safeInt(session.amount_total) || session.amount_total < 0 || !nonEmpty(session.currency))
      return unknown;

    let intent: Json | null = null;
    if (nonEmpty(session.payment_intent)) {
      const res = await this.call('getStatus', {
        method: 'GET',
        path: `/v1/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`,
        key,
      });
      intent = res.json;
    }

    const paid = session.status === 'complete' && session.payment_status === 'paid';
    let state: PspStatusResult['state'];
    if (paid) state = 'PAID';
    else if (session.status === 'expired') state = 'EXPIRED';
    else if (intent?.status === 'canceled') state = 'CANCELLED';
    else if (session.status === 'open') state = 'PENDING';
    else if (session.status === 'complete' && session.payment_status === 'unpaid')
      state = 'PENDING';
    else state = 'UNKNOWN';

    return {
      state,
      payment: {
        merchantReference: query.merchantReference,
        providerPaymentRef: session.id,
        amount: BigInt(session.amount_total),
        currency: session.currency.toUpperCase(),
        card: paid && intent !== null ? this.cardOf(intent) : null,
      },
    };
  }

  /** Carte du dernier débit ; sans `latest_charge` développé, aucune carte : le processeur refuse. */
  private cardOf(intent: Json): NormalizedCard | null {
    const charge = intent.latest_charge;
    if (!isObject(charge) || !isObject(charge.payment_method_details)) return null;
    const card = charge.payment_method_details.card;
    if (!isObject(card)) return null;
    const result = isObject(card.three_d_secure) ? card.three_d_secure.result : undefined;
    return {
      fingerprint: nonEmpty(card.fingerprint) ? card.fingerprint : null,
      threeDs: (typeof result === 'string' ? THREE_DS[result] : undefined) ?? 'NOT_PERFORMED',
    };
  }

  // ------------------------------------------------------------------ cancel

  async cancel(query: PspStatusQuery, secrets: PspSecrets): Promise<{ cancelled: boolean }> {
    const key = this.secretKey(secrets);
    if (query.providerPaymentRef === null) return { cancelled: false };
    const id = encodeURIComponent(query.providerPaymentRef);
    const res = await this.call('cancel', {
      method: 'POST',
      path: `/v1/checkout/sessions/${id}/expire`,
      key,
      form: '',
      idempotencyKey: `cancel-${query.providerPaymentRef}`,
      refusalIsFalse: true,
    });
    if (res.refused) return { cancelled: false };
    return { cancelled: res.json.status === 'expired' };
  }

  // ------------------------------------------------- resolvePaymentReference

  /** Session de ce PaymentIntent (`GET /v1/checkout/sessions?payment_intent=…&limit=1`), sinon `null`. */
  async resolvePaymentReference(
    reference: string,
    secrets: PspSecrets,
  ): Promise<{ merchantReference: string; providerPaymentRef: string } | null> {
    const key = this.secretKey(secrets);
    const { json } = await this.call('resolvePaymentReference', {
      method: 'GET',
      path: `/v1/checkout/sessions?payment_intent=${encodeURIComponent(reference)}&limit=1`,
      key,
    });
    if (!Array.isArray(json.data))
      throw new PspProviderError('UNAVAILABLE', 'Stripe : réponse inattendue');
    const session: unknown = json.data[0];
    if (!isObject(session) || !nonEmpty(session.id) || !nonEmpty(session.client_reference_id))
      return null;
    // La session rendue doit bien porter ce PaymentIntent : jamais une autre recharge.
    if (session.payment_intent !== reference) return null;
    return { merchantReference: session.client_reference_id, providerPaymentRef: session.id };
  }

  // ----------------------------------------------------------- readStatement

  async readStatement(
    period: { from: Date; to: Date },
    secrets: PspSecrets,
  ): Promise<PspStatement> {
    const key = this.secretKey(secrets);
    const gte = Math.floor(period.from.getTime() / 1000);
    const lte = Math.floor(period.to.getTime() / 1000);
    const lines: PspStatementLine[] = [];
    let after: string | null = null;
    for (let page = 0; page < STATEMENT_MAX_PAGES; page += 1) {
      let path = `/v1/balance_transactions?created[gte]=${gte}&created[lte]=${lte}&limit=${STATEMENT_PAGE_SIZE}`;
      if (after !== null) path += `&starting_after=${encodeURIComponent(after)}`;
      const { json } = await this.call('readStatement', { method: 'GET', path, key });
      if (!Array.isArray(json.data) || typeof json.has_more !== 'boolean')
        throw new PspProviderError('UNAVAILABLE', 'Stripe : relevé inattendu');
      for (const row of json.data as unknown[]) {
        if (
          !isObject(row) ||
          !nonEmpty(row.id) ||
          !safeInt(row.amount) ||
          !safeInt(row.fee) ||
          !safeInt(row.created) ||
          !nonEmpty(row.currency)
        )
          throw new PspProviderError('UNAVAILABLE', 'Stripe : ligne de relevé inattendue');
        const source = nonEmpty(row.source) ? row.source : null;
        lines.push({
          reference: source ?? row.id,
          providerPaymentRef: source,
          amount: BigInt(row.amount),
          fee: BigInt(row.fee),
          currency: row.currency.toUpperCase(),
          date: new Date(row.created * 1000),
          reversal: row.type === 'refund',
        });
        after = row.id;
      }
      if (!json.has_more) return { supported: true, lines };
      if (json.data.length === 0)
        throw new PspProviderError('UNAVAILABLE', 'Stripe : relevé inattendu');
    }
    // Borne atteinte : un relevé tronqué n'est jamais rendu comme complet.
    throw new PspProviderError('UNAVAILABLE', 'Stripe : relevé trop long');
  }

  // --------------------------------------------------------------- transport

  private secretKey(secrets: PspSecrets): string {
    const credentials = secrets.credentials;
    if (credentials.provider !== 'STRIPE')
      throw new PspProviderError('REJECTED', 'Stripe : identifiants d’un autre fournisseur');
    return credentials.secretKey.reveal();
  }

  private async call(
    operation: string,
    req: {
      method: 'GET' | 'POST';
      path: string;
      key: string;
      form?: string;
      idempotencyKey?: string;
      acceptMissing?: boolean;
      refusalIsFalse?: boolean;
    },
  ): Promise<{ json: Json; missing: boolean; refused: boolean }> {
    const headers: Record<string, string> = { authorization: `Bearer ${req.key}` };
    if (req.method === 'POST') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      // Chaque POST porte sa clé : un nouvel essai rejoue la même requête, jamais une seconde création.
      headers['idempotency-key'] = req.idempotencyKey!;
    }
    let res: PspHttpResponse;
    try {
      res = await this.http.send({
        provider: 'STRIPE',
        operation,
        method: req.method,
        url: `${this.config.pspBases.stripe}${req.path}`,
        headers,
        body: req.form,
        idempotent: true,
      });
    } catch {
      throw new PspProviderError('UNAVAILABLE', `Stripe ${operation} : service injoignable`);
    }
    if (res.status >= 200 && res.status < 300)
      return { json: this.parse(res, operation), missing: false, refused: false };
    if (req.acceptMissing && res.status === 404) return { json: {}, missing: true, refused: false };
    const { type, code } = this.errorOf(res);
    if (
      req.refusalIsFalse &&
      (res.status === 400 || res.status === 404) &&
      type !== 'idempotency_error'
    )
      return { json: {}, missing: false, refused: true };
    const kind =
      res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403
        ? 'UNAVAILABLE'
        : 'REJECTED';
    throw new PspProviderError(
      kind,
      `Stripe ${operation} : refus ${res.status} ${type ?? '-'} ${code ?? '-'}`,
    );
  }

  private parse(res: PspHttpResponse, operation: string): Json {
    try {
      const json: unknown = JSON.parse(res.body.toString('utf8'));
      if (isObject(json)) return json;
    } catch {
      /* réponse non JSON : traitée plus bas */
    }
    throw new PspProviderError('UNAVAILABLE', `Stripe ${operation} : réponse illisible`);
  }

  /** `error.type` et `error.code` seulement, et seulement s'ils ont la forme d'un identifiant court. */
  private errorOf(res: PspHttpResponse): { type: string | null; code: string | null } {
    try {
      const json: unknown = JSON.parse(res.body.toString('utf8'));
      const error = isObject(json) && isObject(json.error) ? json.error : {};
      const pick = (v: unknown) => (typeof v === 'string' && SHORT_TOKEN.test(v) ? v : null);
      return { type: pick(error.type), code: pick(error.code) };
    } catch {
      return { type: null, code: null };
    }
  }
}
