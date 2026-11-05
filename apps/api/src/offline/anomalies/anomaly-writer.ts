// Écrivain d'anomalies de la mission 7 (R-17 ; contracts/interfaces.md §5). Seule voie d'écriture : la
// fonction `open_offline_anomaly` de la base (idempotente par (kind, device, seq, tx), NULL égaux). Aucun
// INSERT direct sur `anomaly`, aucun type libre : l'union `OfflineAnomalyKind` est fermée.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';

export const OFFLINE_ANOMALY_KINDS = [
  'OFFLINE_SHORTFALL',
  'SEQ_GAP',
  'CHAIN_BROKEN',
  'CLOCK_SKEW',
  'SIGNATURE_MISMATCH',
  'NON_COMPLIANT_OPERATION',
  'PERIOD_CLOSED_OPERATION',
  'LATE_OFFLINE_SYNC',
  'IDEMPOTENCY_CONFLICT',
  'VOID_CONFLICT',
  'ONLINE_CONFIRMED_MISSING',
] as const;
export type OfflineAnomalyKind = (typeof OFFLINE_ANOMALY_KINDS)[number];

export interface AnomalyInput {
  ledgerId: string;
  kind: OfflineAnomalyKind;
  deviceId?: string;
  mediaId?: string;
  seq?: bigint;
  transactionId?: string;
  /** Défaut 0n. */
  amount?: bigint;
  lossBearer?: string;
  detail?: unknown;
  batchId?: string;
}

/** Ouvre (ou retrouve) l'anomalie ; rend son identifiant (uuid). `seq` et `amount` passent en texte. */
export async function openAnomaly(client: TxClient, input: AnomalyInput): Promise<string> {
  if (!(OFFLINE_ANOMALY_KINDS as readonly string[]).includes(input.kind))
    throw new Error(`openAnomaly : type inconnu ${String(input.kind)}`);
  const { rows } = await client.query<{ id: string }>(
    `SELECT open_offline_anomaly($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) AS id`,
    [
      input.ledgerId,
      input.kind,
      input.deviceId ?? null,
      input.mediaId ?? null,
      input.seq === undefined ? null : input.seq.toString(),
      input.transactionId ?? null,
      (input.amount ?? 0n).toString(),
      input.lossBearer ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      input.batchId ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * Réduit un manque hors ligne par une annulation. À n'appeler que depuis le chemin d'annulation, avec la VRAIE
 * transaction d'annulation : la base ne vérifie pas que `reversalTx` annule `originalTx`.
 */
export async function reduceShortfall(
  client: TxClient,
  originalTx: string,
  amount: bigint,
  reversalTx: string,
): Promise<void> {
  await client.query('SELECT reduce_offline_shortfall($1, $2, $3)', [
    originalTx,
    amount.toString(),
    reversalTx,
  ]);
}

@Injectable()
export class AnomalyWriter {
  open(client: TxClient, input: AnomalyInput): Promise<string> {
    return openAnomaly(client, input);
  }

  reduceShortfall(
    client: TxClient,
    originalTx: string,
    amount: bigint,
    reversalTx: string,
  ): Promise<void> {
    return reduceShortfall(client, originalTx, amount, reversalTx);
  }
}
