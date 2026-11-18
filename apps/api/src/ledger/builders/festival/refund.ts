// WALLET_REFUND (solde payé) et CHARGEBACK (contestation carte, ADR-77) — SPECIFICATION §5.4.
import { fee } from '@cashless/shared-rules';
import {
  BuildError,
  money,
  partyAccounts,
  wallet,
  type BuildContext,
  type LedgerCommand,
  type Line,
} from '../../types';
import { balanced, creditWithTax, push, requireId, requirePositive, tagFee } from './lines';

export interface WalletRefundPayload {
  walletId: string;
  /** Montant prélevé sur le solde payé, frais de remboursement compris. */
  amount: bigint;
  /** Compte d'argent de sortie : `A-BANQUE`, `A-PSP-<canal>` ou `A-CAISSE-<caisse>`. */
  moneyAccount: string;
  /**
   * Réclamation tardive (mission 9b, WP10) : remboursement SANS frais, `BACKOFFICE` seulement. Sur
   * un grand livre `LOCKED`, la base n'admet que « portefeuille débité, compte d'argent crédité »
   * (`check_late_claim`, CL024) : une ligne de frais serait refusée. Le montant est alors rendu en
   * entier.
   */
  waiveFee?: boolean;
}

/**
 * Compte d'argent de sortie d'un remboursement manuel, par canal (mission 9a, WP05 ; comptes de
 * `0037_psp_configurations.sql`) : `WAVE` et `ORANGE_MONEY` (comptes PSP), `BANK_TRANSFER`
 * (`A-BANQUE`, ouvert à l'ouverture du grand livre ; mission 9b, WP10), `CASH` (compte
 * `A-CAISSE-<n>` de la session ouverte, à fournir).
 */
export function moneyAccountFor(method: string, cashAccount?: string): string {
  if (method === 'WAVE') return 'A-PSP-WAVE';
  if (method === 'ORANGE_MONEY') return 'A-PSP-OM';
  if (method === 'BANK_TRANSFER') return 'A-BANQUE';
  if (method === 'CASH') {
    if (cashAccount === undefined || cashAccount === '')
      throw new BuildError(
        'VALIDATION_FAILED',
        'remboursement en espèces : compte de caisse requis',
      );
    return cashAccount;
  }
  throw new BuildError('VALIDATION_FAILED', `remboursement : canal ${method} non pris en charge`);
}

/** Rendu du solde payé (le rendu d'espèces dues est délégué à `refund_cash_due`). */
export function buildWalletRefund(
  command: LedgerCommand<'WALLET_REFUND', WalletRefundPayload>,
  ctx: BuildContext,
): Line[] {
  const { walletId, amount, moneyAccount, waiveFee } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'remboursement');
  if (waiveFee === true && command.source !== 'BACKOFFICE')
    throw new BuildError('VALIDATION_FAILED', 'remboursement sans frais : back-office seulement');
  const { config } = ctx;
  const { org } = partyAccounts(config);
  const refundFee = waiveFee === true ? 0n : fee(amount, config.refundFee);
  if (refundFee >= amount)
    throw new BuildError(
      'VALIDATION_FAILED',
      'remboursement : montant inférieur ou égal aux frais',
    );
  const lines: Line[] = [];
  push(lines, wallet(walletId, 'P'), refundFee);
  creditWithTax(lines, refundFee, config.taxBps, org('ORG_FFEST'), org('ORG_TAX'));
  if (waiveFee !== true) tagFee(lines, 0, config.refundFee);
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
export function buildChargeback(
  command: LedgerCommand<'CHARGEBACK', ChargebackPayload>,
  ctx: BuildContext,
): Line[] {
  const { walletId, channel, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'contestation');
  const { config, balances } = ctx;
  if (!balances)
    throw new BuildError('VALIDATION_FAILED', 'contestation : soldes du portefeuille non fournis');
  const { org, ope } = partyAccounts(config);
  const available = balances.paid > 0n ? balances.paid : 0n;
  const fromWallet = amount < available ? amount : available;
  const lines: Line[] = [];
  push(lines, wallet(walletId, 'P'), fromWallet);
  push(
    lines,
    config.chargebackBearer === 'OPERATOR' ? ope('OPE_PERTES') : org('ORG_PERTES'),
    amount - fromWallet,
  );
  push(lines, money(`A-PSP-${requireId(channel, 'canal PSP')}`), -amount);
  return balanced(lines);
}
