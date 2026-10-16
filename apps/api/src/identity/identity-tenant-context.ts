// Prestataire de la transaction (contracts/identity.md « Prestataire de la transaction », research R-06) :
// celui de la personne ; sur une route `/operators/:operator_id/…`, celui du chemin pour un PLATFORM_ADMIN, sinon
// il doit être le sien (404, identique à un objet inexistant). Personne de plateforme hors de ces routes : 403.
// Route de l'app festivalier (`@CustomerAuth()`, sans personne du personnel) : le prestataire du compte festivalier,
// prouvé par sa garde (mission bracelets-nfc, WP17). Un chemin `/operators/:operator_id/…` n'y est jamais admis.
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';
import type { CustomerRequest } from '../customer-identity/customer-identity.port';
import type { TenantContext, TenantContextProvider } from '../tenancy/tenant-context';
import { hasRole, requestPrincipal, type PrincipalRequest } from './principal';

/** Nom du paramètre de chemin qui désigne le prestataire visé. */
export const OPERATOR_PARAM = 'operator_id';

@Injectable()
export class IdentityTenantContext implements TenantContextProvider {
  current(req: Request): TenantContext {
    const pathOperator = (req.params as Record<string, string | undefined> | undefined)?.[
      OPERATOR_PARAM
    ];
    const customer = (req as CustomerRequest).customer;
    if (customer && !(req as PrincipalRequest).principal) {
      if (pathOperator !== undefined) throw new ProblemException('NOT_FOUND');
      return { operatorId: customer.operatorId };
    }
    const principal = requestPrincipal(req);
    if (pathOperator !== undefined) {
      if (hasRole(principal, 'PLATFORM_ADMIN') || pathOperator === principal.operatorId) {
        return { operatorId: pathOperator };
      }
      throw new ProblemException('NOT_FOUND');
    }
    if (principal.operatorId === null) throw new ProblemException('FORBIDDEN');
    return { operatorId: principal.operatorId };
  }
}
