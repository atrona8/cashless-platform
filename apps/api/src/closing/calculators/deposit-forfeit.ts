// Étape 6 : cautions acquises (R-03) : supports `deposit_status = HELD`, un `DEPOSIT_FORFEITED` du moteur par support
// (fonction `forfeit_deposit`, clé interne `deposit-forfeit:<media>:<n>`).
import { amountJson } from '../closing-steps.dto';
import {
  big,
  closingCommand,
  notApplicable,
  type CalcResult,
  type ClosingCalculator,
  type ClosingContext,
} from './calculator';

export const depositForfeit: ClosingCalculator = {
  step: 'DEPOSIT_FORFEIT',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    const { rows } = await ctx.client.query<{ id: string; deposit_held: string }>(
      `SELECT m.id, m.deposit_held::text
         FROM media m JOIN wallet w ON w.id = m.wallet_id
        WHERE w.ledger_id = $1 AND m.deposit_status = 'HELD' ORDER BY m.id`,
      [ctx.ledgerId],
    );
    if (rows.length === 0) return notApplicable();
    const total = rows.reduce((sum, row) => sum + big(row.deposit_held), 0n);
    return {
      applicable: true,
      lines: [{ partyId: ctx.organizerId, label: 'Cautions acquises', amount: total }],
      total,
      commands: rows.map((row) =>
        closingCommand(
          ctx,
          'DEPOSIT_FORFEITED',
          `DEPOSIT_FORFEIT:${row.id}`,
          {},
          { mediaId: row.id },
        ),
      ),
      summary: { media: rows.length, total: amountJson(total) },
    };
  },
};
