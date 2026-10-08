// TOPUP (recharge par PSP) et TOPUP_CASH (recharge en espèces) — SPECIFICATION §5.4.
import { fee } from '../../money';
import { cashDue, money, partyAccounts, wallet, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, creditWithTax, push, requireId, requirePositive } from './lines';

export interface TopupPayload {
  walletId: string;
  /** Canal PSP : WAVE, OM, CARTE… (compte d'argent `A-PSP-<canal>`). */
  channel: string;
  amount: bigint;
}

export function buildTopup(command: LedgerCommand<'TOPUP', TopupPayload>, ctx: BuildContext): Line[] {
  const { walletId, channel, amount } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'recharge');
  const { config } = ctx;
  const { org, ope } = partyAccounts(config);
  const psp = money(`A-PSP-${requireId(channel, 'canal PSP')}`);
  const pspFee = fee(amount, config.pspFees[channel] ?? {});
  const lines: Line[] = [];
  push(lines, psp, amount);
  if (config.pspFeeBearer === 'CUSTOMER') {
    // Le festivalier paie les frais : portefeuille crédité du net, frais facturés par l'organisateur (HT + taxe).
    push(lines, wallet(walletId, 'P'), -(amount - pspFee));
    creditWithTax(lines, pspFee, config.taxBps, org('ORG_FFEST'), org('ORG_TAX'));
  } else {
    push(lines, wallet(walletId, 'P'), -amount);
    push(lines, config.pspFeeBearer === 'ORGANIZER' ? org('ORG_FPSP') : ope('OPE_FPSP'), pspFee);
    push(lines, psp, -pspFee);
  }
  return balanced(lines);
}

export interface TopupCashPayload {
  walletId: string;
  /** Caisse : compte d'argent `A-CAISSE-<caisse>`. */
  cashDesk: string;
  amount: bigint;
  /** Marge disponible sous le plafond du portefeuille (hors ligne, ADR-63), fournie par le service. */
  headroom?: bigint;
}

export function buildTopupCash(command: LedgerCommand<'TOPUP_CASH', TopupCashPayload>, _ctx: BuildContext): Line[] {
  const { walletId, cashDesk, amount, headroom } = command.payload;
  requireId(walletId, 'portefeuille');
  requirePositive(amount, 'recharge en espèces');
  const margin = headroom === undefined ? amount : headroom < 0n ? 0n : headroom;
  const credited = margin < amount ? margin : amount;
  const lines: Line[] = [];
  push(lines, money(`A-CAISSE-${requireId(cashDesk, 'caisse')}`), amount);
  push(lines, wallet(walletId, 'P'), -credited);
  // Au-delà de la marge : espèces dues au client, rendues plus tard (anomalie).
  push(lines, cashDue(walletId), -(amount - credited));
  return balanced(lines);
}
