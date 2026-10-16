// Routes /jurisdiction-profiles (contrat, tag Plateforme). Lecture : PLATFORM_ADMIN, et le personnel d'un
// prestataire (OPERATOR_ADMIN, ORGANIZER_ADMIN) par sa propre transaction — donnée de référence sans RLS. Écriture :
// PLATFORM_ADMIN seul, par la transaction de la plateforme (`plt:`), travail et audit dans IdempotentTx.run.
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import { auditContext } from '../../audit/audit-context';
import { JurisdictionService } from '../../configuration/jurisdiction.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { requestPrincipal } from '../../identity/principal';
import { Roles } from '../../identity/roles.decorator';
import { PlatformAccess } from './platform-access';
import {
  invalid,
  pageOf,
  pageRequest,
  parseJurisdictionProfile,
  requireUuid,
} from './platform.dto';

const PLATFORM = () => ({ type: 'PLATFORM' as const });
const READERS = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'] as const;

@Controller('jurisdiction-profiles')
export class JurisdictionController {
  constructor(
    private readonly profiles: JurisdictionService,
    private readonly approvals: ApprovalService,
    private readonly access: PlatformAccess,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('country_code') country?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    if (country !== undefined && !/^[A-Z]{2}$/.test(country))
      throw invalid('country_code : code pays à deux lettres attendu.');
    const page = pageRequest(cursor, limit);
    const rows = await this.access.reader(
      req,
      READERS,
    )((client) => this.profiles.list(client, country, page.offset, page.limit + 1));
    return pageOf(rows, page, (row) => row);
  }

  @Get(':profile_id')
  get(@Req() req: Request, @Param('profile_id') profileId: string) {
    requireUuid(profileId);
    return this.access.reader(req, READERS)((client) => this.profiles.get(client, profileId));
  }

  @Post()
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const input = parseJurisdictionProfile(body, true);
    return tx.run(async (client) => {
      const created = await this.profiles.create(
        client,
        { ...input, country_code: input.country_code! },
        auditContext(req),
      );
      res.setHeader('Location', `/v1/jurisdiction-profiles/${created.profile_id}`);
      return created;
    });
  }

  @Post(':profile_id/versions')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  createVersion(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('profile_id') profileId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    requireUuid(profileId);
    const { country_code: _ignored, ...input } = parseJurisdictionProfile(body, false);
    return tx.run(async (client) => {
      const { completed, limitsChange } = await this.profiles.prepareVersion(
        client,
        profileId,
        input,
      );
      if (limitsChange) {
        // Un plafond réglementaire change : deux personnes (JURISDICTION_LIMITS_CHANGE), rien n'est écrit ici.
        const request = await this.approvals.request(
          client,
          null,
          {
            action: 'JURISDICTION_LIMITS_CHANGE',
            targetId: profileId,
            payload: { profile_id: profileId, profile: completed },
          },
          { principal: requestPrincipal(req), audit: auditContext(req) },
        );
        return respondAccepted(res, request);
      }
      const created = await this.profiles.writeVersion(
        client,
        profileId,
        completed,
        auditContext(req),
      );
      res.setHeader('Location', `/v1/jurisdiction-profiles/${created.profile_id}`);
      return created;
    });
  }
}
