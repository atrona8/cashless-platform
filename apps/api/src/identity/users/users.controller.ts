// Routes « Personnes » d'un prestataire (contrat openapi.yaml, tag Personnes). Le prestataire de la transaction est
// celui du chemin, contrôlé par IdentityTenantContext (le sien, ou n'importe lequel pour un PLATFORM_ADMIN ; sinon
// 404). Écritures : idempotentes (`bo:`), travail et audit dans IdempotentTx.run (règle RISK-2).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auditContext } from '../../audit/audit-context';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../tenancy/tenant-context';
import { requestPrincipal } from '../principal';
import type { RolesRequest } from '../roles.guard';
import { staffAdminRole } from './role-rules';
import { parseLimit, parseRoleGrant, parseStaffUserCreate } from './users.dto';
import { UsersService } from './users.service';

@Controller('operators/:operator_id')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Get('users')
  list(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const { operatorId, actor } = this.context(req);
    return this.users.list(operatorId, actor, cursor, parseLimit(limit));
  }

  @Get('users/:user_id')
  get(@Req() req: Request, @Param('user_id') userId: string) {
    const { operatorId, actor } = this.context(req);
    return this.users.get(operatorId, actor, userId);
  }

  @Post('users')
  @Idempotent({ scope: 'bo:' })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const { operatorId, actor } = this.context(req);
    const input = parseStaffUserCreate(body);
    return tx.run(async (client) => {
      const user = await this.users.create(client, operatorId, input, { ...actor, audit: auditContext(req) });
      res.setHeader('Location', `/v1/operators/${operatorId}/users/${user.user_id}`);
      return user;
    });
  }

  @Post('users/:user_id/disable')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  disable(@Req() req: Request, @Param('user_id') userId: string, @IdempotentTransaction() tx: IdempotentTx) {
    const { operatorId, actor } = this.context(req, ['PLATFORM_ADMIN', 'OPERATOR_ADMIN']);
    return tx.run((client) => this.users.disable(client, operatorId, userId, { ...actor, audit: auditContext(req) }));
  }

  @Post('users/:user_id/role-assignments')
  @Idempotent({ scope: 'bo:' })
  grant(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('user_id') userId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Droit selon le rôle donné et sa portée (role-rules) : contrôlé dans la transaction.
    const operatorId = this.tenant.current(req).operatorId;
    const principal = requestPrincipal(req);
    const input = parseRoleGrant(body);
    return tx.run(async (client) => {
      const assignment = await this.users.grant(client, operatorId, userId, input, { principal, audit: auditContext(req) });
      res.setHeader('Location', `/v1/operators/${operatorId}/users/${userId}`);
      return assignment;
    });
  }

  @Post('role-assignments/:assignment_id/revoke')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  revoke(@Req() req: Request, @Param('assignment_id') assignmentId: string, @IdempotentTransaction() tx: IdempotentTx) {
    const operatorId = this.tenant.current(req).operatorId;
    const principal = requestPrincipal(req);
    return tx.run((client) => this.users.revoke(client, operatorId, assignmentId, { principal, audit: auditContext(req) }));
  }

  /** Prestataire du chemin et rôle d'administration exercé (posé sur la requête pour l'audit). */
  private context(req: Request, allowed?: Parameters<typeof staffAdminRole>[1]) {
    const operatorId = this.tenant.current(req).operatorId;
    const principal = requestPrincipal(req);
    const role = staffAdminRole(principal, allowed);
    (req as RolesRequest).exercisedRole = role;
    return { operatorId, actor: { principal, role } };
  }
}
