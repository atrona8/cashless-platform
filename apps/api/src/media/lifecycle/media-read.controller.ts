// Consultation d'un bracelet : au guichet (`GET /media/{id}`, terminal ET personne, bracelets de l'organisateur du
// terminal) et au back-office (`/operators/{operator_id}/media`, lecteurs de l'organisateur du lot, OPERATOR_ADMIN).
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Role } from '../../identity/principal';
import { invalid, isUuid, pageOf, pageRequest, requireUuid } from '../../organization/platform/platform.dto';
import { scopesHeld, TenantAccess, type TenantActor } from '../../organization/tenant/tenant-access';
import { BatchesService } from '../batches/batches.service';
import { CounterAccess, CounterAuth } from './counter-access';
import { mediaAdminDto, MediaReadService } from './media-read.service';

const READERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER'];
const STATUSES = ['PERSONALIZED', 'ISSUED', 'ACTIVE', 'SUSPENDED', 'REPLACED', 'BLACKLISTED', 'RELEASED', 'RETIRED', 'DESTROYED'];

@Controller()
export class MediaReadController {
  constructor(
    private readonly access: TenantAccess,
    private readonly counter: CounterAccess,
    private readonly media: MediaReadService,
    private readonly batches: BatchesService,
  ) {}

  @Get('media/:media_id')
  @CounterAuth()
  getForCounter(@Req() req: Request, @Param('media_id') mediaId: string) {
    const id = requireUuid(mediaId);
    return this.access.read({ operatorId: this.counterOperator(req) }, async (client) => {
      const actor = await this.counter.authorize(client, req);
      if ((await this.media.organizerOf(client, id)) !== actor.organizerId) throw new ProblemException('NOT_FOUND');
      return this.media.forCounter(client, id);
    });
  }

  @Get('operators/:operator_id/media')
  list(@Req() req: Request, @Query('batch_id') batchId?: string, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, READERS);
    if (batchId !== undefined && !isUuid(batchId)) throw invalid('batch_id : identifiant attendu.');
    if (status !== undefined && !STATUSES.includes(status)) throw invalid('status : valeur inconnue.');
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) =>
      pageOf(await this.media.list(client, { batchId, status, organizers: await this.readableOrganizers(client, actor) }, page.offset, page.limit + 1), page, mediaAdminDto),
    );
  }

  @Get('operators/:operator_id/media/:media_id')
  get(@Req() req: Request, @Param('media_id') mediaId: string) {
    const actor = this.access.actor(req, READERS);
    const id = requireUuid(mediaId);
    return this.access.read(actor, async (client) => {
      const organizer = await this.media.organizerOf(client, id);
      const readable = await this.readableOrganizers(client, actor);
      if (readable !== null && (organizer === null || !readable.includes(organizer))) throw new ProblemException('FORBIDDEN');
      return this.media.detail(client, id);
    });
  }

  private counterOperator(req: Request): string {
    return (req as Request & { device?: { operatorId: string } }).device!.operatorId;
  }

  /** Organisateurs dont la personne voit les bracelets (`null` : tous ceux du prestataire). */
  private async readableOrganizers(client: TxClient, actor: TenantActor): Promise<string[] | null> {
    const { principal } = actor;
    if (principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN')) return null;
    const direct = (['ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER'] as const).flatMap((role) => scopesHeld(principal, role, 'ORGANIZER'));
    const events = (['SUPERVISOR', 'CASHIER'] as const).flatMap((role) => scopesHeld(principal, role, 'EVENT'));
    return [...new Set([...direct, ...(await this.batches.organizersOfEvents(client, events))])];
  }
}
