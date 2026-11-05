// Une annulation d'une vente hors ligne rend aussi la part en attente (`S-ATTENTE`) : l'anomalie `OFFLINE_SHORTFALL`
// de la vente est réduite d'autant, par `reduce_offline_shortfall` avec la VRAIE transaction d'annulation (la base ne
// vérifie pas que `reversalTx` annule `originalTx`). Appelée par l'annulation hors ligne (WP19) et par l'annulation en
// ligne (`reversals/reversal.service.ts`, retouche hors carte de WP19).
import type { TxClient } from '../../db/tenant-tx';
import { reduceShortfall } from '../anomalies/anomaly-writer';

/** Part de la vente portée au compte d'attente (somme des lignes `SUSPENSE`), 0 si tout était couvert. */
export async function suspensePart(client: TxClient, originalTx: string): Promise<bigint> {
  const { rows } = await client.query<{ s: string }>(
    `SELECT coalesce(sum(p.amount), 0)::text AS s
       FROM posting p JOIN account a ON a.id = p.account_id
      WHERE p.transaction_id = $1 AND a.purpose = 'SUSPENSE'`,
    [originalTx],
  );
  return BigInt(rows[0]!.s);
}

/**
 * Réduit l'anomalie ouverte de la vente de la part en attente qu'une annulation vient de rendre. Sans part en attente
 * ou sans anomalie ouverte (déjà soldée), ne fait rien. Rend le montant réduit.
 */
export async function reduceShortfallOfReversedSale(
  client: TxClient,
  originalTx: string,
  reversalTx: string,
): Promise<bigint> {
  const part = await suspensePart(client, originalTx);
  if (part <= 0n) return 0n;
  const { rows } = await client.query<{ amount: string }>(
    `SELECT amount::text FROM anomaly
      WHERE kind = 'OFFLINE_SHORTFALL' AND transaction_id = $1 AND status = 'OPEN'
      ORDER BY created_at LIMIT 1`,
    [originalTx],
  );
  if (!rows[0]) return 0n;
  const open = BigInt(rows[0].amount);
  const amount = part < open ? part : open;
  if (amount <= 0n) return 0n;
  await reduceShortfall(client, originalTx, amount, reversalTx);
  return amount;
}
