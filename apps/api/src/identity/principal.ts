// Personne authentifiée de la requête (contracts/identity.md, research R-03, R-04) : identité interne
// (`app_user.id`), prestataire (NULL = plateforme) et attributions actives, lus en base à chaque requête.
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';

export type Role =
  | 'PLATFORM_ADMIN'
  | 'OPERATOR_ADMIN'
  | 'ORGANIZER_ADMIN'
  | 'SUPERVISOR'
  | 'CASHIER'
  | 'MERCHANT_ADMIN'
  | 'VENDOR'
  | 'CUSTOMER';

export type ScopeType = 'PLATFORM' | 'OPERATOR' | 'ORGANIZER' | 'EVENT' | 'MERCHANT';

export interface Assignment {
  role: Role;
  scopeType: ScopeType;
  /** NULL pour la portée PLATFORM. */
  scopeId: string | null;
}

export interface Principal {
  userId: string;
  /** NULL : personne de la plateforme. */
  operatorId: string | null;
  assignments: Assignment[];
  issuer: string;
  subject: string;
}

export type PrincipalRequest = Request & { principal?: Principal };

/** Personne posée par la garde d'authentification ; absente → 401 (route mal déclarée ou garde contournée). */
export function requestPrincipal(req: Request): Principal {
  const principal = (req as PrincipalRequest).principal;
  if (!principal) throw new ProblemException('UNAUTHENTICATED');
  return principal;
}

export function hasRole(principal: Principal, role: Role): boolean {
  return principal.assignments.some((assignment) => assignment.role === role);
}
