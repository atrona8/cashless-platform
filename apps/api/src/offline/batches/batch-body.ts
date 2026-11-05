// Corps brut de `POST /offline-batches` (mission 7, lot WP18 ; décision de l'orchestrateur du 30/10/2026).
// La limite globale du corps JSON reste 100 ko (analyseur de Nest) ; SEULE cette route lit son corps elle-même, avec
// sa limite de 1 048 576 octets (contrôle 1 de `batches.md`), montée AVANT l'analyseur global. Elle garde les octets
// bruts dans `req.rawBody` (la garde du terminal vérifie `Content-Digest` dessus), retire `content-type` pour que l'analyseur global
// ne la lise pas, et ne fait AUCUN `JSON.parse` : le contrôleur le fait après la taille.
//
// On garde au plus `HARD_CAP_BYTES` (4 Mio) : un corps de plus de 1 Mio mais dans cette marge est lu en entier (la
// garde vérifie `Content-Digest` dessus) et reçoit `413 BATCH_TOO_LARGE` du contrôleur AVANT tout `JSON.parse`. Au-delà
// de la marge, la lecture s'arrête, le corps gardé est tronqué : l'empreinte ne concorde plus et la garde du terminal
// refuse avant le contrôleur. Dans les deux cas, l'analyseur global n'est pas appelé (`content-type` retiré).
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX } from '../../config/config';
import { isImportRoute, journalBodyMiddleware } from '../journal/journal-body';
import { MAX_BATCH_BYTES } from './batch.types';
import { deviceBodyGate, gatedBody, staffBodyGate } from './body-gate';

export interface BatchBodyRequest extends Request {
  rawBody?: Buffer;
  batchBodyTooLarge?: boolean;
}

/** Marge de lecture au-delà de la limite de 1 Mio (voir l'en-tête). */
export const HARD_CAP_BYTES = 4 * 1_048_576;

const ROUTE = `/${API_PREFIX}/offline-batches`;

export const isBatchRoute = (req: Request): boolean =>
  req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === ROUTE;

export function batchBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isBatchRoute(req)) return next();
  const request = req as BatchBodyRequest;
  const limit = HARD_CAP_BYTES;
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  const finish = (tooLarge: boolean): void => {
    if (done) return;
    done = true;
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
    req.removeListener('error', onError);
    request.rawBody = Buffer.concat(chunks, Math.min(size, limit));
    request.batchBodyTooLarge = tooLarge || size > MAX_BATCH_BYTES;
    request.body = {};
    delete req.headers['content-type'];
    next();
  };
  const onData = (chunk: Buffer): void => {
    const room = limit - size;
    if (room > 0) chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += chunk.length;
    if (size >= limit) finish(true);
  };
  const onEnd = (): void => finish(false);
  const onError = (): void => finish(false);
  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
}

/** À appeler avant l'initialisation de l'application (avant l'analyseur global de Nest). */
export function applyBatchBody(app: INestApplication): void {
  // Cycle 2 de WP20 : l'identité est vérifiée AVANT de lire le corps (`body-gate.ts`).
  app.use(gatedBody(batchBodyMiddleware, isBatchRoute, deviceBodyGate(app)));
  // WP20 : `POST /devices/{id}/journal-imports` a sa propre limite (20 lots de 1 Mio), même principe ; le rôle
  // `SUPERVISOR` est aussi exigé avant la lecture.
  app.use(gatedBody(journalBodyMiddleware, isImportRoute, staffBodyGate(app, ['SUPERVISOR'])));
}
