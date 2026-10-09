// Garde de rôle et de portée (FR-005) : la personne doit tenir un des rôles exigés sur la portée de l'objet visé ou
// sur une portée englobante ; sinon 403 FORBIDDEN (objet d'un autre prestataire : 404). Pose `req.exercisedRole`
// (le rôle le plus spécifique qui a permis l'accès) pour l'audit.
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { requestPrincipal, type PrincipalRequest, type Role } from './principal';
import type { RolesMetadata } from './roles.decorator';
import { exercisedRole, PLATFORM_CHAIN, resolveChain, type ScopeLink } from './scope-resolver';

export type RolesRequest = PrincipalRequest & { exercisedRole?: Role };

/** Clé de métadonnée de `@Roles` (définie ici : roles.decorator importe cette garde). */
export const ROLES = 'identity:roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RolesMetadata | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;
    const req = context.switchToHttp().getRequest<RolesRequest>();
    const principal = requestPrincipal(req);

    const target = meta.scope?.(req);
    let chain: readonly ScopeLink[] = PLATFORM_CHAIN;
    if (target?.type !== 'PLATFORM') {
      // Lecture courte, cloisonnée par le prestataire de la transaction.
      const { operatorId } = this.tenant.current(req);
      chain = await this.tx.run(operatorId, (client) =>
        resolveChain(client, target ?? { type: 'OPERATOR', id: operatorId }),
      );
    }
    const role = exercisedRole(principal, meta.roles, chain, meta);
    if (!role) throw new ProblemException('FORBIDDEN');
    req.exercisedRole = role;
    return true;
  }
}
