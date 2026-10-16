// Routes du poste de personnalisation (contrat, `x-process: personalization`). Rôle PERSONALIZER du prestataire du
// chemin, et lui seul : ni OPERATOR_ADMIN ni PLATFORM_ADMIN n'enregistrent un bracelet. `Idempotency-Key` obligatoire :
// elle désigne l'enregistrement, mais aucune réponse n'est conservée (elle porte un mot de passe sous enveloppe).
import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auditContext } from '../../audit/audit-context';
import type { AuditContext } from '../../audit/audit.service';
import { ProblemException } from '../../errors/problem';
import { requestPrincipal } from '../../identity/principal';
import type { RolesRequest } from '../../identity/roles.guard';
import { invalid, requireUuid } from '../../organization/platform/platform.dto';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../tenancy/tenant-context';
import { parseClaimCode, parsePersonalization } from './personalization.dto';
import { PersonalizationService } from './personalization.service';

@Controller('operators/:operator_id/media-personalizations')
export class PersonalizationController {
  constructor(
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
    private readonly personalization: PersonalizationService,
  ) {}

  @Post()
  @HttpCode(201)
  register(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const actor = this.personalizer(req);
    const key = idempotencyKey(req);
    const input = parsePersonalization(body);
    // La réponse porte un mot de passe sous enveloppe : aucun intermédiaire ne doit la garder.
    res.setHeader('Cache-Control', 'no-store');
    return this.personalization.register(actor.operatorId, input, key, actor.audit);
  }

  @Post(':media_id/claim-code')
  @HttpCode(204)
  async associateClaimCode(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const actor = this.personalizer(req);
    idempotencyKey(req);
    const replayed = await this.personalization.associateClaimCode(
      actor.operatorId,
      requireUuid(mediaId),
      parseClaimCode(body),
      actor.audit,
    );
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
  }

  /** Prestataire du chemin (404 si ce n'est pas celui de la personne) et rôle PERSONALIZER sur ce prestataire (403). */
  private personalizer(req: Request): { operatorId: string; audit: AuditContext } {
    const { operatorId } = this.tenant.current(req);
    const held = requestPrincipal(req).assignments.some(
      (a) => a.role === 'PERSONALIZER' && a.scopeType === 'OPERATOR' && a.scopeId === operatorId,
    );
    if (!held) throw new ProblemException('FORBIDDEN');
    (req as RolesRequest).exercisedRole = 'PERSONALIZER';
    return { operatorId, audit: auditContext(req) };
  }
}

function idempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (key === undefined || key === '') throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
  if (key.length > 255) throw invalid('Idempotency-Key : 255 caractères au plus.');
  return key;
}
