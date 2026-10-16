// Statuts d'un événement (SPECIFICATION §12.1, contrat event-lifecycle, research R-08 ; FR-017, FR-018, C-001).
// Le statut ne change que par la fonction de la base `set_event_status` : ce service ne l'écrit jamais. Il expose
// les conditions d'un passage — celles que la base calcule (`event_transition_conditions`, mêmes calculs que
// `set_event_status`), celles de configuration pour la mise en service, et celles qu'une autre mission rendra
// calculables — puis applique le passage et l'audite.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import type { EventRow } from '../events.dto';
import { EventsService } from '../events.service';
import { conditionText } from './status-messages';

export const EVENT_STATUSES = [
  'DRAFT',
  'LIVE',
  'CLOSING',
  'RECONCILING',
  'SETTLING',
  'REFUND_WINDOW',
  'CLOSED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface StatusCondition {
  code: string;
  met: boolean | null;
  detail: string;
  source: 'DATABASE' | 'CONFIGURATION' | 'EXTERNAL';
  owner_mission?: string;
}

/** Conditions tenues par une autre mission (§12.1) : nommées, pas encore calculables. */
const EXTERNAL: Partial<Record<EventStatus, Array<{ code: string; owner: string }>>> = {
  RECONCILING: [{ code: 'DEVICES_REPORTED', owner: 'Terminaux' }],
  SETTLING: [
    { code: 'CASH_DESKS_COUNTED', owner: 'Recharges, caisses et PSP' },
    { code: 'PSP_RECONCILED', owner: 'Recharges, caisses et PSP' },
  ],
};

/** Statut suivant du diagramme de §12.1 ; `null` après `CLOSED`. */
export function nextStatus(status: string): EventStatus | null {
  const index = EVENT_STATUSES.indexOf(status as EventStatus);
  return index >= 0 && index < EVENT_STATUSES.length - 1 ? EVENT_STATUSES[index + 1]! : null;
}

@Injectable()
export class StatusService {
  constructor(
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** Conditions du passage vers `to`, dans l'ordre de contrôle : base, configuration (vers LIVE), externes. */
  async conditions(
    client: TxClient,
    event: EventRow,
    to: EventStatus,
    language: Language,
  ): Promise<StatusCondition[]> {
    const { rows } = await client.query<{ code: string; met: boolean }>(
      'SELECT code, met FROM event_transition_conditions($1, $2)',
      [event.id, to],
    );
    const conditions: StatusCondition[] = rows.map((row) => ({
      code: row.code,
      met: row.met,
      detail: conditionText(row.code, row.met, language),
      source: 'DATABASE',
    }));
    if (to === 'LIVE') {
      for (const condition of await this.configuration(client, event)) {
        conditions.push({
          ...condition,
          detail: conditionText(condition.code, condition.met, language),
          source: 'CONFIGURATION',
        });
      }
    }
    for (const external of EXTERNAL[to] ?? []) {
      conditions.push({
        code: external.code,
        met: null,
        detail: conditionText(external.code, null, language),
        source: 'EXTERNAL',
        owner_mission: external.owner,
      });
    }
    return conditions;
  }

  /** Conditions de configuration de la mise en service : détenteur des fonds, contrat, profil de législation, grand livre. */
  private async configuration(
    client: TxClient,
    event: EventRow,
  ): Promise<Array<{ code: string; met: boolean }>> {
    const { rows } = await client.query<{
      funds_holder: boolean;
      contract: boolean;
      jurisdiction: boolean;
      ledger: boolean;
    }>(
      `SELECT (e.funds_holder IS NOT NULL AND ((e.funds_holder = 'THIRD_PARTY') = (e.funds_holder_party_id IS NOT NULL))) AS funds_holder,
              EXISTS (SELECT 1 FROM contract c WHERE c.id = e.contract_id AND c.kind = 'OPERATOR_ORGANIZER'
                         AND c.counterparty_id = e.organizer_id AND c.valid_from <= clock_timestamp()) AS contract,
              EXISTS (SELECT 1 FROM jurisdiction_profile j WHERE j.id = e.jurisdiction_id AND j.valid_from <= current_date) AS jurisdiction,
              EXISTS (SELECT 1 FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = e.id AND l.status = 'OPEN') AS ledger
         FROM event e WHERE e.id = $1`,
      [event.id],
    );
    const state = rows[0]!;
    return [
      { code: 'FUNDS_HOLDER_SET', met: state.funds_holder },
      { code: 'CONTRACT_IN_FORCE', met: state.contract },
      { code: 'JURISDICTION_SET', met: state.jurisdiction },
      { code: 'LEDGER_OPEN', met: state.ledger },
    ];
  }

  /**
   * Refuse le passage si une condition calculable n'est pas remplie : passage non prévu ⇒ 409
   * EVENT_TRANSITION_INVALID ; autre condition ⇒ 409 CLOSING_CONDITION_NOT_MET, dont le détail nomme la condition.
   * Les conditions externes (`met = null`) ne bloquent pas : elles restent contrôlées par le back-office (§12.1).
   */
  async assertMet(
    client: TxClient,
    event: EventRow,
    to: EventStatus,
    language: Language,
  ): Promise<void> {
    const conditions = await this.conditions(client, event, to, language);
    const unmet = conditions.filter((condition) => condition.met === false);
    if (unmet.some((condition) => condition.code === 'TRANSITION_ALLOWED')) {
      throw new ProblemException('EVENT_TRANSITION_INVALID', {
        status: 409,
        detail: conditionText('TRANSITION_ALLOWED', false, language),
        extensions: { from: event.status, to },
      });
    }
    if (unmet.length > 0) {
      throw new ProblemException('CLOSING_CONDITION_NOT_MET', {
        status: 409,
        detail: unmet.map((condition) => `${condition.code} : ${condition.detail}`).join(' '),
        extensions: { conditions: unmet },
      });
    }
  }

  /**
   * Applique le passage par `set_event_status` (auteur = `authorId`), puis l'audite. La base refait ses contrôles :
   * un refus (CL018, CL019) remonte en 409 sans texte SQL.
   */
  async apply(
    client: TxClient,
    event: EventRow,
    to: EventStatus,
    authorId: string,
    actor: AuditContext,
    approverId?: string,
  ): Promise<Record<string, unknown>> {
    await client.query('SELECT set_event_status($1, $2, $3)', [event.id, to, authorId]);
    const after = await this.events.dto(client, await this.events.row(client, event.id));
    await this.audit.record(client, {
      ...actor,
      operatorId: event.operator_id,
      action: 'EVENT_STATUS_CHANGED',
      objectType: 'event',
      objectId: event.id,
      before: { status: event.status },
      after: { status: to },
      approverId: approverId ?? null,
    });
    return after;
  }
}
