// Magasin d'idempotence applicatif (S21, table api_idempotency, contracts/idempotency.md, research R-05).
//
// Choix documenté (FR-024) : une clé COMPLETED n'est jamais réutilisée, même après `expires_at`. La garde de la table
// interdit COMPLETED → IN_PROGRESS et rend l'identité de la requête immuable ; « traiter la clé comme neuve » exigerait
// une suppression, refusée au rôle applicatif. Une clé COMPLETED expirée rejoue donc sa réponse (même empreinte) ou
// répond IDEMPOTENCY_KEY_REUSED (autre empreinte) ; la purge planifiée future supprimera les lignes expirées.
import { Inject, Injectable } from '@nestjs/common';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

export interface IdempotencySettings {
  /** Bail d'une exécution en cours (= transaction_timeout du rôle). */
  leaseSeconds: number;
  /** Durée de vie d'une clé (`IDEMPOTENCY_TTL_HOURS`, 30 jours par défaut : contrat, ADR-79). */
  ttlHours: number;
}

export const IDEMPOTENCY_SETTINGS = Symbol('IDEMPOTENCY_SETTINGS');

/** 30 jours : « conservée au moins 30 jours » (openapi.yaml, paramètre IdempotencyKey ; ADR-79). */
export const DEFAULT_TTL_HOURS = 720;

export function loadIdempotencySettings(env: NodeJS.ProcessEnv = process.env): IdempotencySettings {
  const raw = env.IDEMPOTENCY_TTL_HOURS;
  const ttlHours = raw === undefined || raw === '' ? DEFAULT_TTL_HOURS : Number.parseInt(raw, 10);
  if (!Number.isInteger(ttlHours) || ttlHours <= 0) {
    throw new Error(`IDEMPOTENCY_TTL_HOURS : entier positif attendu (reçu « ${raw} »)`);
  }
  return { leaseSeconds: 60, ttlHours };
}

/** Exécution réservée : `leaseToken` (valeur exacte de `lease_until`) prouve que le bail n'a pas été repris. */
export interface Reservation {
  id: string;
  operatorId: string;
  leaseToken: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export type ReserveOutcome = { kind: 'execute'; reservation: Reservation } | { kind: 'replay'; response: StoredResponse };

/** Le bail a expiré et une autre requête a repris la clé : cette exécution ne doit rien enregistrer. */
export class LeaseLostError extends ProblemException {
  constructor() {
    super('IDEMPOTENCY_KEY_IN_PROGRESS');
  }
}

interface ExistingRow {
  id: string;
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  lease_expired: boolean | null;
  response_status: number | null;
  response_body: unknown;
  response_headers: Record<string, string> | null;
}

@Injectable()
export class IdempotencyRepository {
  constructor(
    private readonly tx: TenantTx,
    @Inject(IDEMPOTENCY_SETTINGS) private readonly settings: IdempotencySettings,
  ) {}

  /** Transaction 1 (courte) : réserve la clé, ou décide du rejeu / du refus. */
  reserve(operatorId: string, scope: string, key: string, hash: string): Promise<ReserveOutcome> {
    return this.tx.run(operatorId, async (client) => {
      const inserted = await client.query<{ id: string; lease_token: string }>(
        `INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, lease_until, expires_at)
         VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + make_interval(secs => $5), now() + make_interval(hours => $6))
         ON CONFLICT (operator_id, scope, idempotency_key) DO NOTHING
         RETURNING id, lease_until::text AS lease_token`,
        [operatorId, scope, key, hash, this.settings.leaseSeconds, this.settings.ttlHours],
      );
      const created = inserted.rows[0];
      if (created) return execute(created.id, operatorId, created.lease_token);

      const existing = await client.query<ExistingRow>(
        `SELECT id, request_hash, status, lease_until <= now() AS lease_expired,
                response_status, response_body, response_headers
           FROM api_idempotency
          WHERE operator_id = $1 AND scope = $2 AND idempotency_key = $3
            FOR UPDATE`,
        [operatorId, scope, key],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('api_idempotency : ligne absente après conflit d’unicité');
      if (row.request_hash !== hash) throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
      if (row.status === 'COMPLETED') {
        return {
          kind: 'replay',
          response: { status: row.response_status ?? 200, body: row.response_body, headers: row.response_headers ?? {} },
        };
      }
      if (!row.lease_expired) throw new ProblemException('IDEMPOTENCY_KEY_IN_PROGRESS');
      // IN_PROGRESS dont le bail est échu (panne, ou 5xx relâché) : reprise avec un nouveau bail.
      const resumed = await client.query<{ lease_token: string }>(
        `UPDATE api_idempotency SET lease_until = now() + make_interval(secs => $2)
          WHERE id = $1 RETURNING lease_until::text AS lease_token`,
        [row.id, this.settings.leaseSeconds],
      );
      return execute(row.id, operatorId, resumed.rows[0]!.lease_token);
    });
  }

  /** Enregistre la réponse avec le client de la transaction métier (transaction 2) : validées ensemble ou pas du tout. */
  async complete(client: TxClient, reservation: Reservation, response: StoredResponse): Promise<void> {
    const updated = await client.query(
      `UPDATE api_idempotency
          SET status = 'COMPLETED', lease_until = NULL, completed_at = now(),
              response_status = $3, response_body = $4::jsonb, response_headers = $5::jsonb
        WHERE id = $1 AND status = 'IN_PROGRESS' AND lease_until = $2::timestamptz`,
      [
        reservation.id,
        reservation.leaseToken,
        response.status,
        response.body === undefined ? null : JSON.stringify(response.body),
        JSON.stringify(response.headers),
      ],
    );
    if (updated.rowCount !== 1) throw new LeaseLostError();
  }

  /** Enregistre une réponse dans une transaction propre (erreur 4xx : la transaction métier a été annulée). */
  completeAlone(reservation: Reservation, response: StoredResponse): Promise<void> {
    return this.tx.run(reservation.operatorId, (client) => this.complete(client, reservation, response));
  }

  /** Erreur 5xx : bail remis à maintenant, la même clé peut être rejouée tout de suite. */
  async release(reservation: Reservation): Promise<void> {
    await this.tx.run(reservation.operatorId, (client) =>
      client.query(
        `UPDATE api_idempotency SET lease_until = now()
          WHERE id = $1 AND status = 'IN_PROGRESS' AND lease_until = $2::timestamptz`,
        [reservation.id, reservation.leaseToken],
      ),
    );
  }
}

function execute(id: string, operatorId: string, leaseToken: string): ReserveOutcome {
  return { kind: 'execute', reservation: { id, operatorId, leaseToken } };
}
