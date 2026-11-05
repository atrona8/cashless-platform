// Plafond du prestataire, politique des trois portées et risque d'un événement (lot WP14 ;
// openapi.yaml, tag « Hors ligne », `getOfflineCeiling` à `getEventOfflineRisk`). La portée vient
// du chemin, jamais du corps. Hors périmètre : `404` neutre (jamais `403`, pas d'oracle
// d'existence) ; rôle absent : `403`.
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import type { RolesRequest } from '../../identity/roles.guard';
import { requireUuid } from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { parseUpdate, type PolicyScope } from './offline-policy.dto';
import { OfflinePolicyService } from './offline-policy.service';
import type { Role } from '../../identity/principal';

const READERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];
const CEILING_READERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

@Controller()
export class OfflinePolicyController {
  constructor(
    private readonly access: TenantAccess,
    private readonly policies: OfflinePolicyService,
  ) {}

  private read(req: Request, roles: readonly Role[], type: PolicyScope, rawId: string) {
    const actor = this.access.actor(req, roles);
    const id = requireUuid(rawId);
    return this.access.read(actor, (client) => this.policies.get(client, actor, type, id));
  }

  private write(
    req: Request,
    roles: readonly Role[],
    type: PolicyScope,
    rawId: string,
    body: unknown,
    tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, roles);
    const id = requireUuid(rawId);
    const update = parseUpdate(body);
    return tx.run(async (client) => {
      const { view, role } = await this.policies.put(client, actor, type, id, update);
      (req as RolesRequest).exercisedRole = role;
      return view;
    });
  }

  @Get('operators/:operator_id/offline-ceiling')
  getCeiling(@Req() req: Request, @Param('operator_id') id: string) {
    return this.read(req, CEILING_READERS, 'OPERATOR_CEILING', id);
  }

  @Put('operators/:operator_id/offline-ceiling')
  @Idempotent({ scope: 'bo:', keyUuid: true })
  setCeiling(
    @Req() req: Request,
    @Param('operator_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.write(req, ['OPERATOR_ADMIN'], 'OPERATOR_CEILING', id, body, tx);
  }

  @Get('organizers/:organizer_id/offline-policy')
  getOrganizer(@Req() req: Request, @Param('organizer_id') id: string) {
    return this.read(req, READERS, 'ORGANIZER', id);
  }

  @Put('organizers/:organizer_id/offline-policy')
  @Idempotent({ scope: 'bo:', keyUuid: true })
  setOrganizer(
    @Req() req: Request,
    @Param('organizer_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.write(req, WRITERS, 'ORGANIZER', id, body, tx);
  }

  @Get('events/:event_id/offline-policy')
  getEvent(@Req() req: Request, @Param('event_id') id: string) {
    return this.read(req, READERS, 'EVENT', id);
  }

  @Put('events/:event_id/offline-policy')
  @Idempotent({ scope: 'bo:', keyUuid: true })
  setEvent(
    @Req() req: Request,
    @Param('event_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.write(req, WRITERS, 'EVENT', id, body, tx);
  }

  @Get('devices/:device_id/offline-policy')
  getDevice(@Req() req: Request, @Param('device_id') id: string) {
    return this.read(req, READERS, 'DEVICE', id);
  }

  @Put('devices/:device_id/offline-policy')
  @Idempotent({ scope: 'bo:', keyUuid: true })
  setDevice(
    @Req() req: Request,
    @Param('device_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    return this.write(req, WRITERS, 'DEVICE', id, body, tx);
  }

  @Get('events/:event_id/offline-risk')
  getRisk(@Req() req: Request, @Param('event_id') rawId: string) {
    const actor = this.access.actor(req, READERS);
    const id = requireUuid(rawId);
    return this.access.read(actor, (client) => this.policies.getRisk(client, actor, id));
  }
}
