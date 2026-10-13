// Actions à deux personnes sur un événement en service (research R-09, contrat event-lifecycle §4) : modification
// des réglages de l'organisateur (`EVENT_SETTINGS_CHANGE`, ORGANIZER_ADMIN) ou du prestataire
// (`EVENT_OPERATOR_SETTINGS_CHANGE`, OPERATOR_ADMIN). Le payload figé porte la modification exacte et la version de
// configuration en vigueur à la demande : si elle n'est plus la dernière à l'exécution, ou si une borne n'est plus
// respectée, la demande passe FAILED et rien n'est modifié.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalAction, type ApprovalActionDefinition } from '../approval/action-registry';
import { regulatingRole, settingOf } from '../configuration/settings-catalog';
import { ProblemException } from '../errors/problem';
import { conflict, isUuid } from '../organization/platform/platform.dto';
import { UPDATE_KEYS } from './events.dto';
import { EventsService } from './events.service';

export interface EventSettingsPayload {
  event_id: string;
  changes: Record<string, unknown>;
  /** Version de configuration `EVENT` en vigueur à la demande. */
  config_version_id: string | null;
}

const refused = (detail: string): ProblemException => new ProblemException('VALIDATION_FAILED', { status: 422, detail });

@Injectable()
export class EventApprovalActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly events: EventsService,
  ) {
    registry.register(this.settingsChange('EVENT_SETTINGS_CHANGE', 'ORGANIZER_ADMIN') as ApprovalActionDefinition);
    registry.register(this.settingsChange('EVENT_OPERATOR_SETTINGS_CHANGE', 'OPERATOR_ADMIN') as ApprovalActionDefinition);
  }

  private settingsChange(action: ApprovalAction, role: 'ORGANIZER_ADMIN' | 'OPERATOR_ADMIN'): ApprovalActionDefinition<EventSettingsPayload> {
    return {
      action,
      requiredRole: role,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.event_id }),
      validate: (raw) => {
        const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        const changes = (typeof payload.changes === 'object' && payload.changes !== null ? payload.changes : {}) as Record<string, unknown>;
        const keys = Object.keys(changes);
        if (!isUuid(payload.event_id) || keys.length === 0) throw refused('event_id et changes attendus.');
        // Toutes les clés sont réglées par le rôle de l'action : jamais un mélange.
        const foreign = keys.filter((key) => !UPDATE_KEYS.includes(key) || regulatingRole(settingOf(key)!, 'EVENT') !== role);
        if (foreign.length > 0) throw refused(`Réglage hors de cette action : ${foreign.join(', ')}.`);
        const version = payload.config_version_id;
        return { event_id: payload.event_id, changes, config_version_id: isUuid(version) ? version : null };
      },
      execute: async (client, { payload, requestedBy, approvedBy }) => {
        const row = await this.events.row(client, payload.event_id);
        if (row.status !== 'LIVE' && row.status !== 'DRAFT') throw conflict('L\'événement n\'est plus modifiable dans son statut actuel.');
        if ((await this.events.currentVersionId(client, row.id)) !== payload.config_version_id) {
          throw conflict('La configuration a changé depuis la demande.');
        }
        await this.events.check(client, row, payload.changes, 'fr');
        return {
          result: await this.events.apply(client, row, payload.changes, { actorId: requestedBy, actorRole: role, origin: null, requestId: null }, approvedBy),
        };
      },
    };
  }
}
