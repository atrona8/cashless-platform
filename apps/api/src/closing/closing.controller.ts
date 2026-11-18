// Routes des étapes de clôture et du relevé des soldes restants (mission 9b, WP07 ; contrat : `listEventClosingSteps`,
// `previewEventClosingStep`, `executeEventClosingStep`, `getEventRemainingBalances`). Modèle : `status.controller.ts`.
import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemException } from '../errors/problem';
import { canReadEvent, settingRolesOn } from '../events/events.controller';
import { EventsService } from '../events/events.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import type { Role } from '../identity/principal';
import { invalid, requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess, type TenantActor } from '../organization/tenant/tenant-access';
import type { EventRow } from '../events/events.dto';
import type { TxClient } from '../db/tenant-tx';
import { parseStep } from './closing-steps.dto';
import { ClosingStepService } from './closing-steps.service';
import { RemainingBalancesService } from './remaining-balances.service';

const READERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN', 'SUPERVISOR'];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

@Controller('operators/:operator_id/events/:event_id')
export class ClosingController {
  constructor(
    private readonly access: TenantAccess,
    private readonly events: EventsService,
    private readonly steps: ClosingStepService,
    private readonly balances: RemainingBalancesService,
  ) {}

  /** Événement du prestataire du chemin ; hors de la portée de la personne : 403 (inconnu : 404). */
  private async event(
    client: TxClient,
    actor: TenantActor,
    eventId: string,
    write: boolean,
  ): Promise<EventRow> {
    const event = await this.events.row(client, requireUuid(eventId));
    const allowed = write
      ? settingRolesOn(actor, event.organizer_id).length > 0
      : canReadEvent(actor, event);
    if (!allowed) throw new ProblemException('FORBIDDEN');
    return event;
  }

  @Get('closing-steps')
  async list(@Req() req: Request, @Param('event_id') eventId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) => ({
      data: await this.steps.list(client, await this.event(client, actor, eventId, false)),
    }));
  }

  @Get('closing-steps/:step/preview')
  preview(@Req() req: Request, @Param('event_id') eventId: string, @Param('step') step: string) {
    const actor = this.access.actor(req, WRITERS);
    const parsed = parseStep(step);
    return this.access.read(actor, async (client) =>
      this.steps.preview(client, await this.event(client, actor, eventId, true), parsed),
    );
  }

  @Post('closing-steps/:step')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  execute(
    @Req() req: Request,
    @Param('event_id') eventId: string,
    @Param('step') step: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const parsed = parseStep(step);
    return tx.run(async (client) =>
      this.steps.execute(client, await this.event(client, actor, eventId, true), parsed, {
        userId: actor.principal.userId,
        audit: actor.audit,
      }),
    );
  }

  @Get('remaining-balances')
  async remaining(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Query('format') format?: string,
  ) {
    const actor = this.access.actor(req, WRITERS);
    if (format !== undefined && format !== 'json' && format !== 'csv')
      throw invalid('format : json ou csv.');
    return this.access.read(actor, async (client) => {
      const event = await this.event(client, actor, eventId, true);
      if (format !== 'csv') return this.balances.totals(client, event);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="remaining-balances-${event.id}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      return this.balances.csv(client, event);
    });
  }
}
