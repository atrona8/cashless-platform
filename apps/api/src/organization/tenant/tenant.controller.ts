// Routes d'organisation d'un prestataire (contrat, tags Organisation et Configuration), sous
// `/operators/{operator_id}` : configuration des niveaux prestataire et organisateur, organisateurs, commerçants,
// contrats prestataire–organisateur. Les règles de frais ont leur contrôleur (events/participations). Écritures idempotentes (`bo:`), travail et audit dans
// IdempotentTx.run. Le prestataire vient du chemin ; un `operator_id` reçu dans un corps est ignoré.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import type { SettingRole } from '../../configuration/settings-catalog';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { pickLanguage } from '../../http/language';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import {
  contractDto,
  objectBody,
  pageOf,
  pageRequest,
  parsePartyUpdate,
  requireUuid,
  textField,
  nullableText,
} from '../platform/platform.dto';
import { ConfigVersionsService, parseSettings } from './config-versions.service';
import { ContractsService, parseOrganizerContractCreate, parseOrganizerContractVersion } from './contracts.service';
import { merchantDto, organizerDto, PartiesService, type TenantPartyKind } from './parties.service';
import { assertOrganizerScope, scopesHeld, TenantAccess, type TenantActor } from './tenant-access';

const SUPERVISORS: readonly Role[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN'];
const ORGANIZER_READERS: readonly Role[] = [...SUPERVISORS, 'ORGANIZER_ADMIN'];
const MERCHANT_WRITERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];
const SETTING_ROLES: readonly SettingRole[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

function parsePartyCreate(raw: unknown) {
  const body = objectBody(raw);
  return {
    legal_name: textField(body, 'legal_name', 200, 'required')!,
    country_code: nullableText(body, 'country_code', 2, /^[A-Z]{2}$/) ?? null,
    tax_id: nullableText(body, 'tax_id', 64) ?? null,
  };
}

@Controller('operators/:operator_id')
export class TenantController {
  constructor(
    private readonly access: TenantAccess,
    private readonly parties: PartiesService,
    private readonly configVersions: ConfigVersionsService,
    private readonly contracts: ContractsService,
    private readonly approvals: ApprovalService,
  ) {}

  // ------------------------------------------------------------------ Configuration du prestataire

  @Get('config-versions')
  async listOperatorConfig(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, SUPERVISORS);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, (client) =>
      this.configVersions.list(client, { level: 'OPERATOR', scopeId: actor.operatorId }, page.offset, page.limit + 1),
    );
    return pageOf(rows, page, (row) => row);
  }

  @Post('config-versions')
  @Idempotent({ scope: 'bo:' })
  createOperatorConfig(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    const settings = parseSettings(body);
    return tx.run(async (client) => {
      const created = await this.configVersions.write(
        client,
        { level: 'OPERATOR', scopeId: actor.operatorId, operatorId: actor.operatorId },
        { operatorId: actor.operatorId },
        settings,
        this.settingRoles(actor),
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      );
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/config-versions`);
      return created;
    });
  }

  // ------------------------------------------------------------------ Organisateurs

  @Get('organizers')
  async listOrganizers(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, ORGANIZER_READERS);
    const only = actor.role === 'ORGANIZER_ADMIN' ? scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER') : null;
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, (client) => this.parties.list(client, 'ORGANIZER', only, page.offset, page.limit + 1));
    return pageOf(rows, page, organizerDto);
  }

  @Post('organizers')
  @Idempotent({ scope: 'bo:' })
  createOrganizer(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    return this.createParty(req, res, 'ORGANIZER', ['OPERATOR_ADMIN'], body, tx);
  }

  @Get('organizers/:organizer_id')
  async getOrganizer(@Req() req: Request, @Param('organizer_id') organizerId: string) {
    const actor = this.access.actor(req, ORGANIZER_READERS);
    return this.access.read(actor, async (client) => organizerDto(await this.organizer(client, actor, organizerId)));
  }

  @Patch('organizers/:organizer_id')
  @Idempotent({ scope: 'bo:' })
  updateOrganizer(@Req() req: Request, @Param('organizer_id') organizerId: string, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    const fields = parsePartyUpdate(body);
    requireUuid(organizerId);
    return tx.run((client) => this.parties.update(client, 'ORGANIZER', actor.operatorId, organizerId, fields, actor.audit));
  }

  @Get('organizers/:organizer_id/config-versions')
  async listOrganizerConfig(@Req() req: Request, @Param('organizer_id') organizerId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, ORGANIZER_READERS);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, async (client) => {
      await this.organizer(client, actor, organizerId);
      return this.configVersions.list(client, { level: 'ORGANIZER', scopeId: organizerId }, page.offset, page.limit + 1);
    });
    return pageOf(rows, page, (row) => row);
  }

  @Post('organizers/:organizer_id/config-versions')
  @Idempotent({ scope: 'bo:' })
  createOrganizerConfig(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('organizer_id') organizerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN']);
    const settings = parseSettings(body);
    return tx.run(async (client) => {
      await this.organizer(client, actor, organizerId);
      const created = await this.configVersions.write(
        client,
        { level: 'ORGANIZER', scopeId: organizerId, operatorId: actor.operatorId },
        { operatorId: actor.operatorId },
        settings,
        this.settingRoles(actor, organizerId),
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      );
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/organizers/${organizerId}/config-versions`);
      return created;
    });
  }

  // ------------------------------------------------------------------ Contrats prestataire–organisateur

  @Get('organizers/:organizer_id/contracts')
  async listContracts(@Req() req: Request, @Param('organizer_id') organizerId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, ORGANIZER_READERS);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, async (client) => {
      await this.organizer(client, actor, organizerId);
      return this.contracts.list(client, organizerId, page.offset, page.limit + 1);
    });
    return pageOf(rows, page, contractDto);
  }

  @Post('organizers/:organizer_id/contracts')
  @Idempotent({ scope: 'bo:' })
  createContract(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('organizer_id') organizerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    const input = parseOrganizerContractCreate(body);
    return tx.run(async (client) => {
      await this.organizer(client, actor, organizerId);
      const created = await this.contracts.create(client, actor.operatorId, organizerId, input, actor.audit);
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/organizers/${organizerId}/contracts`);
      return created;
    });
  }

  @Post('contracts/:contract_id/versions')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  createContractVersion(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('contract_id') contractId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, ['OPERATOR_ADMIN']);
    requireUuid(contractId);
    const changes = parseOrganizerContractVersion(body);
    return tx.run(async (client) => {
      // Refus immédiats (contrat inconnu, version dépassée) ; revérifié à l'exécution de la demande.
      await this.contracts.assertLatest(client, contractId);
      const request = await this.approvals.request(
        client,
        actor.operatorId,
        { action: 'CONTRACT_VERSION', targetId: contractId, payload: { operator_id: actor.operatorId, contract_id: contractId, changes } },
        { principal: actor.principal, audit: actor.audit },
      );
      return respondAccepted(res, request);
    });
  }

  // ------------------------------------------------------------------ Commerçants

  @Get('merchants')
  async listMerchants(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, [...ORGANIZER_READERS, 'MERCHANT_ADMIN']);
    const only = actor.role === 'MERCHANT_ADMIN' ? scopesHeld(actor.principal, 'MERCHANT_ADMIN', 'MERCHANT') : null;
    const page = pageRequest(cursor, limit);
    const rows = await this.access.read(actor, (client) => this.parties.list(client, 'MERCHANT', only, page.offset, page.limit + 1));
    return pageOf(rows, page, merchantDto);
  }

  @Post('merchants')
  @Idempotent({ scope: 'bo:' })
  createMerchant(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    return this.createParty(req, res, 'MERCHANT', MERCHANT_WRITERS, body, tx);
  }

  @Get('merchants/:merchant_id')
  async getMerchant(@Req() req: Request, @Param('merchant_id') merchantId: string) {
    const actor = this.access.actor(req, [...ORGANIZER_READERS, 'MERCHANT_ADMIN']);
    requireUuid(merchantId);
    return this.access.read(actor, async (client) => {
      const row = await this.parties.row(client, 'MERCHANT', merchantId);
      if (actor.role === 'MERCHANT_ADMIN' && !scopesHeld(actor.principal, 'MERCHANT_ADMIN', 'MERCHANT').includes(merchantId)) {
        throw new ProblemException('FORBIDDEN');
      }
      return merchantDto(row);
    });
  }

  @Patch('merchants/:merchant_id')
  @Idempotent({ scope: 'bo:' })
  updateMerchant(@Req() req: Request, @Param('merchant_id') merchantId: string, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, MERCHANT_WRITERS);
    const fields = parsePartyUpdate(body);
    requireUuid(merchantId);
    return tx.run((client) => this.parties.update(client, 'MERCHANT', actor.operatorId, merchantId, fields, actor.audit));
  }

  // ------------------------------------------------------------------ Aides

  /** Organisateur du prestataire (404 sinon), que la personne peut voir (403 pour un autre ORGANIZER_ADMIN). */
  private async organizer(client: TxClient, actor: TenantActor, organizerId: string) {
    requireUuid(organizerId);
    const row = await this.parties.row(client, 'ORGANIZER', organizerId);
    assertOrganizerScope(actor, organizerId);
    return row;
  }

  /** Rôles de réglage que la personne tient sur ce prestataire (et, pour ORGANIZER_ADMIN, sur cet organisateur). */
  private settingRoles(actor: TenantActor, organizerId?: string): SettingRole[] {
    return SETTING_ROLES.filter((role) =>
      role === 'ORGANIZER_ADMIN'
        ? organizerId !== undefined && scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(organizerId)
        : role === 'OPERATOR_ADMIN' && actor.principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN'),
    );
  }

  private createParty(req: Request, res: Response, kind: TenantPartyKind, roles: readonly Role[], body: unknown, tx: IdempotentTx) {
    const actor = this.access.actor(req, roles);
    const fields = parsePartyCreate(body);
    return tx.run(async (client) => {
      const created = await this.parties.create(client, kind, actor.operatorId, fields, actor.audit);
      const [segment, id] = 'organizer_id' in created ? ['organizers', created.organizer_id] : ['merchants', created.merchant_id];
      res.setHeader('Location', `/v1/operators/${actor.operatorId}/${segment}/${id}`);
      return created;
    });
  }
}
