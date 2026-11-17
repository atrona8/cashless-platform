// Étape 4 : régularisation des frais du prestataire (R-04), seulement si `operator_fee_basis = NET_OF_REFUNDS`.
// Delta = frais(base brute écrite en SETTLING) moins frais(base nette des WALLET_REFUND faits depuis), la MÊME règle
// (min, max, fixe) appliquée aux deux bases : `fee()` n'est pas linéaire, jamais le taux sur les remboursements.
// Le constructeur `OPERATOR_FEE` n'écrit que des frais d'assiette : la différence s'écrit en UNE commande
// `regularization: true` portant l'écart explicite (`amount`).
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
import { basesFrom, basesJson, feeTotal, readBases, type FeeBases } from './operator-fee';

export const operatorFeeRegularization: ClosingCalculator = {
  step: 'OPERATOR_FEE_REGULARIZATION',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    if (ctx.operatorFeeBasis !== 'NET_OF_REFUNDS') return notApplicable();
    const recorded = ctx.recorded.get('OPERATOR_FEE');
    if (recorded?.status === 'NOT_APPLICABLE') return notApplicable();
    const gross: FeeBases = basesFrom(recorded?.summary.bases) ?? (await readBases(ctx));
    // Remboursements faits depuis l'écriture des frais (argent sorti : lignes créditées des comptes d'argent).
    const since = recorded?.transactionIds.length
      ? (
          await ctx.client.query<{ at: Date | null }>(
            'SELECT min(recorded_at) AS at FROM journal_transaction WHERE id = ANY($1::uuid[])',
            [recorded.transactionIds],
          )
        ).rows[0]?.at
      : null;
    const refunded = since
      ? big(
          (
            await ctx.client.query<{ v: string }>(
              `SELECT coalesce(-sum(p.amount), 0)::text AS v
                 FROM posting p JOIN account a ON a.id = p.account_id
                 JOIN journal_transaction t ON t.id = p.transaction_id
                WHERE t.ledger_id = $1 AND t.type = 'WALLET_REFUND' AND t.recorded_at > $2
                  AND a.family = 'ASSET' AND p.amount < 0`,
              [ctx.ledgerId, since],
            )
          ).rows[0]?.v,
        )
      : 0n;
    const netTopups = gross.TOPUP_AMOUNT > refunded ? gross.TOPUP_AMOUNT - refunded : 0n;
    const net: FeeBases = { TOPUP_AMOUNT: netTopups, PER_MEDIA: gross.PER_MEDIA };
    const grossFee = feeTotal(ctx.config, gross);
    const netFee = feeTotal(ctx.config, net);
    const delta = grossFee - netFee;
    const summary = {
      bases: basesJson(gross),
      net_bases: basesJson(net),
      refunded: amountJson(refunded),
      delta: amountJson(delta > 0n ? delta : 0n),
    };
    if (delta <= 0n) return notApplicable(summary);
    // UNE transaction inversée, d'un montant explicite : la matrice n'autorise que la variante REGULARIZATION.
    const command = closingCommand(ctx, 'OPERATOR_FEE', 'OPERATOR_FEE_REGULARIZATION', {
      variant: 'REGULARIZATION',
      bases: gross,
      regularization: true,
      amount: delta,
    });
    const built = builtLines(command, ctx);
    const ht = sumByPurpose(built, ['OPE_FRAIS'], 1);
    const tax = sumByPurpose(built, ['OPE_TAX'], 1);
    const lines = [
      { partyId: ctx.operatorId, label: 'Régularisation des frais (HT)', amount: ht },
      ...(tax !== 0n
        ? [{ partyId: ctx.operatorId, label: 'Régularisation des frais (taxe)', amount: tax }]
        : []),
    ];
    return {
      applicable: true,
      lines,
      total: ht + tax,
      commands: [command],
      summary: { ...summary, delta_ht: amountJson(ht) },
    };
  },
};
