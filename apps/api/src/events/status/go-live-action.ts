// Action à deux personnes `EVENT_GO_LIVE` (research R-08, R-09) : mise en service d'un événement. ORGANIZER_ADMIN de
// l'organisateur de l'événement, pour l'auteur comme pour le valideur. Le payload figé porte le statut visé et la
// version de configuration en vigueur à la demande. À l'exécution : la configuration n'a pas changé et les
// conditions sont toujours remplies, sinon la demande passe FAILED ; `set_event_status` est appelée avec l'auteur
// de la demande, et l'audit porte le valideur.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../../approval/action-registry';
import { ProblemException } from '../../errors/problem';
import { conflict, isUuid } from '../../organization/platform/platform.dto';
import { EventsService } from '../events.service';
import { StatusService } from './status.service';

export interface GoLivePayload {
  event_id: string;
  to: 'LIVE';
  config_version_id: string | null;
}

@Injectable()
export class GoLiveAction {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly events: EventsService,
    private readonly status: StatusService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  private definition(): ApprovalActionDefinition<GoLivePayload> {
    return {
      action: 'EVENT_GO_LIVE',
      requiredRole: 'ORGANIZER_ADMIN',
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.event_id }),
      validate: (raw) => {
        const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        if (!isUuid(payload.event_id) || payload.to !== 'LIVE') {
          throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'event_id et to = LIVE attendus.' });
        }
        return { event_id: payload.event_id, to: 'LIVE', config_version_id: isUuid(payload.config_version_id) ? payload.config_version_id : null };
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => {
        const event = await this.events.row(client, payload.event_id);
        if ((await this.events.currentVersionId(client, event.id)) !== payload.config_version_id) {
          throw conflict('La configuration a changé depuis la demande.');
        }
        await this.status.assertMet(client, event, 'LIVE', 'fr');
        return {
          result: await this.status.apply(
            client,
            event,
            'LIVE',
            requestedBy,
            { actorId: requestedBy, actorRole: 'ORGANIZER_ADMIN', origin: null, requestId: null },
            approvedBy,
          ),
        };
      },
    };
  }
}
