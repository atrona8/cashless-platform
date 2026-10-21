// Routes du back-office des terminaux (contrat : `listDevices`, `getDevice`, `suspendDevice`,
// `reactivateDevice`, `revokeDevice` ; `listDeviceEnrollmentCodes` est servie par le lot WP14).
// Personne authentifiée (garde globale) ; prestataire de la transaction : celui de la personne.
// Rôles : `OPERATOR_ADMIN` (tout le prestataire), `ORGANIZER_ADMIN` (terminaux des événements de
// ses organisateurs) ; une personne suffit (hypothèse A2). Écritures idempotentes (`bo:`), motif
// obligatoire, transition, historique et audit dans `IdempotentTx.run`.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import { pageOf, pageRequest, requireUuid } from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { deviceAdminDto, parseDeviceListFilter, parseStatusChange } from './device-admin.dto';
import { DeviceAdminService, type DeviceTransition } from './device-admin.service';

const DEVICE_ADMINS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

const SUSPEND: DeviceTransition = { to: 'SUSPENDED', action: 'DEVICE_SUSPENDED' };
const REACTIVATE: DeviceTransition = { to: 'ACTIVE', action: 'DEVICE_REACTIVATED' };
const REVOKE: DeviceTransition = { to: 'REVOKED', action: 'DEVICE_REVOKED' };

@Controller('devices')
export class DeviceAdminController {
  constructor(
    private readonly access: TenantAccess,
    private readonly devices: DeviceAdminService,
  ) {}

  @Get()
  list(
    @Req() req: Request,
    @Query() query: Record<string, string | undefined>,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, DEVICE_ADMINS);
    const filter = parseDeviceListFilter(query);
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) =>
      pageOf(await this.devices.list(client, actor, filter, page), page, deviceAdminDto),
    );
  }

  @Get(':device_id')
  get(@Req() req: Request, @Param('device_id') deviceId: string) {
    const actor = this.access.actor(req, DEVICE_ADMINS);
    const id = requireUuid(deviceId);
    return this.access.read(actor, (client) => this.devices.detail(client, actor, id));
  }

  @Post(':device_id/suspend')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  suspend(
    @Req() req: Request,
    @Param('device_id') deviceId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.change(req, deviceId, body, tx, SUSPEND);
  }

  @Post(':device_id/reactivate')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  reactivate(
    @Req() req: Request,
    @Param('device_id') deviceId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.change(req, deviceId, body, tx, REACTIVATE);
  }

  @Post(':device_id/revoke')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  revoke(
    @Req() req: Request,
    @Param('device_id') deviceId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.change(req, deviceId, body, tx, REVOKE);
  }

  private change(
    req: Request,
    deviceId: string,
    body: unknown,
    tx: IdempotentTx,
    transition: DeviceTransition,
  ) {
    const actor = this.access.actor(req, DEVICE_ADMINS);
    const id = requireUuid(deviceId);
    const reason = parseStatusChange(body);
    return tx.run((client) => this.devices.transition(client, actor, id, transition, reason));
  }
}
