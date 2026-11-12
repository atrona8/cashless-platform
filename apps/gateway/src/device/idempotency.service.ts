// Idempotence locale des opérations de terminal (NFR-003 ; contracts/gateway-served-operations.md,
// « Idempotence »). `edge_idempotency (device_id, idempotency_key)` : même clé et même empreinte
// de requête -> même réponse rendue, sans nouvel effet ; même clé et autre empreinte ->
// `IDEMPOTENCY_KEY_REUSED` (statut du contrat : 409, `PROBLEM_STATUSES`; le prompt du lot disait
// 422, contradiction signalée, le contrat prévaut). Jamais une réponse rendue à un autre terminal
// (la clé est liée à `device_id`).
//
// Fournit aux lots 21 à 23 : `lookup(tx, ...)` et `record(tx, ...)`, appelés DANS la transaction de
// l'opération, qui écrit aussi l'entrée de file : le registre et l'effet réussissent ou échouent
// ensemble. `lookup` prend un verrou de transaction sur (terminal, clé) : deux requêtes
// simultanées portant la même clé s'exécutent l'une après l'autre.
//
// L'empreinte est un SHA-256 simple (la passerelle ne détient aucun secret applicatif pour un
// HMAC) : elle porte l'identité du terminal, la méthode et le chemin ; le corps y entre en JCS.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import type { TxClient } from '../db/gateway-tx';
import { ProblemException } from '../device-proofs/problem';

export type IdempotencyLookup =
  | { hit: false }
  | { hit: true; statusCode: number; response: unknown; edgeSeq: number | null };

/** Empreinte d'une requête : méthode, chemin concret (sans la chaîne de requête), terminal, corps. */
export function requestFingerprint(
  method: string,
  path: string,
  deviceId: string,
  body: unknown,
): Buffer {
  const canonicalBody = body === undefined || body === '' ? 'null' : (canonicalize(body) ?? 'null');
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path}\n${deviceId}\n${canonicalBody}`, 'utf8')
    .digest();
}

@Injectable()
export class IdempotencyService {
  async lookup(
    tx: TxClient,
    deviceId: string,
    key: string,
    fingerprint: Buffer,
  ): Promise<IdempotencyLookup> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 19))', [
      `${deviceId}:${key}`,
    ]);
    const { rows } = await tx.query<{
      request_sha256: Buffer;
      status_code: number;
      response: unknown;
      edge_seq: string | null;
    }>(
      `SELECT request_sha256, status_code, response, edge_seq
         FROM edge_idempotency WHERE device_id = $1 AND idempotency_key = $2`,
      [deviceId, key],
    );
    const row = rows[0];
    if (!row) return { hit: false };
    if (!row.request_sha256.equals(fingerprint))
      throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
    return {
      hit: true,
      statusCode: row.status_code,
      response: row.response,
      edgeSeq: row.edge_seq === null ? null : Number(row.edge_seq),
    };
  }

  /** À appeler après `lookup` (verrou pris), dans la même transaction que l'effet. */
  async record(
    tx: TxClient,
    entry: {
      deviceId: string;
      key: string;
      fingerprint: Buffer;
      statusCode: number;
      response: unknown;
      edgeSeq?: number | null;
      /** Décision interne d'une vente (`edge_idempotency.sale`), écrite avec la ligne. */
      sale?: unknown;
      at: Date;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO edge_idempotency
         (device_id, idempotency_key, request_sha256, status_code, response, edge_seq, created_at,
          sale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        entry.deviceId,
        entry.key,
        entry.fingerprint,
        entry.statusCode,
        entry.response === undefined ? null : JSON.stringify(entry.response),
        entry.edgeSeq ?? null,
        entry.at,
        entry.sale === undefined ? null : JSON.stringify(entry.sale),
      ],
    );
  }
}
