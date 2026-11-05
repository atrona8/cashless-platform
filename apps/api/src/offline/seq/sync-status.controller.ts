// `GET /v1/events/{event_id}/device-sync-status` (`getEventDeviceSyncStatus`, mission 7, lot WP21, partie D ;
// ADR-73). Rôles de `getEventOfflineRisk` : `ORGANIZER_ADMIN` (de l'organisateur de l'événement) et
// `OPERATOR_ADMIN`. Aucun rôle tenu : 403 ; événement inexistant, d'un autre prestataire ou d'un autre
// organisateur : 404 neutre. La lecture passe par `event_device_sync_status_api` (0051), seule porte ouverte à
// `cashless_app` : `event_device_sync_status` et `event_sync_deadline` lui restent fermées.
import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { TxClient } from '../../db/tenant-tx';
import { hasRole, type Role } from '../../identity/principal';
import { notFound, requireUuid } from '../../organization/platform/platform.dto';
import { scopesHeld, TenantAccess } from '../../organization/tenant/tenant-access';

const READERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

export interface DeviceSyncStatusDto {
  sync_deadline: string | null;
  devices: Array<{ device_id: string; serial: string; caught_up: boolean; reason: string | null }>;
}

@Controller('events')
export class SyncStatusController {
  constructor(private readonly access: TenantAccess) {}

  @Get(':event_id/device-sync-status')
  status(@Req() req: Request, @Param('event_id') rawId: string): Promise<DeviceSyncStatusDto> {
    const actor = this.access.actor(req, READERS);
    const eventId = requireUuid(rawId);
    return this.access.read(actor, async (client: TxClient) => {
      const event = await client.query<{ organizer_id: string }>(
        'SELECT organizer_id FROM event WHERE id = $1 AND operator_id = $2',
        [eventId, actor.operatorId],
      );
      if (event.rows.length === 0) throw notFound();
      const organizerAdmin = scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(
        event.rows[0]!.organizer_id,
      );
      if (!organizerAdmin && !hasRole(actor.principal, 'OPERATOR_ADMIN')) throw notFound();
      const { rows } = await client.query<{
        sync_deadline: Date | null;
        device_id: string | null;
        serial: string | null;
        caught_up: boolean | null;
        reason: string | null;
      }>('SELECT * FROM event_device_sync_status_api($1)', [eventId]);
      const deadline = rows[0]?.sync_deadline ?? null;
      return {
        sync_deadline: deadline === null ? null : deadline.toISOString(),
        devices: rows
          .filter((r) => r.device_id !== null)
          .map((r) => ({
            device_id: r.device_id!,
            serial: r.serial!,
            caught_up: r.caught_up!,
            reason: r.reason,
          })),
      };
    });
  }
}
