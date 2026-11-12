// Corps brut de `POST /edge/sync-batches` et contrôles de forme (WP13, T057 ; OP-N95). Même
// principe que
// `offline/batches/batch-body.ts` : la limite globale du corps JSON reste 100 ko (elle répondrait
// `500`), et SEULE
// cette route lit son corps elle-même, jusqu'à 1 Mio, AVANT l'analyseur global. Aucun `JSON.parse`
// avant le contrôle
// de taille. La lecture n'a lieu que pour une connexion TLS dont le certificat client est reconnu
// par l'autorité des
// passerelles (filtre d'identité sans base) ; la garde `edgeMtls` refait tous les contrôles. Les
// numéros sont lus
// sur le texte source (refus au-delà de 2^53 - 1).
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX } from '../../config/config';
import { ProblemException } from '../../errors/problem';
import { gatedBody } from '../../offline/batches/body-gate';
import { parseWithSafeIntegers } from '../../offline/batches/raw-json';
import { peerFingerprint } from '../auth/edge-identity.service';

export const MAX_SYNC_BYTES = 1_048_576;
export const MAX_SYNC_OPERATIONS = 500;
/**
 * Marge de lecture au-delà de la limite (un corps plus gros reçoit `413`, un corps tronqué n'est
 * jamais lu).
 */
export const SYNC_HARD_CAP_BYTES = 4 * 1_048_576;

export interface EdgeSyncBodyRequest extends Request {
  edgeSyncRaw?: Buffer;
  edgeSyncTooLarge?: boolean;
}

const ROUTE = `/${API_PREFIX}/edge/sync-batches`;

export const isEdgeSyncRoute = (req: Request): boolean =>
  req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === ROUTE;

export function edgeSyncBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isEdgeSyncRoute(req)) return next();
  const request = req as EdgeSyncBodyRequest;
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  const finish = (tooLarge: boolean): void => {
    if (done) return;
    done = true;
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
    req.removeListener('error', onError);
    request.edgeSyncRaw = Buffer.concat(chunks, Math.min(size, SYNC_HARD_CAP_BYTES));
    request.edgeSyncTooLarge = tooLarge || size > MAX_SYNC_BYTES;
    request.body = {};
    delete req.headers['content-type'];
    next();
  };
  const onData = (chunk: Buffer): void => {
    const room = SYNC_HARD_CAP_BYTES - size;
    if (room > 0) chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += chunk.length;
    if (size >= SYNC_HARD_CAP_BYTES) finish(true);
  };
  const onEnd = (): void => finish(false);
  const onError = (): void => finish(false);
  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
}

/**
 * Filtre d'identité sans base : TLS, certificat de l'autorité des passerelles, dans sa validité.
 */
const tlsGate = (req: Request): Promise<boolean> =>
  Promise.resolve(!('refused' in peerFingerprint(req, new Date())));

/** À appeler avant l'initialisation de l'application, sur l'écouteur `edge` seulement. */
export function applyEdgeSyncBody(app: INestApplication): void {
  app.use(gatedBody(edgeSyncBodyMiddleware, isEdgeSyncRoute, tlsGate));
}

// -------------------------------------------------------------------------------------------------
// --- forme

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SEQ_FIELDS = [
  'epoch',
  'edge_seq',
  'edge_seq_from',
  'edge_seq_to',
  'seq',
  'seq_from',
  'seq_to',
  'reverses_seq',
] as const;
const MODES = ['EDGE_ONLINE', 'DEVICE_OFFLINE'];

export interface ParsedEdgeOp {
  raw: Record<string, unknown>;
  edgeSeq: bigint;
  deviceSerial: string;
  mode: 'EDGE_ONLINE' | 'DEVICE_OFFLINE';
  type: string;
  deviceBatchId: string | null;
}

export interface ParsedEdgeBatch {
  /** Lot tel que reçu : la signature et l'empreinte portent sur lui (JCS sans `signature`). */
  raw: Record<string, unknown>;
  batchId: string;
  gatewayId: string;
  ledgerId: string;
  epoch: bigint;
  from: bigint;
  to: bigint;
  prevChainHash: Buffer;
  lastChainHash: Buffer;
  operations: ParsedEdgeOp[];
  signature: string;
}

const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field} : UUID attendu.`);
  return value.toLowerCase();
}
function hex32(value: unknown, field: string): Buffer {
  if (typeof value !== 'string' || !HEX32.test(value)) throw invalid(`${field} : 32 octets hex.`);
  return Buffer.from(value, 'hex');
}
function safeInt(value: unknown, field: string, min = 0): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw invalid(`${field} : entier sûr d'au moins ${min} attendu.`);
  return BigInt(value);
}
function base64(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || !BASE64.test(value))
    throw invalid(`${field} : base64 attendu.`);
  return value;
}

/**
 * Taille d'abord (413), puis JSON (numéros sur le texte source), puis forme (422). Rien n'est
 * écrit.
 */
export function parseEdgeBatch(rawBody: Buffer | undefined, tooLarge: boolean): ParsedEdgeBatch {
  if (tooLarge || (rawBody !== undefined && rawBody.length > MAX_SYNC_BYTES))
    throw new ProblemException('BATCH_TOO_LARGE');
  if (rawBody === undefined || rawBody.length === 0) throw invalid('Corps manquant.');
  const parsed = parseWithSafeIntegers(rawBody.toString('utf8'), SEQ_FIELDS);
  if (!isObject(parsed)) throw invalid('Le corps doit être un objet.');
  const ops = parsed.operations;
  if (Array.isArray(ops) && ops.length > MAX_SYNC_OPERATIONS)
    throw new ProblemException('BATCH_TOO_LARGE');
  if (!Array.isArray(ops)) throw invalid('operations : tableau attendu (0 à 500 éléments).');
  // Lot sans opération (décision 50, ADR-187) : seulement s'il porte au moins un ordre local.
  const ordersOfBody = parsed.local_orders;
  if (ops.length === 0 && !(Array.isArray(ordersOfBody) && ordersOfBody.length > 0))
    throw invalid(
      'EMPTY_BATCH_WITHOUT_LOCAL_ORDERS : un lot sans opération doit porter au moins un local_orders.',
    );

  const from = safeInt(parsed.edge_seq_from, 'edge_seq_from', 1);
  // Intervalle vide d'un lot sans opération : `edge_seq_to = edge_seq_from - 1`, donc 0 possible.
  const to = safeInt(parsed.edge_seq_to, 'edge_seq_to', ops.length === 0 ? 0 : 1);
  const operations = ops.map((op, i): ParsedEdgeOp => {
    if (!isObject(op)) throw invalid(`operations/${i} : objet attendu.`);
    const mode = op.authorized_mode;
    if (typeof mode !== 'string' || !MODES.includes(mode))
      throw invalid(`operations/${i}/authorized_mode : EDGE_ONLINE ou DEVICE_OFFLINE.`);
    if (typeof op.device_serial !== 'string' || op.device_serial === '')
      throw invalid(`operations/${i}/device_serial : texte attendu.`);
    if (typeof op.type !== 'string') throw invalid(`operations/${i}/type : texte attendu.`);
    const batchId =
      op.device_batch_id === undefined ? null : uuid(op.device_batch_id, 'device_batch_id');
    return {
      raw: op,
      edgeSeq: safeInt(op.edge_seq, `operations/${i}/edge_seq`, 1),
      deviceSerial: op.device_serial,
      mode: mode as ParsedEdgeOp['mode'],
      type: op.type,
      deviceBatchId: batchId,
    };
  });
  for (const key of ['staff_token_audit', 'local_orders', 'device_batches'] as const) {
    const value = parsed[key];
    if (value !== undefined && !Array.isArray(value)) throw invalid(`${key} : tableau attendu.`);
  }
  if (((parsed.staff_token_audit as unknown[] | undefined) ?? []).length > 500)
    throw invalid('staff_token_audit : 500 lignes au plus.');
  const orders = (parsed.local_orders as unknown[] | undefined) ?? [];
  if (orders.length > 50) throw invalid('local_orders : 50 ordres au plus.');
  orders.forEach((order, i) => {
    if (
      !isObject(order) ||
      !['LOCAL_UNSTALE', 'PURGE'].includes(String(order.type)) ||
      !Array.isArray(order.holders) ||
      order.holders.length !== 2 ||
      order.holders.some((h) => typeof h !== 'string' || h === '') ||
      typeof order.at !== 'string'
    )
      throw invalid(`local_orders/${i} : forme invalide.`);
    uuid(order.gateway_id, `local_orders/${i}/gateway_id`);
    hex32(order.order_sha256, `local_orders/${i}/order_sha256`);
  });
  for (const [i, entry] of ((parsed.device_batches as unknown[] | undefined) ?? []).entries()) {
    if (!isObject(entry) || !isObject(entry.header))
      throw invalid(`device_batches/${i} : en-tête et signature attendus.`);
    base64(entry.signature, `device_batches/${i}/signature`);
  }
  return {
    raw: parsed,
    batchId: uuid(parsed.batch_id, 'batch_id'),
    gatewayId: uuid(parsed.edge_gateway_id, 'edge_gateway_id'),
    ledgerId: uuid(parsed.ledger_id, 'ledger_id'),
    epoch: safeInt(parsed.epoch, 'epoch', 0),
    from,
    to,
    prevChainHash: hex32(parsed.prev_chain_hash, 'prev_chain_hash'),
    lastChainHash: hex32(parsed.last_chain_hash, 'last_chain_hash'),
    operations,
    signature: base64(parsed.signature, 'signature'),
  };
}
