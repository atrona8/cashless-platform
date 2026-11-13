// Fabrication de l'anomalie `EDGE_REPLAY_FAILED` d'une opération du journal d'un terminal non rejouée (mission 8,
// lot WP14 ; R-23). Champs communs de T063 (`ONLINE_REF` inconnue) et T064 (`TOPUP_CASH`).
//
// Écriture par `open_offline_anomaly` (migration 0068, décision 46 du porteur) : aucun INSERT direct dans `anomaly`. La
// fonction est idempotente par (prestataire, clé d'origine), avec le verrou de `edge_open_replay_failed` (0062).
import type { TxClient } from '../../db/tenant-tx';

export interface EdgeReplayAnomalyInput {
  operatorId: string;
  ledgerId: string;
  deviceId: string;
  seq: bigint;
  batchId: string;
  originKey: string;
  gatewayId: string;
  /** Lot de reprise : la bascule forcée, pour résoudre les anomalies ensemble. */
  recoveryId: string;
  mediaId: string | null;
  /** Montant déclaré de la caution ; `null` : inconnu (jamais deviné, montant nul et détail explicite). */
  amount: bigint | null;
  lossBearer: string;
  operation: string;
}

/** Ouvre (ou retrouve) l'anomalie ; rend son identifiant. Ne porte ni contenu d'opération ni secret de bracelet. */
export async function openEdgeReplayAnomaly(
  client: TxClient,
  input: EdgeReplayAnomalyInput,
): Promise<string> {
  const detail = {
    source: 'DEVICE_JOURNAL',
    edge_gateway_id: input.gatewayId,
    recovery_id: input.recoveryId,
    origin_key: input.originKey,
    operation: input.operation,
    code: 'OPERATION_NOT_REPLAYED',
    message:
      input.amount === null
        ? 'montant inconnu : opération du journal jamais rejouée par la passerelle'
        : 'opération du journal jamais rejouée par la passerelle',
    amount_known: input.amount !== null,
  };
  const { rows } = await client.query<{ id: string }>(
    `SELECT open_offline_anomaly($1, 'EDGE_REPLAY_FAILED', $2, $3, $4::bigint, NULL, $5::bigint, $6, $7::jsonb, $8)
       AS id`,
    [
      input.ledgerId,
      input.deviceId,
      input.mediaId,
      input.seq.toString(),
      (input.amount ?? 0n).toString(),
      input.lossBearer,
      JSON.stringify(detail),
      input.batchId,
    ],
  );
  return rows[0]!.id;
}
