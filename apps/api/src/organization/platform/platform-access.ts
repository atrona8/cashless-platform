// Lecture à deux niveaux (contrat openapi-additions.md) : certaines lectures de plateforme sont ouvertes au personnel
// d'un prestataire pour ce qui le concerne (sa fiche, son contrat avec la plateforme, ses redevances, les profils de
// législation). Une personne de la plateforme lit par la transaction de plateforme ; une personne d'un prestataire
// par sa transaction cloisonnée, où la RLS ne lui montre que les lignes de son prestataire.
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformTx } from '../../db/platform-tx';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { assertPlatformAdmin, isPlatformPerson } from '../../idempotency/platform-person';
import { requestPrincipal, type Role } from '../../identity/principal';
import type { RolesRequest } from '../../identity/roles.guard';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../tenancy/tenant-context';

export type Reader = <T>(fn: (client: TxClient) => Promise<T>) => Promise<T>;

@Injectable()
export class PlatformAccess {
  constructor(
    private readonly platformTx: PlatformTx,
    private readonly tenantTx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  /** Transaction de plateforme, pour un `PLATFORM_ADMIN` seulement. */
  platform(req: Request): Reader {
    assertPlatformAdmin(req);
    (req as RolesRequest).exercisedRole = 'PLATFORM_ADMIN';
    return (fn) => this.platformTx.run(fn);
  }

  /**
   * Lecteur de la requête : plateforme pour un `PLATFORM_ADMIN` ; sinon le prestataire de la personne (celui du
   * chemin s'il y en a un : 404 si ce n'est pas le sien), qui doit y tenir un des rôles donnés.
   */
  reader(req: Request, tenantRoles: readonly Role[]): Reader {
    if (isPlatformPerson(req)) return this.platform(req);
    const { operatorId } = this.tenant.current(req);
    const principal = requestPrincipal(req);
    const held = principal.assignments.find((assignment) => tenantRoles.includes(assignment.role));
    if (!held) throw new ProblemException('FORBIDDEN');
    (req as RolesRequest).exercisedRole = held.role;
    return (fn) => this.tenantTx.run(operatorId, fn);
  }
}
