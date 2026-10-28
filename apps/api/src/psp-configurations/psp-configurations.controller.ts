// Routes des configurations PSP (mission 6, lot WP10, T049 et T050) : création, liste, lecture, demande
// d'activation / suspension / réactivation. Toutes en `humanBearer` (aucune route de terminal). Le prestataire
// vient de la personne ; un objet d'un autre prestataire ou d'un organisateur non administré est `404`.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { invalid, pageOf, pageRequest, requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { PspConfigurationActions } from './psp-configuration-action';
import { parseChangeRequest, parseCreatePspConfiguration } from './psp-configurations.dto';
import { PspConfigurationsService } from './psp-configurations.service';

const STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED'];

@Controller()
export class PspConfigurationsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly configs: PspConfigurationsService,
    private readonly actions: PspConfigurationActions,
  ) {}

  @Post('organizers/:organizer_id/psp-configurations')
  @HttpCode(201)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  create(
    @Req() req: Request,
    @Param('organizer_id') organizerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    requireUuid(organizerId);
    const input = parseCreatePspConfiguration(body);
    return tx.run((client) => this.configs.create(client, actor, organizerId, input));
  }

  @Get('organizers/:organizer_id/psp-configurations')
  async list(
    @Req() req: Request,
    @Param('organizer_id') organizerId: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
    requireUuid(organizerId);
    if (status !== undefined && !STATUSES.includes(status))
      throw invalid('status : valeurs permises DRAFT, ACTIVE, SUSPENDED.');
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, (client) =>
      this.configs.list(client, actor, organizerId, status, page.offset, page.limit + 1),
    );
    return pageOf(rows, page, (row) => row);
  }

  @Get('psp-configurations/:psp_config_id')
  get(@Req() req: Request, @Param('psp_config_id') id: string) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
    requireUuid(id);
    return this.access.read(actor, (client) => this.configs.get(client, actor, id));
  }

  /** Demande à deux personnes : `202`, rien n'est exécuté (le statut ne change qu'à l'approbation). */
  @Post('psp-configurations/:psp_config_id/approval-requests')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  requestChange(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('psp_config_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    requireUuid(id);
    const input = parseChangeRequest(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.actions.request(
          client,
          actor.operatorId,
          {
            configId: id,
            status: input.status,
            ...(input.compliance_ref !== undefined ? { complianceRef: input.compliance_ref } : {}),
          },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}
