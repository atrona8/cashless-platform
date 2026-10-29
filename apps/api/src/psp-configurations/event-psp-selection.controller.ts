// Routes du choix de PSP par événement (mission 6, lot WP10, T051) : `getEventPspSelections`,
// `setEventPspSelection`. `humanBearer` seul. Un événement d'un autre prestataire ou organisateur : `404`.
import { Body, Controller, Get, HttpCode, Param, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import {
  invalid,
  isUuid,
  objectBody,
  requireUuid,
  unprocessable,
} from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { EventPspSelectionService } from './event-psp-selection.service';
import { PSP_METHODS, type PspMethod } from './psp-configurations.dto';

@Controller('events/:event_id/psp-selections')
export class EventPspSelectionController {
  constructor(
    private readonly access: TenantAccess,
    private readonly selections: EventPspSelectionService,
  ) {}

  @Get()
  get(@Req() req: Request, @Param('event_id') eventId: string) {
    const actor = this.access.actor(req, ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN']);
    requireUuid(eventId);
    return this.access.read(actor, (client) => this.selections.list(client, actor, eventId));
  }

  @Put(':method')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  set(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Param('method') method: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['ORGANIZER_ADMIN']);
    requireUuid(eventId);
    if (!(PSP_METHODS as readonly string[]).includes(method))
      throw invalid(`method : valeurs permises ${PSP_METHODS.join(', ')}.`);
    const parsed = objectBody(body);
    const foreign = Object.keys(parsed).filter((key) => key !== 'psp_config_id');
    if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
    if (!isUuid(parsed.psp_config_id)) throw unprocessable('psp_config_id : identifiant attendu.');
    const configId = parsed.psp_config_id;
    return tx.run(async (client) => {
      const outcome = await this.selections.set(
        client,
        actor,
        eventId,
        method as PspMethod,
        configId,
      );
      return 'accepted' in outcome ? respondAccepted(res, outcome.accepted) : outcome.selection;
    });
  }
}
