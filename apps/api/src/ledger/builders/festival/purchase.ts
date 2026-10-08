// PURCHASE (vente en ligne ou hors ligne synchronisée) — SPECIFICATION §5.4, cas 13, 14, 19.
import { extractTax, fee, InsufficientFundsError, spendSplit, type SpendSplit } from '../../money';
import { BuildError, merchant, partyAccounts, suspense, wallet, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, push, requireId, requirePositive } from './lines';

export interface PurchasePayload {
  walletId: string;
  participationId: string;
  amount: bigint;
}

export function buildPurchase(command: LedgerCommand<'PURCHASE', PurchasePayload>, ctx: BuildContext): Line[] {
  const { walletId, participationId, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requireId(participationId, 'participation');
  requirePositive(amount, 'vente');
  const { config, balances } = ctx;
  if (!balances) throw new BuildError('VALIDATION_FAILED', 'vente : soldes du portefeuille non fournis');
  const { org } = partyAccounts(config);

  let split: SpendSplit;
  try {
    split = spendSplit({
      amount,
      promoBalance: balances.promo,
      paidBalance: balances.paid,
      promoFirst: config.spendOrder === 'PROMO_FIRST',
      mode: command.source === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) throw new BuildError('INSUFFICIENT_FUNDS', 'vente : solde insuffisant');
    throw error;
  }

  const lines: Line[] = [];
  push(lines, wallet(walletId, 'X'), split.fromPromo);
  push(lines, wallet(walletId, 'P'), split.fromPaid);
  // Hors ligne : la part non couverte va au compte d'attente, le commerçant reste garanti.
  push(lines, suspense(), split.uncovered);
  push(lines, merchant(participationId), -amount);
  const commission = fee(amount, config.commissions[participationId] ?? {});
  if (commission > 0n) {
    const { ht, tax } = extractTax(commission, config.taxBps);
    push(lines, merchant(participationId), commission);
    push(lines, org('ORG_COM'), -ht);
    push(lines, org('ORG_TAX'), -tax);
  }
  return balanced(lines);
}
