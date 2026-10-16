// Accès aux routes d'un prestataire (contrat, sections Organisation et Événements) : le prestataire de la transaction
// est celui du chemin, contrôlé par IdentityTenantContext (le sien, ou n'importe lequel pour un PLATFORM_ADMIN ;
// sinon 404). Le rôle exercé est le premier tenu parmi ceux que la route admet ; il est posé sur la requête pour
// l'audit. Un ORGANIZER_ADMIN n'agit que sur ses organisateurs ; un MERCHANT_ADMIN que sur son commerçant.
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import type { AuditContext } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { requestPrincipal, type Principal, type Role } from '../../identity/principal';
import type { RolesRequest } from '../../identity/roles.guard';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../tenancy/tenant-context';

export interface TenantActor {
  operatorId: string;
  principal: Principal;
  role: Role;
  audit: AuditContext;
}

/** Objets d'une portée (`ORGANIZER`, `MERCHANT`, `EVENT`) sur lesquels la personne tient un rôle. */
export function scopesHeld(principal: Principal, role: Role, scopeType: string): string[] {
  return principal.assignments
    .filter((a) => a.role === role && a.scopeType === scopeType && a.scopeId)
    .map((a) => a.scopeId!);
}

@Injectable()
export class TenantAccess {
  constructor(
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  /** Prestataire du chemin et premier rôle tenu parmi `allowed` (ordre de préférence) ; aucun : 403. */
  actor(req: Request, allowed: readonly Role[]): TenantActor {
    const { operatorId } = this.tenant.current(req);
    const principal = requestPrincipal(req);
    const role = allowed.find((candidate) =>
      principal.assignments.some((a) => a.role === candidate),
    );
    if (!role) throw new ProblemException('FORBIDDEN');
    (req as RolesRequest).exercisedRole = role;
    return { operatorId, principal, role, audit: auditContext(req) };
  }

  /** Lecture dans la transaction cloisonnée du prestataire. */
  read<T>(
    actor: Pick<TenantActor, 'operatorId'>,
    fn: (client: TxClient) => Promise<T>,
  ): Promise<T> {
    return this.tx.run(actor.operatorId, fn);
  }
}

/** Un ORGANIZER_ADMIN n'agit que sur un organisateur qu'il administre (403 sinon) ; les rôles plus larges passent. */
export function assertOrganizerScope(actor: TenantActor, organizerId: string): void {
  if (
    actor.role === 'ORGANIZER_ADMIN' &&
    !scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(organizerId)
  ) {
    throw new ProblemException('FORBIDDEN');
  }
}
