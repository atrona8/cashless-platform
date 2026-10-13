// Routes de participation et de point de vente (contrat, tag Événements), sous `/operators/{operator_id}`. Écriture :
// ORGANIZER_ADMIN de l'organisateur de l'événement — immédiate tant que l'événement est DRAFT, à deux personnes
// (`PARTICIPATION_CHANGE`) quand il est LIVE, refusée ensuite. Lecture : comme l'événement, plus le MERCHANT_ADMIN
// pour la participation de son commerçant. Écritures idempotentes (`bo:`), travail et audit dans IdempotentTx.run.
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import { conflict, pageOf, pageRequest, requireUuid } from '../../organization/platform/platform.dto';
import { scopesHeld, TenantAccess, type TenantActor } from '../../organization/tenant/tenant-access';
import { canReadEvent } from '../events.controller';
import {
  parseParticipationCreate,
  parseParticipationUpdate,
  parsePointOfSale,
  participationDto,
  ParticipationsService,
  pointOfSaleDto,
  type EventRef,
  type ParticipationRow,
} from './participations.service';

const READERS: readonly Role[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'MERCHANT_ADMIN'];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN'];

@Controller('operators/:operator_id')
export class ParticipationsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly participations: ParticipationsService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get('events/:event_id/participations')
  async list(@Req() req: Request, @Param('event_id') eventId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, READERS);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, async (client) => {
      const event = await this.participations.event(client, requireUuid(eventId));
      // Hors de la portée de lecture de l'événement, un MERCHANT_ADMIN ne voit que la participation de son commerçant.
      const merchants = canReadEvent(actor, event) ? null : scopesHeld(actor.principal, 'MERCHANT_ADMIN', 'MERCHANT');
      if (merchants !== null && merchants.length === 0) throw new ProblemException('FORBIDDEN');
      return this.participations.list(client, event.id, merchants, page.offset, page.limit + 1);
    });
    return pageOf(rows, page, participationDto);
  }

  @Post('events/:event_id/participations')
  @Idempotent({ scope: 'bo:' })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const input = parseParticipationCreate(body);
    return tx.run(async (client) => {
      const event = await this.writable(client, actor, await this.participations.event(client, requireUuid(eventId)));
      if (event.status === 'LIVE') {
        // Refus immédiats avant la demande ; refaits à l'exécution.
        await this.participations.checkCreate(client, event.id, input);
        return this.demand(client, res, actor, event, { event_id: event.id, mode: 'create', input });
      }
      const created = await this.participations.create(client, event, input, actor.audit);
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/participations/${created.participation_id}`);
      return created;
    });
  }

  @Get('participations/:participation_id')
  get(@Req() req: Request, @Param('participation_id') participationId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) => participationDto((await this.readable(client, actor, participationId)).row));
  }

  @Patch('participations/:participation_id')
  @Idempotent({ scope: 'bo:' })
  update(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('participation_id') participationId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const changes = parseParticipationUpdate(body);
    return tx.run(async (client) => {
      const row = await this.participations.row(client, requireUuid(participationId));
      const event = await this.writable(client, actor, await this.participations.event(client, row.event_id));
      if (event.status === 'LIVE') {
        this.participations.merged(row, changes);
        return this.demand(client, res, actor, event, { event_id: event.id, mode: 'update', participation_id: row.id, changes });
      }
      return this.participations.update(client, row, changes, actor.audit);
    });
  }

  // ------------------------------------------------------------------ Points de vente

  @Get('participations/:participation_id/points-of-sale')
  async listPointsOfSale(@Req() req: Request, @Param('participation_id') participationId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, READERS);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, async (client) => {
      const { row } = await this.readable(client, actor, participationId);
      return this.participations.listPointsOfSale(client, row.id, page.offset, page.limit + 1);
    });
    return pageOf(rows, page, pointOfSaleDto);
  }

  @Post('participations/:participation_id/points-of-sale')
  @Idempotent({ scope: 'bo:' })
  createPointOfSale(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('participation_id') participationId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const name = parsePointOfSale(body);
    return tx.run(async (client) => {
      const row = await this.participations.row(client, requireUuid(participationId));
      await this.writable(client, actor, await this.participations.event(client, row.event_id));
      const created = await this.participations.createPointOfSale(client, row, name, actor.audit);
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/points-of-sale/${created.pos_id}`);
      return created;
    });
  }

  @Get('points-of-sale/:pos_id')
  getPointOfSale(@Req() req: Request, @Param('pos_id') posId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) => {
      const pos = await this.participations.pointOfSale(client, requireUuid(posId));
      await this.readable(client, actor, pos.participation_id);
      return pointOfSaleDto(pos);
    });
  }

  @Patch('points-of-sale/:pos_id')
  @Idempotent({ scope: 'bo:' })
  renamePointOfSale(@Req() req: Request, @Param('pos_id') posId: string, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, WRITERS);
    const name = parsePointOfSale(body);
    return tx.run(async (client) => {
      const pos = await this.participations.pointOfSale(client, requireUuid(posId));
      const row = await this.participations.row(client, pos.participation_id);
      await this.writable(client, actor, await this.participations.event(client, row.event_id));
      return this.participations.renamePointOfSale(client, pos, name, actor.audit);
    });
  }

  // ------------------------------------------------------------------ Aides

  /** Participation du prestataire (404 sinon) que la personne peut lire (403 sinon). */
  private async readable(client: TxClient, actor: TenantActor, participationId: string): Promise<{ row: ParticipationRow; event: EventRef }> {
    const row = await this.participations.row(client, requireUuid(participationId));
    const event = await this.participations.event(client, row.event_id);
    const own = scopesHeld(actor.principal, 'MERCHANT_ADMIN', 'MERCHANT').includes(row.merchant_id);
    if (!canReadEvent(actor, event) && !own) throw new ProblemException('FORBIDDEN');
    return { row, event };
  }

  /** L'ORGANIZER_ADMIN doit administrer l'organisateur de l'événement (403) ; un événement après LIVE n'accepte plus rien (409). */
  private async writable(_client: TxClient, actor: TenantActor, event: EventRef): Promise<EventRef> {
    if (!scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(event.organizer_id)) throw new ProblemException('FORBIDDEN');
    if (event.status !== 'DRAFT' && event.status !== 'LIVE') throw conflict(`L'événement est ${event.status} : ses participations ne se modifient plus.`);
    return event;
  }

  /** Événement en service : demande à deux personnes `PARTICIPATION_CHANGE`. */
  private async demand(client: TxClient, res: Response, actor: TenantActor, event: EventRef, payload: object) {
    const request = await this.approvals.request(
      client,
      actor.operatorId,
      { action: 'PARTICIPATION_CHANGE', targetId: event.id, payload },
      { principal: actor.principal, audit: actor.audit },
    );
    return respondAccepted(res, request);
  }
}
