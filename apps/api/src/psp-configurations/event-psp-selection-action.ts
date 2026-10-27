// Action à deux personnes `EVENT_PSP_SELECTION` (mission 6, lot WP10, T051 ; FR-010) : choix de configuration PSP
// d'un événement `LIVE`. Charge `{event_id, method, psp_configuration_id, scope_type, scope_id}`, portée lue en base.
// `set_event_psp_selection` contrôle seconde personne, organisateur, `ACTIVE`, moyen et titulaire des fonds.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { isUuid, unprocessable } from '../organization/platform/platform.dto';
import { PSP_METHODS, type PspMethod } from './psp-configurations.dto';

/** Rôle qui demande et approuve : l'ORGANIZER_ADMIN seul (test de bornage). */
export const EVENT_PSP_SELECTION_ROLES: readonly StaffRole[] = ['ORGANIZER_ADMIN'];

export interface EventPspSelectionPayload {
  event_id: string;
  method: PspMethod;
  psp_configuration_id: string;
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = new Set(['event_id', 'method', 'psp_configuration_id', 'scope_type', 'scope_id']);

/** Traduction des refus SQL du choix, partagée avec l'écriture directe. */
export const SELECTION_FAILURES: Readonly<Record<string, string>> = {
  CL023: 'Choix refusé : demande approuvée par une autre personne obligatoire, ou déjà utilisée.',
  CL029: 'Choix refusé : l’événement n’est plus en brouillon ni en direct.',
  CL001:
    'Choix refusé : configuration inactive, d’un autre organisateur, d’un autre moyen ou ' +
    'dont le titulaire n’est pas le détenteur des fonds.',
  P0002: 'Événement ou configuration introuvable.',
};

export function selectionFailure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SELECTION_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SELECTION_FAILURES[error.code]!,
  });
}

@Injectable()
export class EventPspSelectionActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /** Crée la demande (événement `LIVE`) ; la portée est l'événement lu en base. */
  request(
    client: TxClient,
    operatorId: string,
    input: { eventId: string; method: PspMethod; configId: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const payload: EventPspSelectionPayload = {
      event_id: input.eventId,
      method: input.method,
      psp_configuration_id: input.configId,
      scope_type: 'EVENT',
      scope_id: input.eventId,
    };
    return this.approvals.request(
      client,
      operatorId,
      { action: 'EVENT_PSP_SELECTION', targetId: input.eventId, payload },
      actor,
    );
  }

  private definition(): ApprovalActionDefinition<EventPspSelectionPayload> {
    return {
      action: 'EVENT_PSP_SELECTION',
      requiredRole: EVENT_PSP_SELECTION_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        try {
          const { rows: before } = await client.query(
            `SELECT psp_configuration_id FROM event_psp_selection WHERE event_id = $1 AND method = $2`,
            [payload.event_id, payload.method],
          );
          await client.query('SELECT set_event_psp_selection($1, $2, $3, $4, $5)', [
            payload.event_id,
            payload.method,
            payload.psp_configuration_id,
            approvedBy,
            request.id,
          ]);
          await this.audit.record(client, {
            actorId: requestedBy,
            actorRole: 'ORGANIZER_ADMIN',
            origin: null,
            requestId: null,
            operatorId: request.operator_id,
            action: 'EVENT_PSP_SELECTION_CHANGED',
            objectType: 'event_psp_selection',
            objectId: payload.event_id,
            before: before[0] ?? null,
            after: { method: payload.method, psp_configuration_id: payload.psp_configuration_id },
            approverId: approvedBy,
          });
          return {
            result: {
              event_id: payload.event_id,
              method: payload.method,
              psp_configuration_id: payload.psp_configuration_id,
            },
            executedTxId: undefined,
          };
        } catch (error) {
          throw selectionFailure(error);
        }
      },
    };
  }
}

function validatePayload(raw: unknown): EventPspSelectionPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.event_id) ||
    !isUuid(p.psp_configuration_id) ||
    !isUuid(p.scope_id) ||
    p.scope_type !== 'EVENT' ||
    p.scope_id !== p.event_id
  )
    throw unprocessable('event_id, psp_configuration_id, scope_type (EVENT) et scope_id attendus.');
  if (typeof p.method !== 'string' || !(PSP_METHODS as readonly string[]).includes(p.method))
    throw unprocessable(`method : valeurs permises ${PSP_METHODS.join(', ')}.`);
  return {
    event_id: p.event_id,
    method: p.method as PspMethod,
    psp_configuration_id: p.psp_configuration_id,
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
