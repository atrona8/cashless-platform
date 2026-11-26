// Seuil de la seconde personne du rendu partiel en espèces (mission 9c, WP04 ; FR-007, NFR-002 ; ADR-190, ADR-195).
// Module autonome : le guichet de retour garde son propre cumul. Le cumul est celui du PORTEFEUILLE (tous bracelets),
// du jour UTC courant, montant en cours compris. Le jour est borné par `recorded_at` (heure de la base), jamais par
// l'heure du terminal : `now` ne sert qu'à choisir le jour.
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';

/**
 * Somme BRUTE des rendus partiels du portefeuille depuis 00:00 UTC du jour de `now`, tous bracelets.
 * Brut = débits positifs du compte `WALLET_PAID` (un `WALLET_REFUND` en pousse deux : frais puis net).
 * Le prédicat sur `journal_transaction` reprend MOT POUR MOT celui de l'index partiel
 * `journal_transaction_partial_refund_idx` (migration 0100), dont `ledger_id` est la tête : le filtre `ledgerId`
 * est obligatoire pour que l'index serve. Une contre-passation (`REVERSAL`) ne vient pas en déduction (prudent).
 */
export async function partialRefundDayTotal(
  client: TxClient,
  walletId: string,
  now: Date,
  ledgerId: string,
): Promise<bigint> {
  const res = await client.query<{ total: string }>(
    `SELECT coalesce(sum(p.amount), 0)::text AS total
       FROM journal_transaction jt
       JOIN posting p ON p.ledger_id = jt.ledger_id AND p.transaction_id = jt.id
       JOIN account a ON a.id = p.account_id
      WHERE jt.ledger_id = $1
        AND jt.type = 'WALLET_REFUND' AND jt.metadata->>'partial_cash_refund' = 'true'
        AND jt.recorded_at >= date_trunc('day', $3::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND a.wallet_id = $2 AND a.purpose = 'WALLET_PAID' AND p.amount > 0`,
    [ledgerId, walletId, now.toISOString()],
  );
  return BigInt(res.rows[0]!.total);
}

/**
 * Décide la seconde personne : `dayTotal + amount > limit` (comparaison stricte). `limit = 0` : tout rendu exige un
 * jeton. L'APPELANT doit avoir pris `lockWalletPaidBalance` du portefeuille AVANT (ADR-195 ; ordre des verrous :
 * bracelet, puis portefeuilles) : cette fonction ne verrouille pas. Renvoie le valideur si un jeton était exigé et
 * consommé, `null` sinon ; lève `403 APPROVAL_REQUIRED` si exigé et `approve` est `null`.
 */
export async function requireApprovalOverDailyCumul(
  client: TxClient,
  input: { walletId: string; amount: bigint; limit: bigint; now: Date; ledgerId: string },
  approve: ((client: TxClient) => Promise<string>) | null,
): Promise<{ dayTotal: bigint; approvedBy: string | null }> {
  const dayTotal = await partialRefundDayTotal(client, input.walletId, input.now, input.ledgerId);
  if (dayTotal + input.amount <= input.limit) return { dayTotal, approvedBy: null };
  if (!approve) throw new ProblemException('APPROVAL_REQUIRED', { status: 403 });
  return { dayTotal, approvedBy: await approve(client) };
}
