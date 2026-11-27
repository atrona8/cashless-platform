// Adaptateur Wave (Checkout API, webhook `Wave-Signature`, relevé Balance API), mission 12b-1, WP05.
// Sources : docs.wave.com/checkout, /webhook, /balance-api (research.md R-03, R-04). Aucun secret, corps complet
// ni référence de secret dans un journal ou un message d'erreur : seul le `code` court d'une erreur Wave remonte.
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { WAVE_SCHEME, computeSignature, verifyHmacSignature } from '../hmac-signature';
import { PspHttpClient, PspHttpError, type PspHttpResponse } from '../http/psp-http';
import type { PspAdapter, PspVerification, VerifyNotificationInput } from '../psp-adapter.port';
import { PspProviderError } from '../psp-errors';
import type { PspSecrets } from '../psp-secret-store.port';
import type { Secret } from '../secret';
import type {
  NormalizedNotification,
  NormalizedPayment,
  PspInitiateRequest,
  PspInitiateResult,
  PspStatement,
  PspStatementLine,
  PspStatusQuery,
  PspStatusResult,
} from '../psp.types';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Borne de pagination du relevé : pages par jour (au-delà, erreur). */
export const WAVE_STATEMENT_MAX_PAGES_PER_DAY = 100;
/** Borne de la période d'un relevé, en jours UTC. */
export const WAVE_STATEMENT_MAX_DAYS = 31;
/** À confirmer à l'essai : valeurs de `payment_status` / `checkout_status` hors celles de la documentation. */
const CURRENCY = 'XOF';
const MSISDN_E164 = /^\+[1-9][0-9]{6,14}$/;
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Entier décimal sans fraction (chaîne ou nombre entier sûr), sinon null. `signed` : signe moins permis. */
function integerOf(value: unknown, signed: boolean): bigint | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && (signed || value >= 0) ? BigInt(value) : null;
  if (typeof value === 'string' && (signed ? /^-?[0-9]+$/ : /^[0-9]+$/).test(value))
    return BigInt(value);
  return null;
}

function refused(message: string): PspProviderError {
  return new PspProviderError('REJECTED', message);
}
function unavailable(message: string): PspProviderError {
  return new PspProviderError('UNAVAILABLE', message);
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** Code court d'une erreur Wave (`{code, message}` ; ou `error_code`), jamais le corps. */
function waveErrorCode(res: PspHttpResponse): string | null {
  const json = parseJson(res.body);
  if (!isObject(json)) return null;
  const nested = isObject(json.error) ? json.error : null;
  const code = str(json.code) ?? str(json.error_code) ?? (nested ? str(nested.code) : null);
  return code !== null && CODE_SHAPE.test(code) ? code : null;
}

export class WavePspAdapter implements PspAdapter {
  readonly provider = 'WAVE' as const;
  readonly isFake = false;
  readonly service = 'psp.wave' as const;
  private readonly logger = new Logger('WavePspAdapter');
  private readonly base: string;

  constructor(
    private readonly http: PspHttpClient,
    private readonly config: Pick<AppConfig, 'pspBases' | 'waveDefaultUrls'>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.base = config.pspBases.wave.replace(/\/+$/, '');
  }

  // --- appels ------------------------------------------------------------------------------------------------

  private credentials(secrets: PspSecrets): { apiKey: Secret; signing: Secret | null } {
    const c = secrets.credentials;
    if (c.provider !== 'WAVE') throw refused('identifiants Wave attendus');
    return { apiKey: c.apiKey, signing: c.requestSigningSecret };
  }

  private headers(secrets: PspSecrets, body: string | null): Record<string, string> {
    const { apiKey, signing } = this.credentials(secrets);
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey.reveal()}` };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (signing !== null) {
      const t = Math.floor(this.clock().getTime() / 1000);
      const v1 = computeSignature(signing, t, Buffer.from(body ?? '', 'utf8'), WAVE_SCHEME);
      headers['Wave-Signature'] = `t=${t},v1=${v1}`;
    }
    return headers;
  }

  /** Une réponse hors 2xx devient une erreur du port portant le seul code Wave. */
  private fail(res: PspHttpResponse, operation: string): never {
    const code = waveErrorCode(res);
    const suffix = code === null ? '' : `, code ${code}`;
    const message = `Wave ${operation} : statut ${res.status}${suffix}`;
    throw res.status >= 500 || res.status === 429 ? unavailable(message) : refused(message);
  }

  private async call(
    secrets: PspSecrets,
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    body: Json | null,
    idempotent: boolean,
  ): Promise<PspHttpResponse> {
    const raw = body === null ? null : JSON.stringify(body);
    try {
      return await this.http.send({
        provider: 'WAVE',
        operation,
        method,
        url: `${this.base}${path}`,
        headers: this.headers(secrets, raw),
        ...(raw === null ? {} : { body: raw }),
        idempotent,
      });
    } catch (error) {
      if (error instanceof PspHttpError) throw unavailable(error.message);
      throw error;
    }
  }

  // --- initiate ----------------------------------------------------------------------------------------------

  async initiate(request: PspInitiateRequest, secrets: PspSecrets): Promise<PspInitiateResult> {
    this.credentials(secrets);
    if (request.currency !== CURRENCY) throw refused('Wave : devise XOF exigée');
    if (request.amount <= 0n) throw refused('Wave : montant entier positif exigé');
    const successUrl = this.httpsUrl(request.returnUrl ?? this.config.waveDefaultUrls.success);
    const errorUrl = this.httpsUrl(request.returnUrl ?? this.config.waveDefaultUrls.error);
    if (successUrl === null || errorUrl === null)
      throw refused('Wave : adresses de retour https absentes (success_url, error_url)');
    const body: Json = {
      amount: String(request.amount),
      currency: CURRENCY,
      client_reference: request.pspTopupId,
      success_url: successUrl,
      error_url: errorUrl,
    };
    if (request.payerMsisdn !== null && MSISDN_E164.test(request.payerMsisdn))
      body.restrict_payer_mobile = request.payerMsisdn;

    let res: PspHttpResponse | null = null;
    try {
      // Création non idempotente (aucune clé documentée) : jamais rejouée par le client.
      res = await this.call(
        secrets,
        'checkout.create',
        'POST',
        '/v1/checkout/sessions',
        body,
        false,
      );
    } catch (error) {
      if (!(error instanceof PspProviderError) || error.kind !== 'UNAVAILABLE') throw error;
    }
    if (res !== null && res.status >= 200 && res.status < 300) return this.initiated(res);
    if (res !== null && res.status < 500 && res.status !== 429) this.fail(res, 'checkout.create');

    // Délai, réseau ou 5xx : la session a pu être créée. Recherche d'abord, jamais de seconde création.
    const found = await this.searchSessions(request.pspTopupId, secrets);
    const open = found.filter((s) => s.checkout_status === 'open');
    if (open.length === 0)
      throw unavailable('Wave : création sans réponse et aucune session ouverte trouvée');
    // La session reprise doit être celle de la demande : même montant et même devise.
    const same = open.find(
      (s) => s.amount === String(request.amount) && s.currency === request.currency,
    );
    if (same === undefined) throw unavailable('Wave : session trouvée différente de la demande');
    return this.initiatedFrom(same);
  }

  private httpsUrl(value: string | null): string | null {
    if (value === null) return null;
    try {
      return new URL(value).protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  }

  private initiated(res: PspHttpResponse): PspInitiateResult {
    const json = parseJson(res.body);
    if (!isObject(json)) throw unavailable('Wave : réponse de création illisible');
    return this.initiatedFrom(json);
  }

  private initiatedFrom(s: Json): PspInitiateResult {
    const id = str(s.id);
    const url = str(s.wave_launch_url);
    const expires = str(s.when_expires);
    const expiresAt = expires === null ? null : new Date(expires);
    if (id === null || url === null || expiresAt === null || Number.isNaN(expiresAt.getTime()))
      throw unavailable('Wave : réponse de création incomplète');
    return { providerPaymentRef: id, action: { kind: 'REDIRECT', url }, expiresAt };
  }

  /** Sessions de la référence marchande, la plus récente d'abord. */
  private async searchSessions(reference: string, secrets: PspSecrets): Promise<Json[]> {
    const res = await this.call(
      secrets,
      'checkout.search',
      'GET',
      `/v1/checkout/sessions/search?client_reference=${encodeURIComponent(reference)}`,
      null,
      true,
    );
    if (res.status < 200 || res.status >= 300) this.fail(res, 'checkout.search');
    const json = parseJson(res.body);
    const list = isObject(json) && Array.isArray(json.result) ? json.result.filter(isObject) : null;
    if (list === null) throw unavailable('Wave : réponse de recherche illisible');
    // Seules les sessions de CETTE référence marchande (égalité exacte) comptent.
    return list
      .filter((s) => s.client_reference === reference)
      .sort((a, b) => (str(b.when_created) ?? '').localeCompare(str(a.when_created) ?? ''));
  }

  // --- verifyNotification -------------------------------------------------------------------------------------

  verifyNotification(input: VerifyNotificationInput): PspVerification {
    if (input.contentType !== 'json') return { ok: false, reason: 'BODY_MALFORMED' };
    const header = this.headerValue(input.headers);
    if (header === 'MULTIPLE') return { ok: false, reason: 'SIGNATURE_MALFORMED' };
    const verified = verifyHmacSignature({
      header,
      rawBody: input.rawBody,
      secrets: input.secrets,
      now: input.now,
      scheme: WAVE_SCHEME,
    });
    if (!verified.ok) return { ok: false, reason: verified.reason };
    // Le corps n'est lu qu'après la signature.
    const event = parseJson(input.rawBody);
    if (!isObject(event) || !isObject(event.data)) return { ok: false, reason: 'BODY_MALFORMED' };
    const notificationId = str(event.id);
    const type = str(event.type);
    if (notificationId === null || type === null) return { ok: false, reason: 'BODY_MALFORMED' };
    const data = event.data;
    let kind: NormalizedNotification['kind'] = 'UNKNOWN';
    if (type === 'checkout.session.completed' && data.payment_status === 'succeeded')
      kind = 'PAYMENT_SUCCEEDED';
    else if (type === 'checkout.session.payment_failed') kind = 'PAYMENT_FAILED';
    const payment = this.paymentOf(data, kind === 'PAYMENT_SUCCEEDED');
    if (payment === null) return { ok: false, reason: 'BODY_MALFORMED' };
    return {
      ok: true,
      kind: 'NOTIFICATION',
      notification: { notificationId, kind, payment, dispute: null },
      signedAt: verified.signedAt,
      secretUsed: verified.secretUsed,
      confirmationRequired: false,
    };
  }

  private headerValue(
    headers: VerifyNotificationInput['headers'],
  ): string | undefined | 'MULTIPLE' {
    let found: string | string[] | undefined;
    for (const [name, value] of Object.entries(headers))
      if (name.toLowerCase() === 'wave-signature') found = value;
    if (Array.isArray(found)) return found.length === 1 ? found[0] : 'MULTIPLE';
    return found;
  }

  /** `strict` : montant, devise et référence de session obligatoires (paiement réussi). */
  private paymentOf(data: Json, strict: boolean): NormalizedPayment | null {
    const providerPaymentRef = str(data.id);
    const amount = data.amount === undefined && !strict ? 0n : integerOf(data.amount, false);
    const currency = str(data.currency) ?? (strict ? null : '');
    if (providerPaymentRef === null || amount === null || currency === null) return null;
    return {
      merchantReference: str(data.client_reference),
      providerPaymentRef,
      amount,
      currency,
      card: null,
    };
  }

  // --- getStatus et cancel ------------------------------------------------------------------------------------

  async getStatus(query: PspStatusQuery, secrets: PspSecrets): Promise<PspStatusResult> {
    let session: Json | undefined;
    if (query.providerPaymentRef !== null) {
      const res = await this.call(
        secrets,
        'checkout.get',
        'GET',
        `/v1/checkout/sessions/${encodeURIComponent(query.providerPaymentRef)}`,
        null,
        true,
      );
      if (res.status === 404) return { state: 'UNKNOWN', payment: null };
      if (res.status < 200 || res.status >= 300) this.fail(res, 'checkout.get');
      const json = parseJson(res.body);
      if (!isObject(json)) throw unavailable('Wave : réponse de statut illisible');
      if (json.id !== query.providerPaymentRef) throw unavailable('Wave : session différente');
      session = json;
    } else {
      const found = await this.searchSessions(query.merchantReference, secrets);
      this.logger.log(JSON.stringify({ operation: 'checkout.search', count: found.length }));
      session = found[0];
    }
    if (session === undefined) return { state: 'UNKNOWN', payment: null };

    const payment = this.paymentOf(session, true);
    const checkout = session.checkout_status;
    const pay = session.payment_status;
    let state: PspStatusResult['state'] = 'UNKNOWN';
    if (checkout === 'complete' && pay === 'succeeded') state = 'PAID';
    else if (checkout === 'expired') state = 'EXPIRED';
    else if (pay === 'cancelled' || pay === 'failed') state = 'FAILED';
    else if (checkout === 'open' || pay === 'processing') state = 'PENDING';
    // Un paiement réussi dont le montant ou la devise est illisible n'est jamais rendu comme payé.
    if (state === 'PAID' && payment === null) return { state: 'UNKNOWN', payment: null };
    return { state, payment };
  }

  async cancel(query: PspStatusQuery, secrets: PspSecrets): Promise<{ cancelled: boolean }> {
    let ref = query.providerPaymentRef;
    if (ref === null) {
      const open = (await this.searchSessions(query.merchantReference, secrets)).find(
        (s) => s.checkout_status === 'open',
      );
      ref = open === undefined ? null : str(open.id);
      if (ref === null) return { cancelled: false };
    }
    const res = await this.call(
      secrets,
      'checkout.expire',
      'POST',
      `/v1/checkout/sessions/${encodeURIComponent(ref)}/expire`,
      null,
      false,
    );
    if (res.status === 200) return { cancelled: true };
    if (res.status === 409) return { cancelled: false };
    if (res.status === 404) {
      this.logger.log(JSON.stringify({ operation: 'checkout.expire', status: 404 }));
      return { cancelled: false };
    }
    return this.fail(res, 'checkout.expire');
  }

  // --- readStatement ------------------------------------------------------------------------------------------

  async readStatement(
    period: { from: Date; to: Date },
    secrets: PspSecrets,
  ): Promise<PspStatement> {
    const lines: PspStatementLine[] = [];
    const day = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const days = (day(period.to) - day(period.from)) / 86_400_000 + 1;
    if (days > WAVE_STATEMENT_MAX_DAYS)
      throw refused('Wave : période de relevé de plus de 31 jours');
    for (let t = day(period.from); t <= day(period.to); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      let after: string | null = null;
      for (let page = 1; ; page += 1) {
        if (page > WAVE_STATEMENT_MAX_PAGES_PER_DAY)
          throw unavailable('Wave : relevé au-delà de 100 pages pour un jour');
        const query = `date=${date}${after === null ? '' : `&after=${encodeURIComponent(after)}`}`;
        const res = await this.call(
          secrets,
          'transactions',
          'GET',
          `/v1/transactions?${query}`,
          null,
          true,
        );
        if (res.status < 200 || res.status >= 300) this.fail(res, 'transactions');
        const json = parseJson(res.body);
        if (!isObject(json) || !Array.isArray(json.items))
          throw unavailable('Wave : réponse de relevé illisible');
        for (const item of json.items) {
          const line = this.lineOf(item);
          if (line.currency !== CURRENCY) {
            // Ligne refusée : journal sans valeur de secret ni corps.
            this.logger.log(JSON.stringify({ operation: 'transactions', refused: 'currency' }));
            continue;
          }
          lines.push(line);
        }
        const info = isObject(json.page_info) ? json.page_info : {};
        after = str(info.end_cursor);
        if (info.has_next_page !== true) break;
        if (after === null) throw unavailable('Wave : curseur de relevé absent');
      }
    }
    return { supported: true, lines };
  }

  private lineOf(item: unknown): PspStatementLine {
    if (!isObject(item)) throw unavailable('Wave : ligne de relevé illisible');
    const amount = integerOf(item.amount, true);
    const fee = item.fee === undefined ? 0n : integerOf(item.fee, true);
    const date = new Date(str(item.timestamp) ?? '');
    const currency = str(item.currency);
    if (amount === null || fee === null || currency === null || Number.isNaN(date.getTime()))
      throw unavailable('Wave : ligne de relevé illisible');
    return {
      reference: str(item.client_reference) ?? '',
      providerPaymentRef: str(item.checkout_api_session_id) ?? str(item.transaction_id),
      amount,
      fee,
      currency,
      date,
      reversal: item.is_reversal === true,
    };
  }
}
