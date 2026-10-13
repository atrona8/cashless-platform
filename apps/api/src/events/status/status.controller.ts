// Routes de statut d'un événement (contrat, tag Événements) : conditions d'un passage et passage. Seule cette route
// change le statut. `DRAFT → LIVE` : conditions remplies, puis demande à deux `EVENT_GO_LIVE` (202) ; les autres
// passages sont immédiats, appliqués par `set_event_status` avec la personne connectée pour auteur.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import { ProblemException } from '../../errors/problem';
import { pickLanguage } from '../../http/language';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import { invalid, objectBody, requireUuid, unprocessable } from '../../organization/platform/platform.dto';
import { scopesHeld, TenantAccess } from '../../organization/tenant/tenant-access';
import { canReadEvent, settingRolesOn } from '../events.controller';
import { EventsService } from '../events.service';
import { EVENT_STATUSES, nextStatus, StatusService, type EventStatus } from './status.service';

const READERS: readonly Role[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR'];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

const isStatus = (value: unknown): value is EventStatus => typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);

@Controller('operators/:operator_id/events/:event_id')
export class StatusController {
  constructor(
    private readonly access: TenantAccess,
    private readonly events: EventsService,
    private readonly status: StatusService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get('status-conditions')
  conditions(@Req() req: Request, @Param('event_id') eventId: string, @Query('to') to?: string) {
    const actor = this.access.actor(req, READERS);
    if (to !== undefined && !isStatus(to)) throw invalid('to : statut inconnu.');
    return this.access.read(actor, async (client) => {
      const event = await this.events.row(client, requireUuid(eventId));
      if (!canReadEvent(actor, event)) throw new ProblemException('FORBIDDEN');
      const target = to ?? nextStatus(event.status);
      // Événement clos : aucun passage suivant.
      if (!target) return [];
      return this.status.conditions(client, event, target, pickLanguage(req.header('Accept-Language')));
    });
  }

  @Post('status-transitions')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  transition(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const to = objectBody(body).to;
    if (to === undefined) throw invalid('Champ obligatoire : to.');
    if (!isStatus(to)) throw unprocessable('to : statut inconnu.');
    const language = pickLanguage(req.header('Accept-Language'));
    return tx.run(async (client) => {
      const event = await this.events.row(client, requireUuid(eventId));
      if (settingRolesOn(actor, event.organizer_id).length === 0) throw new ProblemException('FORBIDDEN');
      await this.status.assertMet(client, event, to, language);
      if (to === 'LIVE') {
        // Mise en service : deux ORGANIZER_ADMIN de l'organisateur.
        if (!scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(event.organizer_id)) throw new ProblemException('FORBIDDEN');
        const request = await this.approvals.request(
          client,
          actor.operatorId,
          { action: 'EVENT_GO_LIVE', targetId: event.id, payload: { event_id: event.id, to, config_version_id: await this.events.currentVersionId(client, event.id) } },
          { principal: actor.principal, audit: actor.audit },
        );
        return respondAccepted(res, request);
      }
      return this.status.apply(client, event, to, actor.principal.userId, actor.audit);
    });
  }
}
