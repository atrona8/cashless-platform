// Étape 5 : casse (R-03) : portefeuilles à solde payé ou espèces dues non nuls à l'échéance, partagés selon la
// destination du profil de législation. `NONE` : sans objet. `OPERATOR` est traité comme `ORGANIZER` (partage par
// `breakage_organizer_bps`, contradiction 4 de research.md).
import { amountJson } from '../closing-steps.dto';
import {
  big,
  builtLines,
  closingCommand,
  notApplicable,
  sumByPurpose,
  type CalcLine,
  type CalcResult,
  type ClosingCalculator,
  type ClosingContext,
} from './calculator';

/** Soldes disponibles (positifs = dus au festivalier) par portefeuille, pour des fonctions de compte données. */
export async function walletBalances(
  ctx: ClosingContext,
  purposes: readonly string[],
): Promise<Map<string, Record<string, bigint>>> {
  const { rows } = await ctx.client.query<{ wallet_id: string; purpose: string; balance: string }>(
    `SELECT a.wallet_id, a.purpose, (-ab.balance)::text AS balance
       FROM account a JOIN account_balance ab ON ab.account_id = a.id
      WHERE a.ledger_id = $1 AND a.purpose = ANY($2::text[]) AND a.wallet_id IS NOT NULL AND ab.balance <> 0
      ORDER BY a.wallet_id`,
    [ctx.ledgerId, purposes],
  );
  const result = new Map<string, Record<string, bigint>>();
  for (const row of rows) {
    const entry = result.get(row.wallet_id) ?? {};
    entry[row.purpose] = big(row.balance);
    result.set(row.wallet_id, entry);
  }
  return result;
}

export const breakage: ClosingCalculator = {
  step: 'BREAKAGE',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    if (ctx.config.breakageDestination === 'NONE') return notApplicable();
    const balances = await walletBalances(ctx, ['WALLET_PAID', 'CUSTOMER_CASH_DUE']);
    const wallets = [...balances.entries()]
      .map(([walletId, b]) => ({
        walletId,
        paid: (b.WALLET_PAID ?? 0n) > 0n ? b.WALLET_PAID! : 0n,
        cashDue: (b.CUSTOMER_CASH_DUE ?? 0n) > 0n ? b.CUSTOMER_CASH_DUE! : 0n,
      }))
      .filter((w) => w.paid > 0n || w.cashDue > 0n);
    if (wallets.length === 0) return notApplicable();
    const command = closingCommand(ctx, 'BREAKAGE', 'BREAKAGE', { wallets });
    const built = builtLines(command, ctx);
    const organizer = sumByPurpose(built, ['ORG_CASSE'], -1);
    const operator = sumByPurpose(built, ['OPE_CASSE'], -1);
    const legal = sumByPurpose(built, ['LEGAL_BREAKAGE'], -1);
    const lines: CalcLine[] = [];
    if (organizer > 0n)
      lines.push({
        partyId: ctx.organizerId,
        label: 'Casse, part de l’organisateur',
        amount: organizer,
      });
    if (operator > 0n)
      lines.push({
        partyId: ctx.operatorId,
        label: 'Casse, part du prestataire',
        amount: operator,
      });
    if (legal > 0n)
      lines.push({ partyId: ctx.organizerId, label: 'Casse, compte légal', amount: legal });
    const total = organizer + operator + legal;
    return {
      applicable: true,
      lines,
      total,
      commands: [command],
      summary: {
        wallets: wallets.length,
        destination: ctx.config.breakageDestination,
        total: amountJson(total),
      },
    };
  },
};
