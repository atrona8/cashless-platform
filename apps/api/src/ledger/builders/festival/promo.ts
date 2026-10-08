// PROMO_CREDIT, PROMO_EXPIRY et ACTIVATION_FEE — SPECIFICATION §5.4.
import { fee, groupForTax } from '../../money';
import { BuildError, partyAccounts, wallet, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, push, requireId, requirePositive } from './lines';

export interface PromoPayload {
  walletId: string;
  amount: bigint;
}

/** Crédits offerts par l'organisateur (le préchargement d'un lot est délégué à `preload_media`). */
export function buildPromoCredit(command: LedgerCommand<'PROMO_CREDIT', PromoPayload>, ctx: BuildContext): Line[] {
  const { walletId, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'crédits offerts');
  const { org } = partyAccounts(ctx.config);
  return balanced([
    { account: org('ORG_PROMO'), amount },
    { account: wallet(walletId, 'X'), amount: -amount },
  ]);
}

/** Expiration des crédits offerts : `amount` = solde offert restant du portefeuille. */
export function buildPromoExpiry(command: LedgerCommand<'PROMO_EXPIRY', PromoPayload>, ctx: BuildContext): Line[] {
  const { walletId, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'crédits offerts à expirer');
  const { org } = partyAccounts(ctx.config);
  return balanced([
    { account: wallet(walletId, 'X'), amount },
    { account: org('ORG_PROMO'), amount: -amount },
  ]);
}

export interface ActivationFeePayload {
  /** Un portefeuille par support activé (un même portefeuille peut figurer plusieurs fois). */
  walletIds: string[];
}

/** Frais d'activation : un débit par support, puis une seule extraction de taxe sur la somme (cas 2). */
export function buildActivationFee(command: LedgerCommand<'ACTIVATION_FEE', ActivationFeePayload>, ctx: BuildContext): Line[] {
  const { walletIds } = command.payload;
  if (!walletIds?.length) throw new BuildError('VALIDATION_FAILED', "frais d'activation : aucun support");
  const { config } = ctx;
  const { org } = partyAccounts(config);
  const perMedia = requirePositive(fee(0n, config.activationFee), "frais d'activation");
  const lines: Line[] = walletIds.map((walletId) => ({
    account: wallet(requireId(walletId, 'portefeuille'), 'P'),
    amount: perMedia,
  }));
  const total = perMedia * BigInt(walletIds.length);
  for (const group of groupForTax([{ beneficiary: 'ORG', taxBps: config.taxBps, ttc: total }])) {
    push(lines, org('ORG_FFEST'), -group.ht);
    push(lines, org('ORG_TAX'), -group.tax);
  }
  return balanced(lines);
}
