// Qui peut attribuer quoi (contracts/identity.md « Attribution des rôles », research R-05) :
//   PLATFORM_ADMIN  → OPERATOR_ADMIN (prestataire) ; PLATFORM_ADMIN : par createPlatformAdmin seulement ;
//   OPERATOR_ADMIN  → OPERATOR_ADMIN, ORGANIZER_ADMIN, SUPERVISOR, CASHIER, MERCHANT_ADMIN dans son prestataire ;
//   ORGANIZER_ADMIN → SUPERVISOR, CASHIER sur son organisateur ou ses événements ; MERCHANT_ADMIN sur les
//                     commerçants qui participent à ses événements.
// Jamais à soi-même ; VENDOR et CUSTOMER ne sont pas attribuables ici. Le retrait suit la même règle.
import { ProblemException } from '../../errors/problem';
import type { Principal, Role, ScopeType } from '../principal';
import { exercisedRole, type ScopeLink, type ScopeRef } from '../scope-resolver';

/** Rôles attribuables par `grantRole`. */
export const GRANTABLE_ROLES = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER', 'MERCHANT_ADMIN'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

/** Portées compatibles avec chaque rôle attribuable (mêmes règles que la contrainte role_assignment_role_scope). */
const ROLE_SCOPES: Readonly<Record<GrantableRole, readonly ScopeType[]>> = {
  OPERATOR_ADMIN: ['OPERATOR'],
  ORGANIZER_ADMIN: ['ORGANIZER'],
  SUPERVISOR: ['ORGANIZER', 'EVENT'],
  CASHIER: ['ORGANIZER', 'EVENT'],
  MERCHANT_ADMIN: ['MERCHANT'],
};

/** Ce que chaque rôle d'administration peut attribuer, et sur quel englobement. */
const GRANTERS: ReadonlyArray<{ granter: Role; roles: readonly GrantableRole[]; participations?: boolean }> = [
  { granter: 'PLATFORM_ADMIN', roles: ['OPERATOR_ADMIN'] },
  { granter: 'OPERATOR_ADMIN', roles: GRANTABLE_ROLES },
  { granter: 'ORGANIZER_ADMIN', roles: ['SUPERVISOR', 'CASHIER'] },
  // Un commerçant n'est englobé par un organisateur que par ses participations aux événements de celui-ci.
  { granter: 'ORGANIZER_ADMIN', roles: ['MERCHANT_ADMIN'], participations: true },
];

/** Rôle et portée demandés, validés : `422 VALIDATION_FAILED` si non attribuable ou incompatible. */
/** Portée d'une attribution donnée par l'API : toujours un objet (jamais PLATFORM). */
export type GrantScope = Extract<ScopeRef, { id: string }>;

export function grantTarget(role: string, scopeType: string, scopeId: string | null | undefined): GrantScope & { role: GrantableRole } {
  if (!(GRANTABLE_ROLES as readonly string[]).includes(role)) {
    throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: `Rôle non attribuable ici : ${role}.` });
  }
  const grantable = role as GrantableRole;
  if (!(ROLE_SCOPES[grantable] as readonly string[]).includes(scopeType) || !scopeId) {
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: `Portée ${scopeType} incompatible avec le rôle ${role} (attendu : ${ROLE_SCOPES[grantable].join(' ou ')}, avec un objet).`,
    });
  }
  return { role: grantable, type: scopeType as GrantScope['type'], id: scopeId };
}

/**
 * Rôle de l'attribuant qui permet d'attribuer (ou de retirer) `role` sur la portée dont `chain` est la chaîne ;
 * `undefined` si aucun. `chain` est celle de l'objet de la portée, lue sous RLS.
 */
export function canGrant(granter: Principal, role: GrantableRole, chain: readonly ScopeLink[]): Role | undefined {
  for (const rule of GRANTERS) {
    if (!rule.roles.includes(role)) continue;
    const held = exercisedRole(granter, [rule.granter], chain, { participations: rule.participations });
    if (held) return held;
  }
  return undefined;
}

/** Rôles qui administrent les personnes d'un prestataire, du plus large au plus restreint. */
const STAFF_ADMINS: readonly Role[] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

/**
 * Rôle d'administration exercé sur les personnes du prestataire de la transaction (le plus large tenu parmi
 * `allowed`), sinon `403`. Le prestataire a déjà été contrôlé par le contexte (`IdentityTenantContext`).
 */
export function staffAdminRole(principal: Principal, allowed: readonly Role[] = STAFF_ADMINS): Role {
  const role = STAFF_ADMINS.find((r) => allowed.includes(r) && principal.assignments.some((a) => a.role === r));
  if (!role) throw new ProblemException('FORBIDDEN');
  return role;
}

/** Organisateurs administrés par la personne (restriction de visibilité d'un ORGANIZER_ADMIN). */
export function administeredOrganizers(principal: Principal): string[] {
  return principal.assignments
    .filter((a) => a.role === 'ORGANIZER_ADMIN' && a.scopeType === 'ORGANIZER' && a.scopeId)
    .map((a) => a.scopeId!);
}
