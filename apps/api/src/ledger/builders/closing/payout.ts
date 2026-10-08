// PAYOUT_INITIATED, PAYOUT_CONFIRMED, PAYOUT_FAILED — versements aux bénéficiaires (SPECIFICATION §5.4).
import {
  legalBreakage,
  merchant,
  money,
  partyAccounts,
  payoutPending,
  type AccountRef,
  type BuildContext,
  type LedgerCommand,
  type Line,
} from '../../types';
import { balanced, push, requireId, requirePositive } from '../festival/lines';

/** Bénéficiaire d'un versement : un commerçant (par participation), une partie du grand livre ou le compte légal. */
export type PayoutBeneficiary = { participationId: string } | 'ORGANIZER' | 'OPERATOR' | 'PLATFORM' | 'LEGAL';

function beneficiaryAccount(beneficiary: PayoutBeneficiary, ctx: BuildContext): AccountRef {
  const { org, ope, plt } = partyAccounts(ctx.config);
  switch (beneficiary) {
    case 'ORGANIZER':
      return org('ORG_VERS');
    case 'OPERATOR':
      return ope('OPE_VERS');
    case 'PLATFORM':
      return plt('PLT_VERS');
    case 'LEGAL':
      return legalBreakage();
    default:
      return merchant(requireId(beneficiary.participationId, 'participation'));
  }
}

export interface PayoutInitiatedPayload {
  payouts: { beneficiary: PayoutBeneficiary; amount: bigint }[];
}

/** Un débit par bénéficiaire, dans l'ordre donné, puis le total en versements en cours. */
export function buildPayoutInitiated(command: LedgerCommand<'PAYOUT_INITIATED', PayoutInitiatedPayload>, ctx: BuildContext): Line[] {
  const lines: Line[] = [];
  for (const { beneficiary, amount } of command.payload.payouts ?? []) {
    push(lines, beneficiaryAccount(beneficiary, ctx), requirePositive(amount, 'versement'));
  }
  push(lines, payoutPending(), -lines.reduce((sum, line) => sum + line.amount, 0n));
  return balanced(lines);
}

export interface PayoutConfirmedPayload {
  amount: bigint;
  /** Compte d'argent débité : `A-BANQUE` ou `A-PSP-<canal>`. */
  moneyAccount: string;
}

export function buildPayoutConfirmed(command: LedgerCommand<'PAYOUT_CONFIRMED', PayoutConfirmedPayload>, _ctx: BuildContext): Line[] {
  const { amount, moneyAccount } = command.payload;
  requirePositive(amount, 'versement confirmé');
  return balanced([
    { account: payoutPending(), amount },
    { account: money(requireId(moneyAccount, "compte d'argent")), amount: -amount },
  ]);
}

export interface PayoutFailedPayload {
  amount: bigint;
  /** Bénéficiaire d'origine, recrédité. */
  beneficiary: PayoutBeneficiary;
}

export function buildPayoutFailed(command: LedgerCommand<'PAYOUT_FAILED', PayoutFailedPayload>, ctx: BuildContext): Line[] {
  const { amount, beneficiary } = command.payload;
  requirePositive(amount, 'versement échoué');
  return balanced([
    { account: payoutPending(), amount },
    { account: beneficiaryAccount(beneficiary, ctx), amount: -amount },
  ]);
}
