// Routes d'événement (contrat, tags Événements et Configuration), sous `/operators/{operator_id}` : création, liste,
// lecture, modification, configuration résolue. Écritures idempotentes (`bo:`), travail et audit dans
// IdempotentTx.run. Lecture : OPERATOR_ADMIN, ORGANIZER_ADMIN de l'organisateur, SUPERVISOR de l'événement (ou de son
// organisateur). Le statut se change ailleurs (transitionEventStatus).
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../approval/approval.service';
import { assertSettableBy } from '../configuration/bounds-validator';
import { CascadeService } from '../configuration/cascade.service';
import type { SettingRole } from '../configuration/settings-catalog';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { pickLanguage } from '../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import type { Role } from '../identity/principal';
import {
  conflict,
  invalid,
  isUuid,
  pageRequest,
  requireUuid,
  unprocessable,
} from '../organization/platform/platform.dto';
import { PartiesService } from '../organization/tenant/parties.service';
import { scopesHeld, TenantAccess, type TenantActor } from '../organization/tenant/tenant-access';
import { eventDto, parseEventCreate, parseEventUpdate, type EventRow } from './events.dto';
import { EventsService } from './events.service';

const READERS: readonly Role[] = [
  'PLATFORM_ADMIN',
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'SUPERVISOR',
];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];
const STATUSES = ['DRAFT', 'LIVE', 'CLOSING', 'RECONCILING', 'SETTLING', 'REFUND_WINDOW', 'CLOSED'];

/** L'événement est-il dans la portée de lecture de la personne ? (les rôles du prestataire voient tout) */
export function canReadEvent(
  actor: TenantActor,
  event: Pick<EventRow, 'id' | 'organizer_id'>,
): boolean {
  const { principal } = actor;
  if (principal.assignments.some((a) => a.role === 'PLATFORM_ADMIN' || a.role === 'OPERATOR_ADMIN'))
    return true;
  return (
    scopesHeld(principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(event.organizer_id) ||
    scopesHeld(principal, 'SUPERVISOR', 'ORGANIZER').includes(event.organizer_id) ||
    scopesHeld(principal, 'SUPERVISOR', 'EVENT').includes(event.id)
  );
}

/** Rôles de réglage tenus sur cet événement : OPERATOR_ADMIN du prestataire, ORGANIZER_ADMIN de son organisateur. */
export function settingRolesOn(actor: TenantActor, organizerId: string): SettingRole[] {
  const roles: SettingRole[] = [];
  if (actor.principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN'))
    roles.push('OPERATOR_ADMIN');
  if (scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(organizerId))
    roles.push('ORGANIZER_ADMIN');
  return roles;
}

@Controller('operators/:operator_id/events')
export class EventsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly events: EventsService,
    private readonly parties: PartiesService,
    private readonly cascade: CascadeService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('organizer_id') organizerId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    if (organizerId !== undefined && !isUuid(organizerId))
      throw invalid('organizer_id : identifiant attendu.');
    if (status !== undefined && !STATUSES.includes(status))
      throw invalid('status : valeur inconnue.');
    const all = actor.principal.assignments.some(
      (a) => a.role === 'PLATFORM_ADMIN' || a.role === 'OPERATOR_ADMIN',
    );
    const filter = {
      organizerId,
      status,
      organizers: all
        ? null
        : [
            ...scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER'),
            ...scopesHeld(actor.principal, 'SUPERVISOR', 'ORGANIZER'),
          ],
      events: all ? null : scopesHeld(actor.principal, 'SUPERVISOR', 'EVENT'),
    };
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) => {
      const rows = await this.events.list(client, filter, page.offset, page.limit + 1);
      const hasMore = rows.length > page.limit;
      return {
        data: rows
          .slice(0, page.limit)
          .map((row) =>
            eventDto(
              row,
              (row.ledger_id as string | null) ?? null,
              (row.config_version_id as string | null) ?? null,
            ),
          ),
        next_cursor: hasMore
          ? Buffer.from(JSON.stringify({ o: page.offset + page.limit })).toString('base64url')
          : null,
        has_more: hasMore,
      };
    });
  }

  @Post()
  @Idempotent({ scope: 'bo:' })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const input = parseEventCreate(body);
    return tx.run(async (client) => {
      // Organisateur du prestataire (404 sinon), sur lequel la personne tient un rôle de réglage.
      await this.parties.row(client, 'ORGANIZER', input.organizer_id);
      if (settingRolesOn(actor, input.organizer_id).length === 0)
        throw new ProblemException('FORBIDDEN');
      const created = await this.events.create(
        client,
        actor.operatorId,
        input,
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      );
      res.setHeader(
        'Location',
        `/v1/operators/${actor.operatorId}/events/${String(created.event_id)}`,
      );
      return created;
    });
  }

  @Get(':event_id')
  get(@Req() req: Request, @Param('event_id') eventId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) =>
      this.events.dto(client, await this.visible(client, actor, eventId)),
    );
  }

  @Patch(':event_id')
  @Idempotent({ scope: 'bo:' })
  update(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const changes = parseEventUpdate(body);
    const language = pickLanguage(req.header('Accept-Language'));
    return tx.run(async (client) => {
      const row = await this.events.row(client, requireUuid(eventId));
      // Qui règle ces clés : 403 si une clé relève d'un rôle que la personne ne tient pas, 422 si deux rôles se mêlent.
      const role = assertSettableBy(
        Object.keys(changes),
        'EVENT',
        settingRolesOn(actor, row.organizer_id),
        language,
      );
      if (!role) throw new ProblemException('FORBIDDEN');
      if (row.status !== 'DRAFT' && row.status !== 'LIVE') {
        throw conflict(`Un événement ${row.status} ne se modifie plus.`);
      }
      await this.events.check(client, row, changes, language);
      if (row.status === 'DRAFT') return this.events.apply(client, row, changes, actor.audit);
      // Événement en service : deux personnes du rôle qui règle ces clés.
      const request = await this.approvals.request(
        client,
        actor.operatorId,
        {
          action:
            role === 'OPERATOR_ADMIN' ? 'EVENT_OPERATOR_SETTINGS_CHANGE' : 'EVENT_SETTINGS_CHANGE',
          targetId: row.id,
          payload: {
            event_id: row.id,
            changes,
            config_version_id: await this.events.currentVersionId(client, row.id),
          },
        },
        { principal: actor.principal, audit: actor.audit },
      );
      return respondAccepted(res, request);
    });
  }

  @Get(':event_id/config')
  config(
    @Req() req: Request,
    @Param('event_id') eventId: string,
    @Query('at') at?: string,
    @Query('participation_id') participationId?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    let date: Date | undefined;
    if (at !== undefined) {
      const time = Date.parse(at);
      if (Number.isNaN(time)) throw unprocessable('at : date-heure ISO 8601 attendue.');
      date = new Date(time);
    }
    if (participationId !== undefined && !isUuid(participationId))
      throw unprocessable('participation_id : identifiant attendu.');
    return this.access.read(actor, async (client) => {
      await this.visible(client, actor, eventId);
      return this.cascade.resolveForEvent(client, eventId, date, participationId);
    });
  }

  /** Événement du prestataire (404 sinon) dans la portée de lecture de la personne (403 sinon). */
  private async visible(client: TxClient, actor: TenantActor, eventId: string): Promise<EventRow> {
    const row = await this.events.row(client, requireUuid(eventId));
    if (!canReadEvent(actor, row)) throw new ProblemException('FORBIDDEN');
    return row;
  }
}
