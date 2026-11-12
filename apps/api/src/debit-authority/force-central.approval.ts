// Action à deux personnes `FORCE_CENTRAL_AUTHORITY` : reprise forcée de l'autorité de débit (mission
// passerelle-locale, lot WP11, T048 ; FR-007, C-003, R-06). L'`OPERATOR_ADMIN` demande, un AUTRE `OPERATOR_ADMIN`
// approuve (auteur ≠ valideur : service d'approbation ET base). Aucun rôle de guichet, aucun `ORGANIZER_ADMIN`.
//
// SÉCURITÉ : `force_central_authority_approved` n'écrit pas `EXECUTED` et ne contrôle pas `expires_at`. Elle n'est
// sûre que appelée par `definition.execute` du service d'approbation (approval.service.ts : échéance contrôlée par
// `decide_approval_request`, exécution sous point de sauvegarde, passage à `EXECUTED`). Cette classe en est
// l'UNIQUE appelant (un test d'architecture le prouve) ; ni `force_central_authority` brute ni `set_debit_authority`
// ne sont appelées par l'application (C-003).
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import { AuditService } from '../audit/audit.service';
import { ProblemException } from '../errors/problem';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { isUuid, unprocessable } from '../organization/platform/platform.dto';
import { handoverDto, type HandoverRow } from './debit-authority.mapper';

/** Rôle qui demande et approuve : jamais un autre (test de bornage). */
export const FORCE_CENTRAL_ROLES = ['OPERATOR_ADMIN'] as const;

/** Taille maximale du motif (texte d'une ligne). */
export const FORCE_REASON_MAX = 500;

export interface ForceCentralPayload {
  ledger_id: string;
  reason: string;
  edge_gateway_id: string;
  /** Portée figée à la demande : l'événement du grand livre, lu en base. */
  scope_id: string;
  /** Confirmation, par la personne qui demande, que la passerelle est hors ligne (consignée à l'audit). */
  gateway_confirmed_offline: true;
}

const FIELDS = new Set([
  'ledger_id',
  'reason',
  'edge_gateway_id',
  'scope_id',
  'gateway_confirmed_offline',
]);

@Injectable()
export class ForceCentralActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  private definition(): ApprovalActionDefinition<ForceCentralPayload> {
    return {
      action: 'FORCE_CENTRAL_AUTHORITY',
      requiredRole: FORCE_CENTRAL_ROLES as readonly StaffRole[],
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.ledger_id)
          throw new ProblemException('VALIDATION_FAILED', {
            status: 422,
            detail: 'Le grand livre visé par la demande n’est pas celui de sa charge utile.',
          });
        let handover: HandoverRow;
        try {
          // Seul appel de l'application : la fonction exige une demande APPROVED, deux personnes distinctes,
          // jamais exécutée, du même prestataire et du même grand livre. Le motif est celui figé à la demande.
          const { rows } = await client.query<HandoverRow>(
            'SELECT * FROM force_central_authority_approved($1, $2, $3)',
            [payload.ledger_id, request.id, payload.reason],
          );
          handover = rows[0]!;
        } catch (error) {
          // 42501 : demande inutilisable (déjà exécutée, autre grand livre) ; CL013 : le rendu normal a abouti.
          if (isSqlError(error) && error.code === '42501')
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'Approbation inutilisable pour cette reprise forcée.',
            });
          throw error;
        }
        const { rows: after } = await client.query<{ epoch: string }>(
          'SELECT epoch FROM get_debit_authority($1)',
          [payload.ledger_id],
        );
        const result = {
          ledger_id: payload.ledger_id,
          authority: 'CENTRAL',
          epoch: Number(after[0]?.epoch),
          handover: handoverDto(handover),
        };
        await this.audit.record(client, {
          actorId: approvedBy,
          actorRole: 'OPERATOR_ADMIN',
          origin: null,
          requestId: null,
          operatorId: request.operator_id,
          action: 'EDGE_AUTHORITY_FORCED',
          objectType: 'debit_authority_handover',
          objectId: handover.id,
          approverId: approvedBy,
          after: {
            ledger_id: payload.ledger_id,
            edge_gateway_id: payload.edge_gateway_id,
            epoch: result.epoch,
            reason: payload.reason,
            requested_by: requestedBy,
            approval_request_id: request.id,
            gateway_confirmed_offline: payload.gateway_confirmed_offline,
          },
        });
        return { result };
      },
    };
  }
}

function validatePayload(raw: unknown): ForceCentralPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (!isUuid(p.ledger_id) || !isUuid(p.scope_id) || !isUuid(p.edge_gateway_id))
    throw unprocessable('ledger_id, edge_gateway_id et scope_id attendus.');
  if (p.gateway_confirmed_offline !== true)
    throw unprocessable('gateway_confirmed_offline : true exigé pour une reprise forcée.');
  if (
    typeof p.reason !== 'string' ||
    p.reason.trim() === '' ||
    p.reason.length > FORCE_REASON_MAX ||
    /[\r\n]/.test(p.reason)
  )
    throw unprocessable(`reason : texte d’une ligne de 1 à ${FORCE_REASON_MAX} caractères.`);
  return {
    ledger_id: p.ledger_id,
    reason: p.reason.trim(),
    edge_gateway_id: p.edge_gateway_id,
    scope_id: p.scope_id,
    gateway_confirmed_offline: true,
  };
}
