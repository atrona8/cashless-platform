// WALLET_REFUND (solde payé) et CHARGEBACK (contestation carte, ADR-77) — SPECIFICATION §5.4.
import { fee } from '../../money';
import { BuildError, money, partyAccounts, wallet, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, creditWithTax, push, requireId, requirePositive } from './lines';

export interface WalletRefundPayload {
  walletId: string;
  /** Montant prélevé sur le solde payé, frais de remboursement compris. */
  amount: bigint;
  /** Compte d'argent de sortie : `A-BANQUE`, `A-PSP-<canal>` ou `A-CAISSE-<caisse>`. */
  moneyAccount: string;
}

/** Rendu du solde payé (le rendu d'espèces dues est délégué à `refund_cash_due`). */
export function buildWalletRefund(command: LedgerCommand<'WALLET_REFUND', WalletRefundPayload>, ctx: BuildContext): Line[] {
  const { walletId, amount, moneyAccount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'remboursement');
  const { config } = ctx;
  const { org } = partyAccounts(config);
  const refundFee = fee(amount, config.refundFee);
  if (refundFee >= amount) throw new BuildError('VALIDATION_FAILED', 'remboursement : montant inférieur ou égal aux frais');
  const lines: Line[] = [];
  push(lines, wallet(walletId, 'P'), refundFee);
  creditWithTax(lines, refundFee, config.taxBps, org('ORG_FFEST'), org('ORG_TAX'));
  push(lines, wallet(walletId, 'P'), amount - refundFee);
  push(lines, money(requireId(moneyAccount, "compte d'argent")), -(amount - refundFee));
  return balanced(lines);
}

export interface ChargebackPayload {
  walletId: string;
  /** Canal PSP contesté (compte `A-PSP-<canal>`). */
  channel: string;
  amount: bigint;
}

/** Le portefeuille paie jusqu'à son solde payé ; le reste va aux pertes de `contract.chargeback_bearer`. */
export function buildChargeback(command: LedgerCommand<'CHARGEBACK', ChargebackPayload>, ctx: BuildContext): Line[] {
  const { walletId, channel, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'contestation');
  const { config, balances } = ctx;
  if (!balances) throw new BuildError('VALIDATION_FAILED', 'contestation : soldes du portefeuille non fournis');
  const { org, ope } = partyAccounts(config);
  const available = balances.paid > 0n ? balances.paid : 0n;
  const fromWallet = amount < available ? amount : available;
  const lines: Line[] = [];
  push(lines, wallet(walletId, 'P'), fromWallet);
  push(lines, config.chargebackBearer === 'OPERATOR' ? ope('OPE_PERTES') : org('ORG_PERTES'), amount - fromWallet);
  push(lines, money(`A-PSP-${requireId(channel, 'canal PSP')}`), -amount);
  return balanced(lines);
}
