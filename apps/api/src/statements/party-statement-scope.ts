// Périmètre des relevés d'une partie (route 16, FR-022). LISTE FIGÉE des rôles par nature de partie : un test échoue
// si elle s'élargit. Règle : un rôle absent de la liste reçoit `403` (la réponse ne dépend que du rôle, jamais de
// l'existence d'une partie) ; un bon rôle sur une partie hors de sa portée, un événement ou un prestataire d'un autre,
// reçoit `404`, la même réponse qu'un identifiant inconnu (aucun oracle d'existence).
import type { Principal, Role } from '../identity/principal';

export type PartyKind = 'MERCHANT' | 'ORGANIZER' | 'OPERATOR' | 'PLATFORM';
export const PARTY_KINDS: readonly PartyKind[] = ['MERCHANT', 'ORGANIZER', 'OPERATOR', 'PLATFORM'];

/** Rôles admis par nature de partie (contrat : `contract-additions.md`, ligne 16). Ne s'élargit pas sans décision. */
export const STATEMENT_ROLES: Readonly<Record<PartyKind, readonly Role[]>> = Object.freeze({
  MERCHANT: Object.freeze<Role[]>(['MERCHANT_ADMIN', 'ORGANIZER_ADMIN', 'OPERATOR_ADMIN']),
  ORGANIZER: Object.freeze<Role[]>(['ORGANIZER_ADMIN', 'OPERATOR_ADMIN']),
  OPERATOR: Object.freeze<Role[]>(['OPERATOR_ADMIN']),
  PLATFORM: Object.freeze<Role[]>(['PLATFORM_ADMIN']),
});

/** Tous les rôles qui peuvent lire au moins un relevé : la route refuse les autres en `403`. */
export const ALL_STATEMENT_ROLES: readonly Role[] = [
  ...new Set(PARTY_KINDS.flatMap((kind) => STATEMENT_ROLES[kind])),
];

export function isPartyKind(value: string): value is PartyKind {
  return (PARTY_KINDS as readonly string[]).includes(value);
}

/** Le rôle suffit-il pour cette nature de partie ? Contrôlé AVANT toute lecture : `403` ne dépend que du rôle. */
export function hasStatementRole(principal: Principal, kind: PartyKind): boolean {
  return STATEMENT_ROLES[kind].some((role) => principal.assignments.some((a) => a.role === role));
}

export interface StatementEvent {
  id: string;
  organizer_id: string;
}

export type StatementVerdict =
  | { verdict: 'FORBIDDEN' }
  | { verdict: 'NOT_FOUND' }
  | { verdict: 'OK'; partyId: string | null; checkParticipation: boolean };

const scopes = (principal: Principal, role: Role, scopeType: string): string[] =>
  principal.assignments
    .filter((a) => a.role === role && a.scopeType === scopeType && a.scopeId)
    .map((a) => a.scopeId!);

/**
 * Décision d'accès au relevé de `kind` / `partyId` pour `event`. Pure : aucune lecture de base. `checkParticipation`
 * demande à l'appelant de vérifier que le commerçant participe à l'événement (sinon `404`).
 */
export function statementAccess(
  principal: Principal,
  operatorId: string,
  kind: PartyKind,
  partyId: string | null,
  event: StatementEvent,
): StatementVerdict {
  if (!hasStatementRole(principal, kind)) return { verdict: 'FORBIDDEN' };
  const operatorAdmin = scopes(principal, 'OPERATOR_ADMIN', 'OPERATOR').includes(operatorId);
  const organizers = scopes(principal, 'ORGANIZER_ADMIN', 'ORGANIZER');
  const notFound: StatementVerdict = { verdict: 'NOT_FOUND' };
  switch (kind) {
    case 'MERCHANT': {
      if (partyId === null) return notFound;
      const merchants = scopes(principal, 'MERCHANT_ADMIN', 'MERCHANT');
      const allowed =
        operatorAdmin || organizers.includes(event.organizer_id) || merchants.includes(partyId);
      return allowed ? { verdict: 'OK', partyId, checkParticipation: true } : notFound;
    }
    case 'ORGANIZER': {
      if (partyId === null || partyId !== event.organizer_id) return notFound;
      return operatorAdmin || organizers.includes(partyId)
        ? { verdict: 'OK', partyId, checkParticipation: false }
        : notFound;
    }
    case 'OPERATOR':
      if (partyId !== null && partyId !== operatorId) return notFound;
      return operatorAdmin
        ? { verdict: 'OK', partyId: operatorId, checkParticipation: false }
        : notFound;
    case 'PLATFORM':
      // Le rôle PLATFORM_ADMIN est déjà exigé plus haut ; la plateforme n'a pas de portée plus fine.
      return { verdict: 'OK', partyId: null, checkParticipation: false };
  }
}
