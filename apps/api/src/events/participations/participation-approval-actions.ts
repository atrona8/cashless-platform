// Portées de règles de frais d'un événement et actions à deux personnes sur un événement en service (research R-09) :
// `PARTICIPATION_CHANGE` (inscription ou modification d'une participation) et `FEE_RULE_CHANGE` (création ou
// remplacement d'une règle de portée EVENT ou PARTICIPATION). ORGANIZER_ADMIN de l'organisateur de l'événement. À
// l'exécution, les contrôles de l'écriture directe sont refaits : un refus fait passer la demande FAILED.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../../approval/action-registry';
import type { AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { conflict, isUuid, parseFeeRuleCreate, type FeeRuleInput } from '../../organization/platform/platform.dto';
import { FeeRulesService, type FeeScopeInfo } from '../../organization/tenant/fee-rules.service';
import {
  parseParticipationCreate,
  parseParticipationUpdate,
  ParticipationsService,
  type ParticipationInput,
  type ParticipationTerms,
} from './participations.service';

export type ParticipationChangePayload =
  | { event_id: string; mode: 'create'; input: ParticipationInput }
  | { event_id: string; mode: 'update'; participation_id: string; changes: ParticipationTerms };

export type FeeRuleChangePayload =
  | { event_id: string; mode: 'create'; input: FeeRuleInput }
  | { event_id: string; mode: 'replace'; fee_rule_id: string; input: FeeRuleInput };

const refused = (detail: string): ProblemException => new ProblemException('VALIDATION_FAILED', { status: 422, detail });
const record = (raw: unknown): Record<string, unknown> => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const requester = (requestedBy: string): AuditContext => ({ actorId: requestedBy, actorRole: 'ORGANIZER_ADMIN', origin: null, requestId: null });
const EVENT_SCOPE = (payload: { event_id: string }) => ({ type: 'EVENT' as const, id: payload.event_id });

/** L'événement doit toujours accepter l'écriture au moment de l'exécution. */
function assertOpen(status: string): void {
  if (status !== 'DRAFT' && status !== 'LIVE') throw conflict(`L'événement est ${status} : il n'accepte plus cette modification.`);
}

@Injectable()
export class ParticipationApprovalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly participations: ParticipationsService,
    private readonly feeRules: FeeRulesService,
  ) {
    feeRules.registerScope('EVENT', (client, scopeId) => this.eventScope(client, 'e.id = $1', scopeId));
    feeRules.registerScope('PARTICIPATION', (client, scopeId) =>
      this.eventScope(client, 'e.id = (SELECT mp.event_id FROM merchant_participation mp WHERE mp.id = $1)', scopeId),
    );
    registry.register(this.participationChange() as ApprovalActionDefinition);
    registry.register(this.feeRuleChange() as ApprovalActionDefinition);
  }

  /** Portée d'un événement (ou d'une de ses participations) : réglée par l'ORGANIZER_ADMIN, taxes du profil de l'événement. */
  private async eventScope(client: TxClient, where: string, scopeId: string): Promise<FeeScopeInfo | null> {
    const { rows } = await client.query<{ id: string; organizer_id: string; status: string; jurisdiction_id: string; country_code: string }>(
      `SELECT e.id, e.organizer_id, e.status, e.jurisdiction_id, j.country_code
         FROM event e JOIN jurisdiction_profile j ON j.id = e.jurisdiction_id WHERE ${where}`,
      [scopeId],
    );
    const event = rows[0];
    if (!event) return null;
    return {
      role: 'ORGANIZER_ADMIN',
      organizerId: event.organizer_id,
      countryCode: event.country_code,
      jurisdictionId: event.jurisdiction_id,
      eventId: event.id,
      eventStatus: event.status,
    };
  }

  private participationChange(): ApprovalActionDefinition<ParticipationChangePayload> {
    return {
      action: 'PARTICIPATION_CHANGE',
      requiredRole: 'ORGANIZER_ADMIN',
      scopeOf: EVENT_SCOPE,
      validate: (raw) => {
        const payload = record(raw);
        if (!isUuid(payload.event_id)) throw refused('event_id attendu.');
        if (payload.mode === 'create') return { event_id: payload.event_id, mode: 'create', input: parseParticipationCreate(payload.input) };
        if (payload.mode === 'update' && isUuid(payload.participation_id)) {
          return { event_id: payload.event_id, mode: 'update', participation_id: payload.participation_id, changes: parseParticipationUpdate(payload.changes) };
        }
        throw refused('mode create ou update attendu.');
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => {
        const event = await this.participations.event(client, payload.event_id);
        assertOpen(event.status);
        if (payload.mode === 'create') {
          return { result: await this.participations.create(client, event, payload.input, requester(requestedBy), approvedBy) };
        }
        const row = await this.participations.row(client, payload.participation_id);
        if (row.event_id !== event.id) throw conflict('Cette participation n\'appartient plus à cet événement.');
        return { result: await this.participations.update(client, row, payload.changes, requester(requestedBy), approvedBy) };
      },
    };
  }

  private feeRuleChange(): ApprovalActionDefinition<FeeRuleChangePayload> {
    return {
      action: 'FEE_RULE_CHANGE',
      requiredRole: 'ORGANIZER_ADMIN',
      scopeOf: EVENT_SCOPE,
      validate: (raw) => {
        const payload = record(raw);
        if (!isUuid(payload.event_id)) throw refused('event_id attendu.');
        const input = parseFeeRuleCreate(payload.input);
        if (payload.mode === 'create') return { event_id: payload.event_id, mode: 'create', input };
        if (payload.mode === 'replace' && isUuid(payload.fee_rule_id)) return { event_id: payload.event_id, mode: 'replace', fee_rule_id: payload.fee_rule_id, input };
        throw refused('mode create ou replace attendu.');
      },
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        const operatorId = request.operator_id!;
        const scopeType = payload.mode === 'create' ? payload.input.scope_type : (await this.feeRules.row(client, payload.fee_rule_id)).scope_type;
        const scopeId = payload.mode === 'create' ? payload.input.scope_id : (await this.feeRules.row(client, payload.fee_rule_id)).scope_id;
        const info = await this.feeRules.resolve(client, scopeType, scopeId);
        if (!info || info.eventId !== payload.event_id) throw conflict('La portée de la règle ne correspond plus à cet événement.');
        assertOpen(info.eventStatus ?? '');
        if (payload.mode === 'create') {
          return { result: await this.feeRules.create(client, operatorId, payload.input, info, requester(requestedBy), approvedBy) };
        }
        const previous = await this.feeRules.row(client, payload.fee_rule_id);
        return { result: await this.feeRules.replace(client, operatorId, previous, payload.input, info, requester(requestedBy), approvedBy) };
      },
    };
  }
}
