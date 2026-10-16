// Routes de règles de frais d'un prestataire (contrat, tag Configuration), sous `/operators/{operator_id}/fee-rules` :
// portées OPERATOR_CONTRACT (OPERATOR_ADMIN), EVENT et PARTICIPATION (ORGANIZER_ADMIN de l'organisateur ; la
// commission d'un commerçant est une règle PARTICIPATION). Une règle ne se modifie jamais : elle se remplace.
// Événement visé LIVE : opération à deux personnes (`FEE_RULE_CHANGE`) ; après LIVE : refus. Le remplacement d'une
// redevance de plateforme revient à un PLATFORM_ADMIN, par la transaction de la plateforme (`plt:`).
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import { auditContext } from '../../audit/audit-context';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { assertPlatformAdmin, isPlatformPerson } from '../../idempotency/platform-person';
import type { Role } from '../../identity/principal';
import type { RolesRequest } from '../../identity/roles.guard';
import {
  conflict,
  enumField,
  FEE_SCOPES,
  feeRuleDto,
  invalid,
  isUuid,
  notFound,
  pageOf,
  pageRequest,
  parseFeeRuleCreate,
  requireUuid,
} from '../../organization/platform/platform.dto';
import { FeeRulesService, type FeeScopeInfo } from '../../organization/tenant/fee-rules.service';
import {
  scopesHeld,
  TenantAccess,
  type TenantActor,
} from '../../organization/tenant/tenant-access';

const READERS: readonly Role[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];
const WRITERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];
/** Portée des clés : `plt:` pour une personne de la plateforme, `bo:` pour le personnel d'un prestataire. */
const keyScope = (req: Request): string => (isPlatformPerson(req) ? 'plt:' : 'bo:');

@Controller('operators/:operator_id/fee-rules')
export class FeeRulesController {
  constructor(
    private readonly access: TenantAccess,
    private readonly feeRules: FeeRulesService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('scope_type') scopeType?: string,
    @Query('scope_id') scopeId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    if (scopeType !== undefined)
      enumField({ scope_type: scopeType }, 'scope_type', FEE_SCOPES, 'required');
    if (scopeId !== undefined && !isUuid(scopeId)) throw invalid('scope_id : identifiant attendu.');
    const organizers =
      actor.role === 'ORGANIZER_ADMIN'
        ? scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER')
        : null;
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, (client) =>
      this.feeRules.list(client, { scopeType, scopeId, organizers }, page.offset, page.limit + 1),
    );
    return pageOf(rows, page, feeRuleDto);
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
    const input = parseFeeRuleCreate(body);
    return tx.run(async (client) => {
      const info = await this.feeRules.scope(client, actor, input.scope_type, input.scope_id);
      if (this.live(info))
        return this.demand(client, res, actor, info, {
          event_id: info.eventId,
          mode: 'create',
          input,
        });
      const created = await this.feeRules.create(
        client,
        actor.operatorId,
        input,
        info,
        actor.audit,
      );
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/fee-rules`);
      return created;
    });
  }

  @Post(':fee_rule_id/replacements')
  @Idempotent({ scope: keyScope, platform: 'principal' })
  replace(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('fee_rule_id') feeRuleId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    requireUuid(feeRuleId);
    const input = parseFeeRuleCreate(body);
    if (isPlatformPerson(req)) return this.replacePlatformRule(req, res, feeRuleId, input, tx);
    const actor = this.access.actor(req, WRITERS);
    return tx.run(async (client) => {
      const previous = await this.feeRules.row(client, feeRuleId);
      const info = await this.feeRules.scope(client, actor, previous.scope_type, previous.scope_id);
      if (this.live(info))
        return this.demand(client, res, actor, info, {
          event_id: info.eventId,
          mode: 'replace',
          fee_rule_id: previous.id,
          input,
        });
      const created = await this.feeRules.replace(
        client,
        actor.operatorId,
        previous,
        input,
        info,
        actor.audit,
      );
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/fee-rules`);
      return created;
    });
  }

  /**
   * Redevance de plateforme : remplacée par un PLATFORM_ADMIN, dans la transaction de la plateforme, qui ne voit que
   * les règles PLATFORM_CONTRACT (toute autre règle : 404). Audit dans la chaîne de la plateforme.
   */
  private replacePlatformRule(
    req: Request,
    res: Response,
    feeRuleId: string,
    input: ReturnType<typeof parseFeeRuleCreate>,
    tx: IdempotentTx,
  ) {
    assertPlatformAdmin(req);
    (req as RolesRequest).exercisedRole = 'PLATFORM_ADMIN';
    const operatorId = requireUuid((req.params as Record<string, string>).operator_id ?? '');
    return tx.run(async (client) => {
      const previous = await this.feeRules.row(client, feeRuleId);
      if (previous.scope_type !== 'PLATFORM_CONTRACT' || previous.operator_id !== operatorId)
        throw notFound();
      const operator = await client.query<{ country_code: string | null }>(
        `SELECT country_code FROM party WHERE id = $1 AND kind = 'OPERATOR'`,
        [operatorId],
      );
      if (!operator.rows[0]) throw notFound();
      const info: FeeScopeInfo = {
        role: 'OPERATOR_ADMIN',
        organizerId: '',
        countryCode: operator.rows[0].country_code,
      };
      const created = await this.feeRules.replace(
        client,
        operatorId,
        previous,
        input,
        info,
        auditContext(req),
        undefined,
        null,
      );
      res.setHeader('Location', `/v1/operators/${operatorId}/platform-fee-rules`);
      return created;
    });
  }

  /** Événement visé en service : à deux ; après LIVE : plus de modification (409). Hors événement : écriture directe. */
  private live(info: FeeScopeInfo): boolean {
    if (info.eventId === undefined || info.eventStatus === 'DRAFT') return false;
    if (info.eventStatus !== 'LIVE')
      throw conflict(
        `L'événement est ${info.eventStatus ?? 'clos'} : ses règles de frais ne se modifient plus.`,
      );
    return true;
  }

  private async demand(
    client: TxClient,
    res: Response,
    actor: TenantActor,
    info: FeeScopeInfo,
    payload: object,
  ) {
    if (!info.eventId) throw new ProblemException('INTERNAL_ERROR');
    const request = await this.approvals.request(
      client,
      actor.operatorId,
      { action: 'FEE_RULE_CHANGE', targetId: info.eventId, payload },
      { principal: actor.principal, audit: actor.audit },
    );
    return respondAccepted(res, request);
  }
}
