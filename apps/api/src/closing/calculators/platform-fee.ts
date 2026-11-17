// Étape 3 : redevance de la plateforme (R-03) : 20 % (règle `PLATFORM_CONTRACT`) des frais HT de l'étape 2, relus
// dans `closing_step.summary` (jamais recalculés une fois l'étape faite).
import { fee } from '@cashless/shared-rules';
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
import { operatorFee } from './operator-fee';

export const platformFee: ClosingCalculator = {
  step: 'PLATFORM_FEE',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    const recorded = ctx.recorded.get('OPERATOR_FEE');
    let base: bigint;
    if (recorded) {
      if (recorded.status !== 'DONE') return notApplicable();
      base = big(recorded.summary.operatorFeeHt);
    } else {
      // Aperçu avant l'étape 2 : l'assiette est celle que l'étape 2 écrirait.
      const previous = await operatorFee.compute(ctx);
      base = previous.applicable ? big(previous.summary.operatorFeeHt) : 0n;
    }
    if (base <= 0n || fee(base, ctx.config.platformFee) <= 0n) return notApplicable();
    const command = closingCommand(ctx, 'PLATFORM_FEE', 'PLATFORM_FEE', { operatorFeeHt: base });
    const lines = builtLines(command, ctx);
    const ht = sumByPurpose(lines, ['PLT_REDEV'], -1);
    const tax = sumByPurpose(lines, ['PLT_TAX'], -1);
    return {
      applicable: true,
      lines: [
        { partyId: ctx.config.parties.platformId, label: 'Redevance (HT)', amount: ht },
        ...(tax !== 0n
          ? [{ partyId: ctx.config.parties.platformId, label: 'Redevance (taxe)', amount: tax }]
          : []),
      ],
      total: ht + tax,
      commands: [command],
      summary: { operatorFeeHt: Number(base) },
    };
  },
};
