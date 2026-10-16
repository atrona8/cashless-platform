// Action à deux personnes `REINSTATE_MEDIA` (contrat `requestMediaReinstatement` ; SPECIFICATION
// §7.8 ; FR-035) : la demande ne change rien ; à l'approbation par une AUTRE personne habilitée
// sur la même portée, `reinstate_media` remet le bracelet en service. C'est le seul appel de
// `reinstate_media` de l'API. La demande est liée à l'épisode de liste noire qu'elle lève
// (`blacklist_history_id`, dernière ligne de l'historique vers BLACKLISTED à la demande).
// Revalidation à l'exécution : un bracelet qui n'est plus en liste noire (remplacé, retiré), ou
// remis en service puis de nouveau mis en liste noire depuis la demande, fait passer la demande
// FAILED avec le motif.
//
// Ce que la base garantit (migration 0017, levée d'OP-N52) : hors de `reinstate_media`, aucune
// sortie de liste noire ; dans `reinstate_media`, il faut une demande `REINSTATE_MEDIA` APPROVED
// de ce prestataire, pour ce bracelet et cet épisode de liste noire, dont l'auteur et le valideur
// sont ceux de l'appel, distincts, personnes actives du prestataire, le valideur SUPERVISOR.
// L'appel se fait donc ici, après `decide_approval_request` et avant le passage EXECUTED. La
// portée exacte de l'habilitation reste contrôlée par l'API (ApprovalService).
import { Injectable } from '@nestjs/common';
import {
  ApprovalActionRegistry,
  type ApprovalActionDefinition,
} from '../../approval/action-registry';
import { AuditService } from '../../audit/audit.service';
import { ProblemException } from '../../errors/problem';
import type { ScopeRef } from '../../identity/scope-resolver';
import { isUuid } from '../../organization/platform/platform.dto';
import { BLACKLIST_ROLE, lastBlacklisting } from './blacklist.service';

export interface ReinstatePayload {
  media_id: string;
  reason: string;
  /** Portée figée à la demande : celle du bracelet à ce moment (événement, sinon organisateur). */
  scope_type: 'EVENT' | 'ORGANIZER';
  scope_id: string;
  /** Épisode levé : `media_status_history.id` (texte) de la mise en liste noire en cours. */
  blacklist_history_id: string;
}

const HISTORY_ID = /^[1-9][0-9]{0,18}$/;

const bad = (detail: string) => new ProblemException('VALIDATION_FAILED', { status: 422, detail });

@Injectable()
export class BlacklistApprovalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly audit: AuditService,
  ) {
    registry.register(this.reinstate() as ApprovalActionDefinition);
  }

  private reinstate(): ApprovalActionDefinition<ReinstatePayload> {
    return {
      action: 'REINSTATE_MEDIA',
      requiredRole: BLACKLIST_ROLE,
      scopeOf: (payload): ScopeRef => ({ type: payload.scope_type, id: payload.scope_id }),
      validate: (raw) => {
        const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        const scopeType =
          p.scope_type === 'EVENT' || p.scope_type === 'ORGANIZER' ? p.scope_type : null;
        const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
        const historyId =
          typeof p.blacklist_history_id === 'string' && HISTORY_ID.test(p.blacklist_history_id)
            ? p.blacklist_history_id
            : null;
        if (
          !isUuid(p.media_id) ||
          !scopeType ||
          !isUuid(p.scope_id) ||
          !historyId ||
          reason === '' ||
          reason.length > 500
        ) {
          throw bad(
            'media_id, reason (1 à 500 caractères), scope_type, scope_id et ' +
              'blacklist_history_id attendus.',
          );
        }
        return {
          media_id: p.media_id,
          reason,
          scope_type: scopeType,
          scope_id: p.scope_id,
          blacklist_history_id: historyId,
        };
      },
      execute: async (client, { payload, requestedBy, approvedBy, request }) => {
        const { rows } = await client.query<{ status: string }>(
          'SELECT status FROM media WHERE id = $1 FOR UPDATE',
          [payload.media_id],
        );
        const status = rows[0]?.status;
        if (status !== 'BLACKLISTED') {
          throw new ProblemException('MEDIA_STATE_INVALID', {
            status: 409,
            detail:
              `Le bracelet n’est plus en liste noire (${status ?? 'introuvable'}) : ` +
              'rien à remettre en service.',
          });
        }
        // Même épisode qu'à la demande : sinon le bracelet a été remis en service puis de nouveau
        // mis en liste noire, pour un autre motif, que cette demande ne couvre pas.
        const current = await lastBlacklisting(client, payload.media_id);
        if (current !== payload.blacklist_history_id) {
          throw new ProblemException('CONFLICT_STATE', {
            status: 409,
            detail:
              'Le bracelet a été remis en liste noire depuis la demande : elle ne couvre pas ' +
              'cette nouvelle mise en liste noire ; une nouvelle demande est nécessaire.',
          });
        }
        await client.query('SELECT reinstate_media($1, $2, $3, $4)', [
          payload.media_id,
          requestedBy,
          approvedBy,
          payload.reason,
        ]);
        // `reinstate_media` laisse auteur, valideur et motif posés jusqu'à la fin de la
        // transaction : un autre changement d'état dans la même transaction en hériterait.
        await client.query(
          `SELECT set_config('app.user_id', '', true), set_config('app.approved_by', '', true),
                  set_config('app.reason', '', true)`,
        );
        await this.audit.record(client, {
          actorId: approvedBy,
          actorRole: BLACKLIST_ROLE,
          origin: null,
          requestId: null,
          operatorId: request.operator_id,
          action: 'MEDIA_REINSTATED',
          objectType: 'media',
          objectId: payload.media_id,
          approverId: approvedBy,
          before: { status: 'BLACKLISTED' },
          after: {
            status: 'ACTIVE',
            reason: payload.reason,
            requested_by: requestedBy,
            blacklist_history_id: payload.blacklist_history_id,
          },
        });
        return { result: { media_id: payload.media_id, status: 'ACTIVE' } };
      },
    };
  }
}
