// Portée d'une recherche du back-office (mission routes-backoffice, WP08 ; FR-014, interfaces.md « Portée »).
// Elle vient des attributions de la personne qui portent un rôle admis par la route, et s'écrit DANS la requête SQL
// (jamais un filtre après lecture). Mêmes englobements que `exercisedRole` : une attribution de portée prestataire
// couvre tout le prestataire, de portée organisateur ses événements, de portée événement cet événement ; un
// `MERCHANT_ADMIN` couvre les événements où son commerçant participe (lecture seulement, `participations`).
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';
import { requestPrincipal, type Principal, type Role } from '../identity/principal';
import type { RolesRequest } from '../identity/roles.guard';

export const MEDIA_ROLES: readonly Role[] = [
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'MERCHANT_ADMIN',
];
export const WALLET_ROLES: readonly Role[] = [
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'SUPERVISOR',
  'CASHIER',
];
/** `PLATFORM_ADMIN` retiré (renforcement du 24/11/2026) : une recherche hors prestataire porterait sur tous. */
export const CUSTOMER_ROLES: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR'];

export interface SearchScope {
  operatorId: string;
  principal: Principal;
  /** Rôle exercé : le premier de la liste de la route que la personne tient. */
  role: Role;
  /** Tout le prestataire. */
  wide: boolean;
  organizers: string[];
  events: string[];
  merchants: string[];
}

/** Description de la portée pour l'audit (jamais de donnée du festivalier). */
export const scopeSummary = (scope: SearchScope) => ({
  operator_wide: scope.wide,
  organizer_ids: scope.organizers,
  event_ids: scope.events,
});

/** Rôles de la route tenus par la personne, sinon `403` ; personne de la plateforme (sans prestataire) : `403`. */
export function searchScope(
  req: Request,
  roles: readonly Role[],
  options: { participations?: boolean } = {},
): SearchScope {
  const principal = requestPrincipal(req);
  const held = principal.assignments.filter((a) => roles.includes(a.role));
  const role = roles.find((candidate) => held.some((a) => a.role === candidate));
  if (!role || principal.operatorId === null) throw new ProblemException('FORBIDDEN');
  (req as RolesRequest).exercisedRole = role;
  const ids = (type: string) => [
    ...new Set(held.filter((a) => a.scopeType === type && a.scopeId).map((a) => a.scopeId!)),
  ];
  return {
    operatorId: principal.operatorId,
    principal,
    role,
    wide: held.some((a) => a.scopeType === 'OPERATOR' && a.scopeId === principal.operatorId),
    organizers: ids('ORGANIZER'),
    events: ids('EVENT'),
    merchants: options.participations ? ids('MERCHANT') : [],
  };
}

/**
 * Condition SQL de portée ; `eventExpr` et `organizerExpr` sont les colonnes de l'événement et de l'organisateur
 * de l'objet cherché (NULL = hors de toute portée étroite). Les valeurs passent en paramètres.
 */
export function scopeSql(
  scope: SearchScope,
  params: unknown[],
  eventExpr: string,
  organizerExpr: string,
): string {
  if (scope.wide) return 'true';
  const parts: string[] = [];
  const bind = (value: string[]): string => {
    params.push(value);
    return `$${params.length}::uuid[]`;
  };
  if (scope.organizers.length > 0) parts.push(`${organizerExpr} = ANY(${bind(scope.organizers)})`);
  if (scope.events.length > 0) parts.push(`${eventExpr} = ANY(${bind(scope.events)})`);
  if (scope.merchants.length > 0)
    parts.push(
      `${eventExpr} IN (SELECT mp.event_id FROM merchant_participation mp
                         WHERE mp.merchant_id = ANY(${bind(scope.merchants)}))`,
    );
  return parts.length > 0 ? `(${parts.join(' OR ')})` : 'false';
}
