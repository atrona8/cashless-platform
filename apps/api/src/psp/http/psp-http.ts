// Client HTTP sortant commun des adaptateurs de PSP (mission 12b-1, interfaces.md §3).
// Règles : aucune redirection suivie, réponse bornée à 1 Mio, nouveaux essais seulement pour une requête
// idempotente, journal sans en-tête ni corps, message d'erreur sans URL complète ni corps.
import { Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../../config/config';
import type { PspProviderName } from '../psp.types';

export interface PspHttpRequest {
  provider: PspProviderName;
  operation: string; // pour le journal
  method: 'GET' | 'POST';
  url: string; // absolue, construite depuis pspBases
  headers?: Record<string, string>; // jamais journalisés
  body?: string | Buffer; // jamais journalisé
  idempotent: boolean; // vrai : nouveaux essais permis
}

export interface PspHttpResponse {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
}

export type PspHttpErrorKind = 'TIMEOUT' | 'NETWORK';

/** Échec de transport (réseau, délai). Le message ne porte ni l'URL complète ni un corps ni un en-tête. */
export class PspHttpError extends Error {
  readonly kind: PspHttpErrorKind;
  /** Code court du transport (`ECONNREFUSED`, `ECONNABORTED`…), jamais un message libre. */
  readonly code: string | null;
  constructor(kind: PspHttpErrorKind, message: string, code: string | null = null) {
    super(message);
    this.name = 'PspHttpError';
    this.kind = kind;
    this.code = code;
  }
}

/** Taille maximale d'une réponse : 1 Mio. */
export const PSP_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;
/** Nombre maximal de nouveaux essais (hors envoi initial). */
export const PSP_HTTP_MAX_RETRIES = 2;
const BACKOFF_MS = [200, 800] as const;
const RETRY_AFTER_MAX_SECONDS = 5;

function retryDelayMs(retryIndex: number, retryAfter: string | undefined): number {
  if (retryAfter !== undefined && /^[0-9]+$/.test(retryAfter.trim())) {
    const seconds = Number(retryAfter.trim());
    if (seconds <= RETRY_AFTER_MAX_SECONDS) return seconds * 1000;
  }
  return BACKOFF_MS[Math.min(retryIndex, BACKOFF_MS.length - 1)]!;
}

export class PspHttpClient {
  private readonly logger = new Logger('PspHttpClient');
  private readonly http: AxiosInstance;

  constructor(
    config: Pick<AppConfig, 'pspHttpTimeoutMs'>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.http = axios.create({
      timeout: config.pspHttpTimeoutMs,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
      proxy: false,
      maxContentLength: PSP_HTTP_MAX_RESPONSE_BYTES,
      maxBodyLength: PSP_HTTP_MAX_RESPONSE_BYTES,
      transformResponse: (data: unknown) => data,
    });
  }

  /** Ne lève pas sur 4xx/5xx ; lève `PspHttpError` (réseau, délai). */
  async send(req: PspHttpRequest): Promise<PspHttpResponse> {
    const host = new URL(req.url).host;
    const started = Date.now();
    let attempts = 0;
    for (;;) {
      attempts += 1;
      let response: PspHttpResponse | null = null;
      let failure: PspHttpError | null = null;
      try {
        response = await this.attempt(req);
      } catch (error) {
        failure = this.toError(error, req, host);
      }
      const retryable =
        req.idempotent &&
        attempts <= PSP_HTTP_MAX_RETRIES &&
        (failure !== null || response!.status === 429 || response!.status >= 500);
      if (retryable) {
        await this.sleep(retryDelayMs(attempts - 1, response?.headers['retry-after']));
        continue;
      }
      this.journal(req, response?.status ?? null, Date.now() - started, attempts);
      if (failure !== null) throw failure;
      return response!;
    }
  }

  private async attempt(req: PspHttpRequest): Promise<PspHttpResponse> {
    const res = await this.http.request<ArrayBuffer>({
      method: req.method,
      url: req.url,
      headers: req.headers,
      data: req.body,
    });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(res.headers)) {
      if (value === undefined || value === null) continue;
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    const body = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data ?? []);
    return { status: res.status, body, headers };
  }

  private toError(error: unknown, req: PspHttpRequest, host: string): PspHttpError {
    const code =
      typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : null;
    const where = `${req.provider} ${req.operation} (${host})`;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT')
      return new PspHttpError('TIMEOUT', `${where} : délai dépassé`, code);
    return new PspHttpError('NETWORK', `${where} : échec réseau`, code);
  }

  private journal(
    req: PspHttpRequest,
    status: number | null,
    durationMs: number,
    attempts: number,
  ): void {
    this.logger.log(
      JSON.stringify({
        provider: req.provider,
        operation: req.operation,
        status,
        durationMs,
        attempts,
      }),
    );
  }
}
