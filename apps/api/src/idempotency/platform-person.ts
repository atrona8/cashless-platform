// Personne de la plateforme (sans prestataire) : lue sur la personne authentifiée, identifiée en base à chaque
// requête — jamais sur un en-tête, un chemin ou un corps. Sert aux routes communes aux deux niveaux
// (`/approval-requests`), qui passent par la transaction de plateforme pour une telle personne.
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';
import { hasRole, type PrincipalRequest } from '../identity/principal';

export function isPlatformPerson(req: Request): boolean {
  return (req as PrincipalRequest).principal?.operatorId === null;
}

/** Une écriture de plateforme exige `PLATFORM_ADMIN`, quelle que soit la garde de la route (défense en profondeur). */
export function assertPlatformAdmin(req: Request): void {
  const principal = (req as PrincipalRequest).principal;
  if (!principal) throw new ProblemException('UNAUTHENTICATED');
  if (principal.operatorId !== null || !hasRole(principal, 'PLATFORM_ADMIN'))
    throw new ProblemException('FORBIDDEN');
}
