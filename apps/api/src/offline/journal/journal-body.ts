// Corps brut de `POST /devices/{device_id}/journal-imports` (mission 7, lot WP20, T084 ; même schéma que
// `batches/batch-body.ts`, WP18). La limite globale du corps JSON reste 100 ko ; SEULE cette route lit son corps
// elle-même, avant l'analyseur global, pour garder le TEXTE SOURCE (les numéros se contrôlent sur le texte, jamais
// après `JSON.parse`).
//
// Limite choisie : 20 lots de 1 Mio au plus (MAX_BATCH_BYTES, 20 lots au plus par import) plus 64 Kio d'enveloppe
// (motif, accolades) = 21 037 056 octets. Au-delà, `413 BATCH_TOO_LARGE` avant tout JSON.parse. Lecture arrêtée à
// cette limite plus 1 Mio de marge (le corps gardé est alors tronqué, jamais analysé).
//
// Cycle 2 : l'identité (jeton, rôle SUPERVISOR) est vérifiée avant toute lecture (`batches/body-gate.ts`).
// Prudence : la route n'est reprise que si la requête porte un en-tête `Authorization` (une requête anonyme reste
// au analyseur global, 100 ko, puis à la garde d'identité qui la refuse en `401`) ; le corps n'est jamais lu pour un
// inconnu. `req.body` reçoit l'empreinte SHA-256 des octets : la table d'idempotence (empreinte de requête) garde
// ainsi la protection « même clé, autre corps = IDEMPOTENCY_KEY_REUSED » sans relire 20 Mio.
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX } from '../../config/config';
import { MAX_BATCH_BYTES } from '../batches/batch.types';

export interface JournalBodyRequest extends Request {
  rawBody?: Buffer;
  journalBodyTooLarge?: boolean;
}

export const MAX_IMPORT_BATCHES = 20;
export const ENVELOPE_BYTES = 64 * 1024;
/** Limite d'un corps d'import : 20 lots de 1 Mio plus l'enveloppe. */
export const MAX_IMPORT_BYTES = MAX_IMPORT_BATCHES * MAX_BATCH_BYTES + ENVELOPE_BYTES;
/** Marge de lecture au-delà de la limite. */
export const IMPORT_HARD_CAP_BYTES = MAX_IMPORT_BYTES + 1_048_576;

const ROUTE = new RegExp(`^/${API_PREFIX}/devices/[^/]+/journal-imports/?$`, 'i');

export const isImportRoute = (req: Request): boolean =>
  req.method === 'POST' && ROUTE.test(req.path);

export function journalBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isImportRoute(req) || !req.headers.authorization) return next();
  const request = req as JournalBodyRequest;
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  const finish = (tooLarge: boolean): void => {
    if (done) return;
    done = true;
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
    req.removeListener('error', onError);
    const kept = Buffer.concat(chunks, Math.min(size, IMPORT_HARD_CAP_BYTES));
    request.rawBody = kept;
    request.journalBodyTooLarge = tooLarge || size > MAX_IMPORT_BYTES;
    request.body = { raw_sha256: createHash('sha256').update(kept).digest('hex') };
    delete req.headers['content-type'];
    next();
  };
  const onData = (chunk: Buffer): void => {
    const room = IMPORT_HARD_CAP_BYTES - size;
    if (room > 0) chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += chunk.length;
    if (size >= IMPORT_HARD_CAP_BYTES) finish(true);
  };
  const onEnd = (): void => finish(false);
  const onError = (): void => finish(false);
  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
}
