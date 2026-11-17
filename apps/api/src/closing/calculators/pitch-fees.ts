// Étape 1 : droits de place (R-03). `PREPAID` : ligne d'aperçu avec sa référence, aucune écriture. Un commerçant dont
// le solde devient négatif (`DEDUCT_OR_DEBT`) : dette reprise par l'organisateur dans la même étape.
import { readSignedBalances } from '../../ledger/db/ledger-queries';
import type { LedgerCommand } from '../../ledger/types';
import {
  big,
  closingCommand,
  notApplicable,
  type CalcLine,
  type CalcResult,
  type ClosingCalculator,
  type ClosingContext,
} from './calculator';

interface ParticipationRow {
  id: string;
  merchant_id: string;
  pitch_fee: string;
  pitch_fee_mode: 'DEDUCT_OR_DEBT' | 'PREPAID' | 'DEDUCT_CAPPED';
  pitch_fee_reference: string | null;
}

export const pitchFees: ClosingCalculator = {
  step: 'PITCH_FEES',
  async compute(ctx: ClosingContext): Promise<CalcResult> {
    const { rows } = await ctx.client.query<ParticipationRow>(
      `SELECT id, merchant_id, pitch_fee::text, pitch_fee_mode, pitch_fee_reference
         FROM merchant_participation WHERE event_id = $1 AND pitch_fee > 0 ORDER BY id`,
      [ctx.eventId],
    );
    const lines: CalcLine[] = [];
    const items: {
      participationId: string;
      mode: ParticipationRow['pitch_fee_mode'];
      merchantBalance?: bigint;
    }[] = [];
    const debts: { participationId: string; merchantId: string; amount: bigint }[] = [];
    let total = 0n;
    for (const row of rows) {
      const due = big(row.pitch_fee);
      if (row.pitch_fee_mode === 'PREPAID') {
        lines.push({
          partyId: row.merchant_id,
          label: 'Droit de place payé d’avance (sans écriture)',
          amount: due,
          reference: row.pitch_fee_reference,
        });
        continue;
      }
      const [signed] = await readSignedBalances(ctx.client, ctx.ledgerId, [
        { purpose: 'MERCHANT', participationId: row.id },
      ]);
      const available = -signed!;
      let charged = due;
      if (row.pitch_fee_mode === 'DEDUCT_CAPPED') {
        const positive = available > 0n ? available : 0n;
        charged = due < positive ? due : positive;
        items.push({
          participationId: row.id,
          mode: row.pitch_fee_mode,
          merchantBalance: available,
        });
      } else {
        items.push({ participationId: row.id, mode: row.pitch_fee_mode });
        if (available - due < 0n)
          debts.push({
            participationId: row.id,
            merchantId: row.merchant_id,
            amount: due - available,
          });
      }
      if (charged > 0n) {
        lines.push({ partyId: row.merchant_id, label: 'Droit de place', amount: charged });
        total += charged;
      }
    }
    if (total === 0n) {
      // Tout PREPAID : sans écriture, mais les lignes (avec leur référence) restent dans l'aperçu et le résumé.
      return { ...notApplicable({ prepaid: lines.length }), lines };
    }
    const commands: LedgerCommand[] = [closingCommand(ctx, 'PITCH_FEE', 'PITCH_FEES', { items })];
    for (const debt of debts) {
      lines.push({
        partyId: debt.merchantId,
        label: 'Dette reprise par l’organisateur',
        amount: debt.amount,
      });
      commands.push(
        closingCommand(ctx, 'MERCHANT_DEBT_TRANSFER', `PITCH_FEES:debt:${debt.participationId}`, {
          participationId: debt.participationId,
        }),
      );
    }
    return { applicable: true, lines, total, commands, summary: { debts: debts.length } };
  },
};
