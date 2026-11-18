// Routes 18 et 19 : correspondance comptable versionnée (`listAccountMappings`, `createAccountMappingVersion`) et
// export comptable (`exportAccounting`), mission 9b, WP13. Lecture : OPERATOR_ADMIN, ORGANIZER_ADMIN (ses organisateurs
// seulement) ; écriture : OPERATOR_ADMIN. Une entité hors de la portée de la personne répond `404`.
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemException } from '../errors/problem';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import type { Role } from '../identity/principal';
import { invalid, isUuid, pageRequest } from '../organization/platform/platform.dto';
import { scopesHeld, TenantAccess, type TenantActor } from '../organization/tenant/tenant-access';
import { AccountMappingsService, parseDate, parseMappingVersion } from './account-mappings.service';
import { AccountingExportService } from './accounting-export.service';

const READERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];
const WRITERS: readonly Role[] = ['OPERATOR_ADMIN'];

/** Entités visibles : `null` pour l'administrateur du prestataire, sinon les organisateurs administrés. */
const entityScope = (actor: TenantActor): string[] | null =>
  actor.role === 'OPERATOR_ADMIN'
    ? null
    : scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER');

const MAX_PERIOD_DAYS = 3700;

@Controller('operators/:operator_id')
export class AccountMappingsController {
  constructor(
    private readonly access: TenantAccess,
    private readonly mappings: AccountMappingsService,
    private readonly exports: AccountingExportService,
  ) {}

  @Get('account-mappings')
  list(
    @Req() req: Request,
    @Query('entity_party_id') entity?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    if (entity !== undefined && !isUuid(entity))
      throw invalid('entity_party_id : identifiant attendu.');
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, (client) =>
      this.mappings.list(
        client,
        actor.operatorId,
        { entity: entity ?? null, scope: entityScope(actor) },
        page,
      ),
    );
  }

  @Post('account-mappings')
  @Idempotent({ scope: 'bo:' })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, WRITERS);
    const input = parseMappingVersion(body);
    return tx.run((client) =>
      this.mappings.create(
        client,
        { operatorId: actor.operatorId, userId: actor.principal.userId, audit: actor.audit },
        input,
      ),
    );
  }

  @Get('accounting-exports')
  async export(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('entity') entity?: string,
    @Query('from') rawFrom?: string,
    @Query('to') rawTo?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    if (!isUuid(entity)) throw invalid('entity : identifiant attendu.');
    const from = parseDate(rawFrom, 'from');
    const to = parseDate(rawTo, 'to');
    if (from > to) throw invalid('from : doit précéder to.');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_PERIOD_DAYS)
      throw invalid('Période trop longue.');
    const scope = entityScope(actor);
    if (scope !== null && !scope.includes(entity)) throw new ProblemException('NOT_FOUND');
    return this.access.read(actor, async (client) => {
      const result = await this.exports.build(client, actor.operatorId, entity, from, to);
      await this.exports.recordExport(
        client,
        actor.audit,
        actor.operatorId,
        entity,
        { from, to },
        result,
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="accounting-${entity}-${from}-${to}.csv"`,
      );
      res.setHeader('X-Unmapped-Count', String(result.unmapped));
      res.setHeader('Cache-Control', 'no-store');
      return result.text;
    });
  }
}
