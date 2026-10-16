// Routes /approval-requests (contrat, tag Approbations). Prestataire : celui de la personne (IdentityTenantContext).
// Une personne de la plateforme (sans prestataire) y voit et y décide les seules demandes de niveau plateforme, par
// la transaction de la plateforme (contrat platform-access, règle 5) ; clé d'idempotence `plt:` au lieu de `bo:`.
// Décisions idempotentes (`bo:`) ; décision, exécution, statut et audit dans IdempotentTx.run (règle RISK-2).
// Corps : seule `note` est lue ; `approved_by`, `decided_by` et tout autre champ sont ignorés (FR-013).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../audit/audit-context';
import { ProblemException } from '../errors/problem';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { assertPlatformAdmin, isPlatformPerson } from '../idempotency/platform-person';
import { requestPrincipal } from '../identity/principal';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { ApprovalService } from './approval.service';

function note(body: unknown, required: boolean): string | null {
  const value =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>).note : undefined;
  if (value === undefined || value === null) {
    if (required)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 400,
        detail: 'Note obligatoire pour un refus.',
      });
    return null;
  }
  const min = required ? 5 : 0;
  if (typeof value !== 'string' || value.trim().length < Math.max(min, 1) || value.length > 2000) {
    throw new ProblemException('VALIDATION_FAILED', {
      status: 400,
      detail: required ? 'note : 5 à 2000 caractères.' : 'note : 1 à 2000 caractères.',
    });
  }
  return value;
}

function limitOf(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ProblemException('VALIDATION_FAILED', {
      status: 400,
      detail: 'limit : entier de 1 à 200 attendu.',
    });
  }
  return limit;
}

/** Portée des clés : `plt:` pour une personne de la plateforme, `bo:` pour le personnel d'un prestataire. */
const decisionScope = (req: Request): string => (isPlatformPerson(req) ? 'plt:' : 'bo:');

@Controller('approval-requests')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Get()
  list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const operatorId = this.level(req);
    return this.approvals.list(operatorId, requestPrincipal(req), {
      status,
      action,
      cursor,
      limit: limitOf(limit),
    });
  }

  @Get(':approval_request_id')
  get(@Req() req: Request, @Param('approval_request_id') id: string) {
    const operatorId = this.level(req);
    return this.approvals.get(operatorId, requestPrincipal(req), id);
  }

  @Post(':approval_request_id/approve')
  @HttpCode(200)
  @Idempotent({ scope: decisionScope, platform: 'principal' })
  approve(
    @Req() req: Request,
    @Param('approval_request_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const operatorId = this.level(req);
    const decisionNote = note(body, false);
    const actor = { principal: requestPrincipal(req), audit: auditContext(req) };
    return tx.run((client) => this.approvals.approve(client, operatorId, id, decisionNote, actor));
  }

  @Post(':approval_request_id/reject')
  @HttpCode(200)
  @Idempotent({ scope: decisionScope, platform: 'principal' })
  reject(
    @Req() req: Request,
    @Param('approval_request_id') id: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const operatorId = this.level(req);
    const rejectionNote = note(body, true)!;
    const actor = { principal: requestPrincipal(req), audit: auditContext(req) };
    return tx.run((client) => this.approvals.reject(client, operatorId, id, rejectionNote, actor));
  }

  /** Prestataire de la transaction ; NULL pour un `PLATFORM_ADMIN` de la plateforme (demandes de plateforme). */
  private level(req: Request): string | null {
    if (!isPlatformPerson(req)) return this.tenant.current(req).operatorId;
    assertPlatformAdmin(req);
    return null;
  }
}
