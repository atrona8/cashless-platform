// Routes de plateforme d'un prestataire (contrat, tag Plateforme) : prestataires, contrat plateforme–prestataire,
// redevances de plateforme. Écritures : PLATFORM_ADMIN seul, transaction de la plateforme (`plt:`). Lectures de la
// fiche, du contrat et des redevances : aussi l'OPERATOR_ADMIN du prestataire du chemin, par sa propre transaction.
// Le prestataire vient toujours du chemin : un `operator_id` reçu dans un corps est ignoré.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import { auditContext } from '../../audit/audit-context';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import { requestPrincipal } from '../../identity/principal';
import { Roles } from '../../identity/roles.decorator';
import { OperatorsService } from './operators.service';
import { PlatformAccess } from './platform-access';
import {
  contractDto,
  feeRuleDto,
  operatorDto,
  pageOf,
  pageRequest,
  parseFeeRuleCreate,
  parseOperatorCreate,
  parsePartyUpdate,
  parsePlatformContractCreate,
  parsePlatformContractVersion,
  requireUuid,
} from './platform.dto';

const PLATFORM = () => ({ type: 'PLATFORM' as const });
const OWN_OPERATOR = ['OPERATOR_ADMIN'] as const;

@Controller('operators')
export class OperatorsController {
  constructor(
    private readonly operators: OperatorsService,
    private readonly approvals: ApprovalService,
    private readonly access: PlatformAccess,
  ) {}

  @Get()
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  async list(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const page = pageRequest(cursor, limit);
    const rows = await this.access.platform(req)((client) => this.operators.list(client, page.offset, page.limit + 1));
    return pageOf(rows, page, operatorDto);
  }

  @Post()
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const input = parseOperatorCreate(body);
    return tx.run(async (client) => {
      const created = await this.operators.create(client, input, auditContext(req));
      res.setHeader('Location', `/v1/operators/${created.operator_id}`);
      return created;
    });
  }

  @Get(':operator_id')
  get(@Req() req: Request, @Param('operator_id') operatorId: string) {
    requireUuid(operatorId);
    return this.access.reader(req, OWN_OPERATOR)((client) => this.operators.get(client, operatorId));
  }

  @Patch(':operator_id')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  update(@Req() req: Request, @Param('operator_id') operatorId: string, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    requireUuid(operatorId);
    const fields = parsePartyUpdate(body);
    return tx.run((client) => this.operators.update(client, operatorId, fields, auditContext(req)));
  }

  // ------------------------------------------------------------------ Contrat plateforme–prestataire

  @Get(':operator_id/platform-contracts')
  async listContracts(@Req() req: Request, @Param('operator_id') operatorId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    requireUuid(operatorId);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.reader(req, OWN_OPERATOR)((client) => this.operators.listContracts(client, operatorId, page.offset, page.limit + 1));
    return pageOf(rows, page, contractDto);
  }

  @Post(':operator_id/platform-contracts')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  createContract(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('operator_id') operatorId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    requireUuid(operatorId);
    const input = parsePlatformContractCreate(body);
    return tx.run(async (client) => {
      const created = await this.operators.createContract(client, operatorId, input, auditContext(req));
      res.setHeader('Location', `/v1/operators/${operatorId}/platform-contracts`);
      return created;
    });
  }

  @Post(':operator_id/platform-contracts/:contract_id/versions')
  @HttpCode(202)
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  createContractVersion(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('operator_id') operatorId: string,
    @Param('contract_id') contractId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    requireUuid(operatorId);
    requireUuid(contractId);
    const changes = parsePlatformContractVersion(body);
    return tx.run(async (client) => {
      // Refus immédiats (contrat inconnu, version dépassée) ; revérifié à l'exécution de la demande.
      await this.operators.assertLatestContract(client, operatorId, contractId);
      const request = await this.approvals.request(
        client,
        null,
        { action: 'PLATFORM_CONTRACT_VERSION', targetId: contractId, payload: { operator_id: operatorId, contract_id: contractId, changes } },
        { principal: requestPrincipal(req), audit: auditContext(req) },
      );
      return respondAccepted(res, request);
    });
  }

  // ------------------------------------------------------------------ Redevances de plateforme

  @Get(':operator_id/platform-fee-rules')
  async listFeeRules(@Req() req: Request, @Param('operator_id') operatorId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    requireUuid(operatorId);
    const page = pageRequest(cursor, limit);
    const rows = await this.access.reader(req, OWN_OPERATOR)((client) => this.operators.listFeeRules(client, operatorId, page.offset, page.limit + 1));
    return pageOf(rows, page, feeRuleDto);
  }

  @Post(':operator_id/platform-fee-rules')
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  createFeeRule(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('operator_id') operatorId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    requireUuid(operatorId);
    const input = parseFeeRuleCreate(body);
    return tx.run(async (client) => {
      const created = await this.operators.createFeeRule(client, operatorId, input, auditContext(req));
      res.setHeader('Location', `/v1/operators/${operatorId}/platform-fee-rules`);
      return created;
    });
  }
}
