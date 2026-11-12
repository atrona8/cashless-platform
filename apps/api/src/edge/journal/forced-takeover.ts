// Reprise forcée vue du journal d'un terminal (mission 8, lot WP14 ; research R-23, décision 4 du porteur).
// Lectures seules, sous RLS, par `cashless_app` : `device`, `edge_gateway`, `debit_authority_handover`,
// `journal_transaction`, `edge_sync_registry`, `api_idempotency`. Rien n'est déduit d'une valeur du terminal, hors
// la date de l'opération (borne 3) qui ne peut qu'ajouter une anomalie, jamais en retirer.
import type { TxClient } from '../../db/tenant-tx';

/** Tolérance sur la date déclarée par le terminal (même valeur que la conformité : 2 minutes). */
const TOLERANCE_SECONDS = 120;

export interface ForcedTakeover {
  /** Bascule `TO_EDGE` forcée (identifiant du lot de reprise pour regrouper les anomalies). */
  handoverId: string;
  gatewayId: string;
}

/**
 * Critères 2 et 3 de R-23. (2) l'événement du terminal a une passerelle `REVOKED` dont une bascule `TO_EDGE` du grand
 * livre est `FORCED` ET a été accusée (`edge_seq_at_activation` posé : une reprise forcée juste après `GRANTED`, avant
 * l'accusé, n'a laissé aucune opération de passerelle) ; (3) l'opération date d'après l'accord de cette bascule ET d'avant sa fin (passage à `FORCED`,
 * `completed_at`), à la tolérance près de chaque côté (OP-N117). `occurredAt` nul ou illisible : la borne ne peut pas jouer, elle ne retire donc rien.
 */
export async function findForcedTakeover(
  client: TxClient,
  ctx: { deviceId: string; ledgerId: string },
  occurredAt: Date | null,
): Promise<ForcedTakeover | null> {
  const { rows } = await client.query<{ handover_id: string; gateway_id: string }>(
    `SELECT h.id AS handover_id, g.id AS gateway_id
       FROM device d
       JOIN edge_gateway g ON g.event_id = d.event_id AND g.status = 'REVOKED'
       JOIN debit_authority_handover h
         ON h.edge_gateway_id = g.id AND h.ledger_id = $2 AND h.direction = 'TO_EDGE'
        AND h.status = 'FORCED' AND h.edge_seq_at_activation IS NOT NULL
      WHERE d.id = $1
        AND ($3::timestamptz IS NULL
             OR ($3::timestamptz >= h.requested_at - make_interval(secs => $4)
                 -- Borne haute (OP-N117) : fin de la reprise (passage à FORCED, completed_at posé par la base).
                 -- Une opération postérieure au retour du central n'est pas une perte de la passerelle.
                 AND (h.completed_at IS NULL
                      OR $3::timestamptz <= h.completed_at + make_interval(secs => $4))))
      ORDER BY h.requested_at DESC, h.id
      LIMIT 1`,
    [ctx.deviceId, ctx.ledgerId, occurredAt, TOLERANCE_SECONDS],
  );
  const r = rows[0];
  return r ? { handoverId: r.handover_id, gatewayId: r.gateway_id } : null;
}

/**
 * Critère 1 de R-23 : parmi `keys`, une clé d'origine est-elle déjà connue du central ? Trois registres : le journal
 * (écriture en ligne ou `EDGE_SYNC`), le registre `EDGE_SYNC` de n'importe quelle passerelle du prestataire (même
 * rejeu refusé : il a déjà son anomalie), et le registre d'idempotence de la route en ligne du terminal (terminée en 2xx).
 */
export async function originKeyKnown(
  client: TxClient,
  ctx: { deviceId: string; ledgerId: string; operatorId: string },
  keys: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ known: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM journal_transaction t
                     WHERE t.ledger_id = $1 AND t.idempotency_key = ANY($3::text[]))
         OR EXISTS (SELECT 1 FROM edge_sync_registry r
                     WHERE r.operator_id = $2 AND r.origin_key = ANY($3::text[]))
         OR EXISTS (SELECT 1 FROM api_idempotency a
                     WHERE a.operator_id = $2 AND a.scope = $4 AND a.idempotency_key = ANY($3::text[])
                       AND a.status = 'COMPLETED' AND a.response_status BETWEEN 200 AND 299) AS known`,
    [ctx.ledgerId, ctx.operatorId, [...keys], `device:${ctx.deviceId}:`],
  );
  return rows[0]!.known;
}
