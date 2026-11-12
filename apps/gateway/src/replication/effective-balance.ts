// Solde effectif = solde central répliqué + deltas locaux d'`edge_seq > applied_edge_seq` (B.3).
// Aucune arithmétique propre : la fonction partagée, puis un plancher à zéro.
import { effectiveBalance as sharedEffectiveBalance } from '@cashless/shared-rules';
import type { TxClient } from '../db/gateway-tx';

export interface Balance {
  paid: bigint;
  promo: bigint;
}

export async function readEffectiveBalance(tx: TxClient, walletId: string): Promise<Balance> {
  const wallet = await tx.query<{ central_paid: string; central_promo: string; applied: string }>(
    `SELECT central_paid, central_promo, applied_edge_seq AS applied
       FROM edge_wallet WHERE wallet_id = $1`,
    [walletId],
  );
  const row = wallet.rows[0];
  if (!row) return { paid: 0n, promo: 0n };
  const deltas = await tx.query<{ paid_delta: string; promo_delta: string }>(
    `SELECT paid_delta, promo_delta FROM edge_op_delta
      WHERE wallet_id = $1 AND edge_seq > $2`,
    [walletId, row.applied],
  );
  const result = sharedEffectiveBalance(
    { paid: BigInt(row.central_paid), promo: BigInt(row.central_promo) },
    deltas.rows.map((d) => ({ paid: BigInt(d.paid_delta), promo: BigInt(d.promo_delta) })),
  );
  return {
    paid: result.paid < 0n ? 0n : result.paid,
    promo: result.promo < 0n ? 0n : result.promo,
  };
}
