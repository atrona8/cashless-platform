// Choix de configuration PSP par événement (mission 6, lot WP10, T051). Hors `LIVE` : écriture directe par
// `set_event_psp_selection` ; en `LIVE` : jamais d'écriture, une demande à deux personnes. La base arbitre
// (organisateur, ACTIVE, moyen, titulaire des fonds) ; l'état de l'événement est relu DANS la transaction.
import { Injectable } from '@nestjs/common';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { isSqlError } from '../errors/sqlstate-map';
import { notFound, unprocessable } from '../organization/platform/platform.dto';
import { scopesHeld, type TenantActor } from '../organization/tenant/tenant-access';
import { EventPspSelectionActions, selectionFailure } from './event-psp-selection-action';
import type { PspMethod } from './psp-configurations.dto';

export interface SelectionRow {
  event_id: string;
  method: string;
  psp_configuration_id: string;
  selected_by: string;
  approved_by: string | null;
  selected_at: Date;
}

const toDto = (row: SelectionRow) => ({
  event_id: row.event_id,
  method: row.method,
  psp_config_id: row.psp_configuration_id,
  selected_by: row.selected_by,
  approved_by: row.approved_by,
  selected_at: row.selected_at.toISOString(),
});
export type EventPspSelectionDto = ReturnType<typeof toDto>;

const COLUMNS = 'event_id, method, psp_configuration_id, selected_by, approved_by, selected_at';

@Injectable()
export class EventPspSelectionService {
  constructor(
    private readonly audit: AuditService,
    private readonly actions: EventPspSelectionActions,
  ) {}

  /** Événement du prestataire (RLS) dont l'organisateur est administré par l'appelant ; sinon `404`. */
  private async event(client: TxClient, actor: TenantActor, eventId: string) {
    const { rows } = await client.query<{ organizer_id: string; status: string }>(
      'SELECT organizer_id, status FROM event WHERE id = $1',
      [eventId],
    );
    const event = rows[0];
    if (
      !event ||
      (actor.role === 'ORGANIZER_ADMIN' &&
        !scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(event.organizer_id))
    )
      throw notFound();
    return event;
  }

  async list(client: TxClient, actor: TenantActor, eventId: string) {
    await this.event(client, actor, eventId);
    const { rows } = await client.query<SelectionRow>(
      `SELECT ${COLUMNS} FROM event_psp_selection WHERE event_id = $1 ORDER BY method`,
      [eventId],
    );
    return { data: rows.map(toDto) };
  }

  /** `{ accepted }` : demande créée (`202`, `LIVE`) ; `{ selection }` : choix écrit (`200`). */
  async set(
    client: TxClient,
    actor: TenantActor,
    eventId: string,
    method: PspMethod,
    configId: string,
  ): Promise<{ accepted: ApprovalRequestDto } | { selection: EventPspSelectionDto }> {
    const event = await this.event(client, actor, eventId);
    const { rows: config } = await client.query(
      'SELECT 1 FROM psp_configuration WHERE psp_configuration_id = $1',
      [configId],
    );
    if (!config[0]) throw unprocessable('psp_config_id : configuration introuvable.');
    if (event.status === 'LIVE') {
      const accepted = await this.actions.request(
        client,
        actor.operatorId,
        { eventId, method, configId },
        { principal: actor.principal, audit: actor.audit },
      );
      return { accepted };
    }
    const { rows: before } = await client.query<SelectionRow>(
      `SELECT ${COLUMNS} FROM event_psp_selection WHERE event_id = $1 AND method = $2`,
      [eventId, method],
    );
    try {
      await client.query('SELECT set_event_psp_selection($1, $2, $3, $4)', [
        eventId,
        method,
        configId,
        actor.principal.userId,
      ]);
    } catch (error) {
      // Événement passé `LIVE` entre la lecture et l'écriture : jamais une écriture directe.
      if (isSqlError(error) && error.code === 'CL023')
        throw new ProblemException('CONFLICT_STATE', {
          detail: 'L’événement est passé en direct : le choix demande une seconde personne.',
        });
      throw selectionFailure(error);
    }
    const { rows } = await client.query<SelectionRow>(
      `SELECT ${COLUMNS} FROM event_psp_selection WHERE event_id = $1 AND method = $2`,
      [eventId, method],
    );
    const selection = toDto(rows[0]!);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'EVENT_PSP_SELECTION_CHANGED',
      objectType: 'event_psp_selection',
      objectId: eventId,
      before: before[0] ? toDto(before[0]) : null,
      after: selection,
    });
    return { selection };
  }
}
