// Étape 2 : frais du prestataire (R-03, R-04). Assiettes : recharges payées de l'événement et supports activés.
// L'étape écrit toujours la base BRUTE, même en `NET_OF_REFUNDS` (la régularisation vient en étape 4).
import { fee } from '@cashless/shared-rules';
import type { ResolvedConfig } from '../../ledger/types';
import { amountJson } from '../closing-steps.dto';
import {
  big,
  builtLines,
  closingCommand,
  notApplicable,
  sumByPurpose,
  type CalcResult,
  type ClosingCalculator,
  type ClosingContext,
} from './calculator';

export interface FeeBases {
  TOPUP_AMOUNT: bigint;
  PER_MEDIA: bigint;
}

/** Recharges payées créditées aux portefeuilles de l'événement, et supports activés (au moins un rattachement). */
export async function readBases(ctx: ClosingContext): Promise<FeeBases> {
  const topups = await ctx.client.query<{ v: string }>(
    `SELECT coalesce(-sum(p.amount), 0)::text AS v
       FROM posting p JOIN account a ON a.id = p.account_id
       JOIN journal_transaction t ON t.id = p.transaction_id
      WHERE t.ledger_id = $1 AND t.type IN ('TOPUP', 'TOPUP_CASH') AND a.purpose = 'WALLET_PAID'`,
    [ctx.ledgerId],
  );
  const media = await ctx.client.query<{ n: string }>(
    `SELECT count(DISTINCT ma.media_id)::text AS n
       FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id WHERE w.ledger_id = $1`,
    [ctx.ledgerId],
  );
  return { TOPUP_AMOUNT: big(topups.rows[0]?.v), PER_MEDIA: big(media.rows[0]?.n) };
}

/** Frais TTC de toutes les règles du prestataire pour ces assiettes (même arithmétique que le constructeur). */
export function feeTotal(config: ResolvedConfig, bases: FeeBases): bigint {
  return config.operatorFees.reduce(
    (sum, { basis, rule }) =>
      sum +
      (basis === 'PER_MEDIA' ? bases.PER_MEDIA * fee(0n, rule) : fee(bases.TOPUP_AMOUNT, rule)),
    0n,
  );
}

export const basesJson = (b: FeeBases) => ({
  TOPUP_AMOUNT: amountJson(b.TOPUP_AMOUNT),
  PER_MEDIA: amountJson(b.PER_MEDIA),
});
export const basesFrom = (value: unknown): FeeBases | undefined => {
  const v = value as { TOPUP_AMOUNT?: unknown; PER_MEDIA?: unknown } | undefined;
  return v && v.TOPUP_AMOUNT !== undefined && v.PER_MEDIA !== undefined
    ? { TOPUP_AMOUNT: big(v.TOPUP_AMOUNT), PER_MEDIA: big(v.PER_MEDIA) }
    : undefined;
};

export const operatorFee: ClosingCalculator = {
  step: 'OPERATOR_FEE',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    if (ctx.config.operatorFees.length === 0) return notApplicable();
    const bases = await readBases(ctx);
    const total = feeTotal(ctx.config, bases);
    if (total <= 0n) return notApplicable({ bases: basesJson(bases) });
    const command = closingCommand(ctx, 'OPERATOR_FEE', 'OPERATOR_FEE', { bases });
    const lines = builtLines(command, ctx);
    const ht = sumByPurpose(lines, ['OPE_FRAIS'], -1);
    const tax = sumByPurpose(lines, ['OPE_TAX'], -1);
    return {
      applicable: true,
      lines: [
        { partyId: ctx.operatorId, label: 'Frais du prestataire (HT)', amount: ht },
        ...(tax !== 0n
          ? [{ partyId: ctx.operatorId, label: 'Frais du prestataire (taxe)', amount: tax }]
          : []),
      ],
      total: ht + tax,
      commands: [command],
      summary: { bases: basesJson(bases), operatorFeeHt: amountJson(ht) },
    };
  },
};
