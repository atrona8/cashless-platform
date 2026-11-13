// Client HTTPS mTLS vers le central (T075, interfaces.md § 8, contracts/edge-routes.md).
//
//  - `node:https` seul (aucune bibliothèque nouvelle). Certificat client : fichiers
//    `GATEWAY_CENTRAL_CLIENT_CERT_FILE` / `_KEY_FILE`. Autorité du central ÉPINGLÉE : le
//    certificat de l'autorité vient du fichier d'enrôlement, stocké à l'enrôlement dans
//    `edge_meta.central_ca_pem` (le fichier est supprimé après usage). Aucune autre autorité
//    n'est consultée (`ca` remplace les autorités du système) : un certificat différent est
//    refusé (`PINNING_FAILED`), jamais de repli en clair. L'URL doit être `https:`.
//  - Chaque réponse HTTP (succès ou erreur, pas une erreur réseau) transmet son en-tête `Date` à
//    `GatewayClock.observeCentral` : seule mesure d'heure centrale (R-14).
//  - Délais explicites et annulables (`AbortSignal`). JAMAIS de nouvelle tentative implicite : la
//    reprise est du ressort de l'appelant (idempotence par identifiants).
//  - Une réponse tronquée, un statut de succès inattendu ou un corps illisible ne sont jamais pris
//    pour un succès.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { Inject, Injectable } from '@nestjs/common';
import { inspectClientKey } from '../config/client-key-file';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx } from '../db/gateway-tx';
import { CentralError, errorFromResponse } from './central-errors';

/** Handover tel que le central le publie (schéma `Handover`, champs utilisés par la passerelle). */
export interface HandoverBody {
  handover_id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  state:
    | 'GRANTED'
    | 'ACTIVE'
    | 'RELEASE_REQUESTED'
    | 'RELEASING'
    | 'COMPLETED'
    | 'FORCED'
    | 'FAILED';
  epoch: number;
  central_watermark_posting_id?: number | null;
  final_edge_seq?: number | null;
  missing_edge_seqs?: number[] | null;
  requested_at?: string;
  completed_at?: string | null;
  /** Ajout éventuel du central (non requis par le contrat) : `contiguous_edge_seq` à l'accusé. */
  edge_seq_at_activation?: number | null;
}

/** `DebitAuthorityState`. */
export interface DebitAuthorityStateBody {
  ledger_id: string;
  authority: 'CENTRAL' | 'EDGE';
  epoch: number;
  edge_gateway_id: string | null;
  edge_base_url: string | null;
  handover: HandoverBody | null;
}

export interface CentralResponse<T> {
  body: T;
  /** Valeur de l'en-tête `Date` de la réponse (heure centrale), ou `null` si absente/illisible. */
  centralDate: Date | null;
  status: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Délai total en millisecondes. */
  timeoutMs?: number;
}

export interface ReleaseBody {
  epoch: number;
  final_edge_seq: number;
  last_chain_hash: string;
  operations_count: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Marge ajoutée à `wait` pour l'attente longue. */
export const LONG_POLL_MARGIN_MS = 8_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const PINNING_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
  'HOSTNAME_MISMATCH',
]);

interface Trust {
  baseUrl: URL;
  ca: string;
  cert: Buffer;
  key: Buffer;
}

@Injectable()
export class CentralClient {
  private trustCache: Trust | null = null;

  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  getCurrentEdgeHandover(
    wait: number,
    options: RequestOptions = {},
  ): Promise<CentralResponse<DebitAuthorityStateBody>> {
    if (!Number.isInteger(wait) || wait < 0 || wait > 25) {
      throw new RangeError('wait : entier de 0 à 25');
    }
    return this.send<DebitAuthorityStateBody>('GET', `/edge/handovers/current?wait=${wait}`, {
      ...options,
      timeoutMs: options.timeoutMs ?? wait * 1000 + LONG_POLL_MARGIN_MS,
    });
  }

  ackEdgeHandover(
    handoverId: string,
    body: { epoch: number; replicated_posting_id: number },
    options: RequestOptions = {},
  ): Promise<CentralResponse<DebitAuthorityStateBody>> {
    return this.send('POST', `/edge/handovers/${encodeURIComponent(handoverId)}/ack`, {
      ...options,
      body,
    });
  }

  releaseEdgeHandover(
    handoverId: string,
    body: ReleaseBody,
    options: RequestOptions = {},
  ): Promise<CentralResponse<DebitAuthorityStateBody>> {
    return this.send('POST', `/edge/handovers/${encodeURIComponent(handoverId)}/release`, {
      ...options,
      body,
    });
  }

  /** Utilisé par WP18. `afterChangeSeq` : ajout facultatif (`replication-page-additions`). */
  getEdgeReplicationFeed(
    params: { afterPostingId: number; limit?: number; afterChangeSeq?: number },
    options: RequestOptions = {},
  ): Promise<CentralResponse<Record<string, unknown>>> {
    const query = new URLSearchParams({ after_posting_id: String(params.afterPostingId) });
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.afterChangeSeq !== undefined) {
      query.set('after_change_seq', String(params.afterChangeSeq));
    }
    return this.send('GET', `/edge/replication-feed?${query.toString()}`, options);
  }

  /** Utilisé par WP20. `Idempotency-Key` = `batch_id` ; aucune nouvelle tentative ici. */
  submitEdgeSyncBatch(
    batchId: string,
    batch: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<CentralResponse<Record<string, unknown>>> {
    return this.send('POST', '/edge/sync-batches', {
      ...options,
      body: batch,
      headers: { 'Idempotency-Key': batchId },
    });
  }

  private async loadTrust(): Promise<Trust> {
    if (this.trustCache) return this.trustCache;
    const meta = await this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ central_url: string; central_ca_pem: string }>(
        'SELECT central_url, central_ca_pem FROM edge_meta',
      );
      return rows[0];
    });
    if (!meta) throw new CentralError('NETWORK', 'passerelle non enrôlée : central inconnu');
    const baseUrl = new URL(this.config.centralUrl ?? meta.central_url);
    if (baseUrl.protocol !== 'https:') {
      throw new CentralError('NETWORK', 'central : https obligatoire (jamais de repli en clair)');
    }
    const { centralClientCertFile: certFile, centralClientKeyFile: keyFile } = this.config;
    if (certFile === null || keyFile === null) {
      throw new CentralError('NETWORK', 'certificat client du central non configuré');
    }
    // Décision 32 : contrôle refait à la lecture, sur le descripteur même qui est lu (anti-TOCTOU).
    const keyRead = inspectClientKey(keyFile, this.config.production);
    if (keyRead.violations.length > 0) {
      throw new CentralError('NETWORK', keyRead.violations.join(' ; '));
    }
    let cert: Buffer;
    const key = keyRead.key;
    try {
      cert = readFileSync(certFile);
    } catch {
      // Nomme la variable, jamais le contenu.
      throw new CentralError('NETWORK', 'GATEWAY_CENTRAL_CLIENT_CERT_FILE / KEY_FILE illisibles');
    }
    if (key === null) {
      throw new CentralError('NETWORK', 'GATEWAY_CENTRAL_CLIENT_CERT_FILE / KEY_FILE illisibles');
    }
    this.trustCache = { baseUrl, ca: meta.central_ca_pem, cert, key };
    return this.trustCache;
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions & { body?: unknown; headers?: Record<string, string> },
  ): Promise<CentralResponse<T>> {
    if (options.signal?.aborted) throw new CentralError('ABORTED', 'requête annulée');
    const trust = await this.loadTrust();
    const raw = await this.exchange(trust, method, path, options);
    let centralDate: Date | null = null;
    if (raw.date !== null) {
      const parsed = new Date(raw.date);
      if (!Number.isNaN(parsed.getTime())) centralDate = parsed;
    }
    if (centralDate !== null) {
      // L'horloge est une mesure de plus : son échec n'invalide pas la réponse reçue.
      await this.clock.observeCentral(centralDate).catch(() => undefined);
    }
    let parsed: unknown = null;
    if (raw.text !== '') {
      try {
        parsed = JSON.parse(raw.text);
      } catch {
        parsed = undefined;
      }
    }
    if (raw.status >= 400 || raw.status < 200 || raw.status >= 300) {
      if (raw.status >= 400) throw errorFromResponse(raw.status, parsed);
      throw new CentralError('MALFORMED_RESPONSE', `statut inattendu ${raw.status}`, raw.status);
    }
    if (raw.status !== 200 || typeof parsed !== 'object' || parsed === null) {
      throw new CentralError('MALFORMED_RESPONSE', 'réponse de succès illisible', raw.status);
    }
    return { body: parsed as T, centralDate, status: raw.status };
  }

  private exchange(
    trust: Trust,
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions & { body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; text: string; date: string | null }> {
    return new Promise((resolve, reject) => {
      const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
      let settled = false;
      const timer: { handle?: NodeJS.Timeout } = {};
      const finish = (
        error: CentralError | null,
        value?: { status: number; text: string; date: string | null },
      ): void => {
        if (settled) return;
        settled = true;
        if (timer.handle) clearTimeout(timer.handle);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value!);
      };
      const req = httpsRequest(
        {
          protocol: 'https:',
          hostname: trust.baseUrl.hostname,
          port: trust.baseUrl.port === '' ? 443 : Number(trust.baseUrl.port),
          path: `${trust.baseUrl.pathname.replace(/\/$/, '')}${path}`,
          method,
          agent: false,
          ca: trust.ca,
          cert: trust.cert,
          key: trust.key,
          rejectUnauthorized: true,
          headers: {
            Accept: 'application/json',
            'X-Request-Id': randomUUID(),
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
              : {}),
            ...(options.headers ?? {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              finish(
                new CentralError(
                  'MALFORMED_RESPONSE',
                  'réponse trop grande',
                  res.statusCode ?? null,
                ),
              );
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            const declared = res.headers['content-length'];
            if (!res.complete || (declared !== undefined && Number(declared) !== body.length)) {
              finish(
                new CentralError('TRUNCATED_RESPONSE', 'réponse tronquée', res.statusCode ?? null),
              );
              return;
            }
            const date = res.headers.date;
            finish(null, {
              status: res.statusCode ?? 0,
              text: body.toString('utf8'),
              date: typeof date === 'string' ? date : null,
            });
          });
          const cut = (): void =>
            finish(
              new CentralError('TRUNCATED_RESPONSE', 'réponse tronquée', res.statusCode ?? null),
            );
          res.on('aborted', cut);
          res.on('error', cut);
          res.on('close', () => {
            if (!res.complete) cut();
          });
        },
      );
      const onAbort = (): void => {
        finish(new CentralError('ABORTED', 'requête annulée'));
        req.destroy();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer.handle = setTimeout(() => {
        finish(new CentralError('TIMEOUT', 'délai dépassé'));
        req.destroy();
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      req.on('error', (error: NodeJS.ErrnoException) => {
        const code = error.code ?? '';
        finish(
          PINNING_CODES.has(code)
            ? new CentralError('PINNING_FAILED', 'certificat du central différent de l’épinglage')
            : new CentralError(
                'NETWORK',
                `liaison avec le central impossible (${code || 'erreur'})`,
              ),
        );
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
