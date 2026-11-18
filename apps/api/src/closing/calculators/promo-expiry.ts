// Étape 7 : expiration des crédits offerts (R-03) : un `PROMO_EXPIRY` par portefeuille à solde offert non nul.
import { amountJson } from '../closing-steps.dto';
import {
  closingCommand,
  notApplicable,
  type CalcResult,
  type ClosingCalculator,
  type ClosingContext,
} from './calculator';
import { walletBalances } from './breakage';

export const promoExpiry: ClosingCalculator = {
  step: 'PROMO_EXPIRY',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    const balances = await walletBalances(ctx, ['WALLET_PROMO']);
    const due = [...balances.entries()]
      .map(([walletId, b]) => ({ walletId, amount: b.WALLET_PROMO ?? 0n }))
      .filter((w) => w.amount > 0n);
    if (due.length === 0) return notApplicable();
    const total = due.reduce((sum, w) => sum + w.amount, 0n);
    return {
      applicable: true,
      lines: [{ partyId: ctx.organizerId, label: 'Crédits offerts expirés', amount: total }],
      total,
      commands: due.map((w) =>
        closingCommand(ctx, 'PROMO_EXPIRY', `PROMO_EXPIRY:${w.walletId}`, w),
      ),
      summary: { wallets: due.length, total: amountJson(total) },
    };
  },
};
