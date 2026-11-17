// Étapes de clôture d'un événement (mission 9b, SPECIFICATION §12.1 ; research R-01 à R-04). `list`, `preview` et
// `execute` partagent UN calcul par étape (`calculators/`). L'aperçu ne fait que lire. L'exécution suit l'ordre des
// verrous d'interfaces.md : état du grand livre, verrou consultatif de l'étape (même clé que `record_closing_step`),
// lecture de `closing_step` AVANT tout calcul (sinon le moteur répondrait CL002 : les soldes ont changé), ordre et
// phase, calcul, écritures du moteur, `record_closing_step`, audit. Une erreur annule toute la transaction.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { SqlConfigResolver } from '../configuration/sql-config-resolver';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { EventRow } from '../events/events.dto';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { breakage } from './calculators/breakage';
import type {
  CalcResult,
  ClosingCalculator,
  ClosingContext,
  RecordedStep,
} from './calculators/calculator';
import { depositForfeit } from './calculators/deposit-forfeit';
import { operatorFee } from './calculators/operator-fee';
import { operatorFeeRegularization } from './calculators/operator-fee-regularization';
import { pitchFees } from './calculators/pitch-fees';
import { platformFee } from './calculators/platform-fee';
import { promoExpiry } from './calculators/promo-expiry';
import {
  amountJson,
  CLOSING_STEPS,
  phaseOf,
  previousOf,
  type ClosingStep,
  type ClosingStepPreviewDto,
  type ClosingStepResultDto,
  type ClosingStepStateDto,
} from './closing-steps.dto';

const CALCULATORS: Record<ClosingStep, ClosingCalculator> = {
  PITCH_FEES: pitchFees,
  OPERATOR_FEE: operatorFee,
  PLATFORM_FEE: platformFee,
  OPERATOR_FEE_REGULARIZATION: operatorFeeRegularization,
  BREAKAGE: breakage,
  DEPOSIT_FORFEIT: depositForfeit,
  PROMO_EXPIRY: promoExpiry,
};

/** Statut de l'événement dans lequel chaque phase se fait. */
const STATUS_OF = { SETTLING: 'SETTLING', REFUND_WINDOW: 'REFUND_WINDOW' } as const;

interface StepRow {
  step: ClosingStep;
  status: 'DONE' | 'NOT_APPLICABLE';
  done_by: string;
  done_at: Date;
  transaction_ids: string[];
  summary: Record<string, unknown>;
}

export interface ClosingActor {
  userId: string;
  audit: AuditContext;
}

const conflict = (detail: string) =>
  new ProblemException('CONFLICT_STATE', { status: 409, detail });
const notMet = (detail: string) =>
  new ProblemException('CLOSING_CONDITION_NOT_MET', { status: 409, detail });

@Injectable()
export class ClosingStepService {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly configResolver: SqlConfigResolver,
    private readonly audit: AuditService,
  ) {}

  /** Les sept étapes dans l'ordre, chacune à faire, faite ou sans objet. */
  async list(client: TxClient, event: EventRow): Promise<ClosingStepStateDto[]> {
    const rows = await this.rows(client, event.id);
    return CLOSING_STEPS.map((step) => {
      const row = rows.get(step);
      return row
        ? {
            step,
            status: row.status,
            done_by: row.done_by,
            done_at: row.done_at.toISOString(),
            transaction_ids: row.transaction_ids,
            summary: row.summary,
          }
        : {
            step,
            status: 'TODO' as const,
            done_by: null,
            done_at: null,
            transaction_ids: [],
            summary: {},
          };
    });
  }

  /** Ce que l'étape écrirait : même calcul que l'exécution, aucune écriture, aucun verrou d'écriture. */
  async preview(
    client: TxClient,
    event: EventRow,
    step: ClosingStep,
  ): Promise<ClosingStepPreviewDto> {
    const ctx = await this.context(client, event);
    const done = ctx.recorded.get(step);
    if (done) {
      const summary = done.summary as {
        lines?: { party_id: string; label: string; amount: number }[];
        total?: number;
      };
      return {
        event_id: event.id,
        step,
        currency: ctx.currency,
        applicable: done.status === 'DONE',
        lines: summary.lines ?? [],
        total: summary.total ?? 0,
      };
    }
    return previewDto(event.id, step, ctx.currency, await CALCULATORS[step].compute(ctx));
  }

  /** Exécute l'étape une seule fois par événement ; une étape déjà faite rend le même résultat sans rien écrire. */
  async execute(
    client: TxClient,
    event: EventRow,
    step: ClosingStep,
    actor: ClosingActor,
  ): Promise<ClosingStepResultDto> {
    const ledger = await this.ledger(client, event);
    // 2. Verrou de l'étape (même clé que record_closing_step : réentrant dans cette transaction).
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('closing-step:' || $1::text || ':' || $2::text, 0))`,
      [event.id, step],
    );
    // 3. État lu AVANT tout calcul : étape déjà faite = réponse reconstruite, rien recalculé ni écrit.
    const rows = await this.rows(client, event.id);
    const existing = rows.get(step);
    if (existing) return resultDto(event.id, existing);
    // 4. Phase et ordre, sous le verrou : l'état de l'événement relu ici est celui de la suite.
    await this.assertAllowed(client, event.id, step, rows);
    const ctx = await this.context(client, event, ledger, actor.userId, rows);
    // 5. Calcul, puis écritures du moteur (clés closing:<event>:<step>[:<id>]).
    const calc = await CALCULATORS[step].compute(ctx);
    const transactionIds: string[] = [];
    for (const command of calc.commands) {
      const written = await this.engine.execute(client, command);
      if (written.transactionId && !transactionIds.includes(written.transactionId))
        transactionIds.push(written.transactionId);
    }
    // 6. Enregistrement dans la même transaction, puis audit.
    const summary = storedSummary(calc);
    const status = calc.applicable ? 'DONE' : 'NOT_APPLICABLE';
    const { rows: recorded } = await client.query<StepRow>(
      `SELECT step, status, done_by, done_at, transaction_ids::text[] AS transaction_ids, summary
         FROM record_closing_step($1, $2, $3, $4::uuid[], $5::jsonb, $6)`,
      [event.id, step, status, transactionIds, JSON.stringify(summary), actor.userId],
    );
    const row = recorded[0]!;
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: event.operator_id,
      action: 'CLOSING_STEP_EXECUTED',
      objectType: 'event',
      objectId: event.id,
      after: { step, status, total: summary.total, lines: summary.lines },
    });
    return resultDto(event.id, row);
  }

  private async rows(client: TxClient, eventId: string): Promise<Map<ClosingStep, StepRow>> {
    const { rows } = await client.query<StepRow>(
      `SELECT step, status, done_by, done_at, transaction_ids::text[] AS transaction_ids, summary
         FROM closing_step WHERE event_id = $1`,
      [eventId],
    );
    return new Map(rows.map((row) => [row.step, row]));
  }

  /** Grand livre de l'événement : absent ou verrouillé = 409 ; plusieurs événements par grand livre = 422. */
  private async ledger(
    client: TxClient,
    event: EventRow,
  ): Promise<{ id: string; currency: string }> {
    const { rows } = await client.query<{ id: string; currency: string; status: string }>(
      `SELECT id, currency, status FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`,
      [event.id],
    );
    const ledger = rows[0];
    if (!ledger) {
      const shared = await client.query(
        `SELECT 1 FROM ledger WHERE scope_type = 'ORGANIZER' AND scope_id = $1`,
        [event.organizer_id],
      );
      if (shared.rows.length > 0)
        throw new ProblemException('VALIDATION_FAILED', {
          status: 422,
          detail:
            "Le grand livre couvre plusieurs événements : la clôture par événement n'y est pas définie.",
        });
      throw conflict("L'événement n'a pas de grand livre.");
    }
    if (ledger.status === 'LOCKED') throw conflict("Le grand livre de l'événement est verrouillé.");
    return ledger;
  }

  /** Phase de l'événement, échéance de remboursement, étape précédente : sinon 409 CLOSING_CONDITION_NOT_MET. */
  private async assertAllowed(
    client: TxClient,
    eventId: string,
    step: ClosingStep,
    rows: ReadonlyMap<ClosingStep, StepRow>,
  ): Promise<void> {
    const { rows: found } = await client.query<{ status: string; reached: boolean }>(
      `SELECT status::text AS status, coalesce(refund_deadline <= clock_timestamp(), false) AS reached
         FROM event WHERE id = $1 FOR KEY SHARE`,
      [eventId],
    );
    const event = found[0]!;
    const phase = phaseOf(step);
    if (event.status !== STATUS_OF[phase])
      throw notMet(
        `${step} : l'événement doit être en ${STATUS_OF[phase]} (il est en ${event.status}).`,
      );
    if (phase === 'REFUND_WINDOW' && !event.reached)
      throw notMet(`${step} : la date limite de remboursement n'est pas atteinte.`);
    const previous = previousOf(step);
    if (previous && !rows.has(previous))
      throw notMet(`${step} : l'étape précédente (${previous}) n'est ni faite ni sans objet.`);
  }

  private async context(
    client: TxClient,
    event: EventRow,
    ledger?: { id: string; currency: string },
    actorId?: string,
    recorded?: ReadonlyMap<ClosingStep, StepRow>,
  ): Promise<ClosingContext> {
    const led = ledger ?? (await this.ledger(client, event));
    const rows = recorded ?? (await this.rows(client, event.id));
    const now = new Date();
    const config = await this.configResolver.resolve({
      ledgerId: led.id,
      eventId: event.id,
      occurredAt: now,
      client,
    });
    const { rows: basis } = await client.query<{ operator_fee_basis: string }>(
      'SELECT operator_fee_basis FROM contract WHERE id = $1',
      [event.contract_id],
    );
    return {
      client,
      eventId: event.id,
      operatorId: event.operator_id,
      organizerId: event.organizer_id,
      ledgerId: led.id,
      currency: led.currency,
      config,
      operatorFeeBasis:
        basis[0]?.operator_fee_basis === 'NET_OF_REFUNDS' ? 'NET_OF_REFUNDS' : 'GROSS',
      ...(actorId ? { actorId } : {}),
      now,
      recorded: new Map(
        [...rows].map(([key, row]): [ClosingStep, RecordedStep] => [
          key,
          { status: row.status, summary: row.summary, transactionIds: row.transaction_ids },
        ]),
      ),
    };
  }
}

function previewDto(
  eventId: string,
  step: ClosingStep,
  currency: string,
  calc: CalcResult,
): ClosingStepPreviewDto {
  return {
    event_id: eventId,
    step,
    currency,
    applicable: calc.applicable,
    lines: calc.lines.map((line) => ({
      party_id: line.partyId,
      label: line.label,
      amount: amountJson(line.amount),
      ...(line.reference !== undefined ? { reference: line.reference } : {}),
    })),
    total: amountJson(calc.total),
  };
}

/** Résumé gardé : les lignes de l'aperçu (identifiants et montants seulement) et le total, plus les données du calcul. */
function storedSummary(
  calc: CalcResult,
): Record<string, unknown> & { lines: unknown; total: number } {
  const lines = calc.lines.map((line) => ({
    party_id: line.partyId,
    label: line.label,
    amount: amountJson(line.amount),
    ...(line.reference ? { reference: line.reference } : {}),
  }));
  return { ...calc.summary, lines, total: amountJson(calc.total) };
}

function resultDto(eventId: string, row: StepRow): ClosingStepResultDto {
  return {
    event_id: eventId,
    step: row.step,
    status: row.status,
    transaction_ids: row.transaction_ids,
    summary: row.summary,
    done_by: row.done_by,
    done_at: new Date(row.done_at).toISOString(),
  };
}
