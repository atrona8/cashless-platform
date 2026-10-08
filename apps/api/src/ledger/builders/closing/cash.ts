// CASH_CLOSE, CASH_DEPOSIT, PSP_SETTLEMENT — mouvements entre comptes d'argent (SPECIFICATION §5.4).
import { BuildError, money, partyAccounts, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, push, requireId, requirePositive } from '../festival/lines';

export interface CashClosePayload {
  cashDesk: string;
  /** Espèces comptées à la fermeture. */
  counted: bigint;
  /** Solde théorique de la caisse. */
  expected: bigint;
}

/** Fermeture de caisse : le compté part en transit ; l'écart (manque ou surplus) va aux pertes de `cash_diff_bearer`. */
export function buildCashClose(command: LedgerCommand<'CASH_CLOSE', CashClosePayload>, ctx: BuildContext): Line[] {
  const { cashDesk, counted, expected } = command.payload;
  requirePositive(expected, 'solde théorique de la caisse');
  if (counted < 0n) throw new BuildError('VALIDATION_FAILED', 'espèces comptées : montant négatif');
  const { config } = ctx;
  const { org, ope } = partyAccounts(config);
  const lines: Line[] = [];
  push(lines, money('A-TRANSIT'), counted);
  // Manque : débit des pertes ; surplus : crédit du même compte.
  push(lines, config.cashDiffBearer === 'OPERATOR' ? ope('OPE_PERTES') : org('ORG_PERTES'), expected - counted);
  push(lines, money(`A-CAISSE-${requireId(cashDesk, 'caisse')}`), -expected);
  return balanced(lines);
}

export interface CashDepositPayload {
  amount: bigint;
}

export function buildCashDeposit(command: LedgerCommand<'CASH_DEPOSIT', CashDepositPayload>, _ctx: BuildContext): Line[] {
  const amount = requirePositive(command.payload.amount, 'dépôt d’espèces');
  return balanced([
    { account: money('A-BANQUE'), amount },
    { account: money('A-TRANSIT'), amount: -amount },
  ]);
}

export interface PspSettlementPayload {
  channel: string;
  /** Montant net reçu du PSP. */
  net: bigint;
}

export function buildPspSettlement(command: LedgerCommand<'PSP_SETTLEMENT', PspSettlementPayload>, _ctx: BuildContext): Line[] {
  const { channel, net } = command.payload;
  requirePositive(net, 'versement PSP');
  return balanced([
    { account: money('A-BANQUE'), amount: net },
    { account: money(`A-PSP-${requireId(channel, 'canal PSP')}`), amount: -net },
  ]);
}
