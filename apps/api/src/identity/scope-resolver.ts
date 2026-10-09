// Portées et englobement (contracts/identity.md « Rôles et portées », research R-05) :
//   PLATFORM ⊃ OPERATOR ⊃ ORGANIZER ⊃ EVENT ;  OPERATOR ⊃ MERCHANT ;  EVENT ⊃ MERCHANT (participation).
// La chaîne d'un objet est lue sous RLS avec le client de la transaction : un objet d'un autre prestataire est
// introuvable (404, identique à un objet inexistant).
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Principal, Role } from './principal';

export type ScopeRef = { type: 'PLATFORM' } | { type: 'OPERATOR' | 'ORGANIZER' | 'EVENT' | 'MERCHANT'; id: string };

/** Maillon de la chaîne : `viaParticipation` = englobement d'un commerçant par un événement où il participe. */
export interface ScopeLink {
  scope: ScopeRef;
  viaParticipation?: boolean;
}

export interface RoleCheckOptions {
  /** L'englobement par participation (EVENT ⊃ MERCHANT) ne vaut que si la route le déclare (lecture). */
  participations?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM: ScopeLink = { scope: { type: 'PLATFORM' } };
/** Chaîne d'une route de portée plateforme : aucune lecture en base. */
export const PLATFORM_CHAIN: readonly ScopeLink[] = [PLATFORM];

const link = (type: 'OPERATOR' | 'ORGANIZER' | 'EVENT' | 'MERCHANT', id: string, viaParticipation?: boolean): ScopeLink =>
  viaParticipation ? { scope: { type, id }, viaParticipation } : { scope: { type, id } };

/** La portée visée puis toutes ses englobantes, de la plus spécifique à la plateforme. */
export async function resolveChain(client: TxClient, ref: ScopeRef): Promise<ScopeLink[]> {
  if (ref.type === 'PLATFORM') return [PLATFORM];
  if (!UUID.test(ref.id)) throw new ProblemException('NOT_FOUND');
  switch (ref.type) {
    case 'OPERATOR': {
      const { rows } = await client.query("SELECT id FROM party WHERE id = $1 AND kind = 'OPERATOR'", [ref.id]);
      if (!rows[0]) throw new ProblemException('NOT_FOUND');
      return [link('OPERATOR', ref.id), PLATFORM];
    }
    case 'ORGANIZER': {
      const operator = await partyOperator(client, ref.id, 'ORGANIZER');
      return [link('ORGANIZER', ref.id), link('OPERATOR', operator), PLATFORM];
    }
    case 'EVENT': {
      const { rows } = await client.query<{ organizer_id: string; operator_id: string }>(
        'SELECT organizer_id, operator_id FROM event WHERE id = $1',
        [ref.id],
      );
      const event = rows[0];
      if (!event) throw new ProblemException('NOT_FOUND');
      return [link('EVENT', ref.id), link('ORGANIZER', event.organizer_id), link('OPERATOR', event.operator_id), PLATFORM];
    }
    case 'MERCHANT': {
      const operator = await partyOperator(client, ref.id, 'MERCHANT');
      const { rows } = await client.query<{ event_id: string; organizer_id: string }>(
        `SELECT DISTINCT mp.event_id, e.organizer_id
           FROM merchant_participation mp JOIN event e ON e.id = mp.event_id
          WHERE mp.merchant_id = $1
          ORDER BY mp.event_id`,
        [ref.id],
      );
      const viaEvents = rows.flatMap((row) => [link('EVENT', row.event_id, true), link('ORGANIZER', row.organizer_id, true)]);
      return [link('MERCHANT', ref.id), ...viaEvents, link('OPERATOR', operator), PLATFORM];
    }
  }
}

async function partyOperator(client: TxClient, id: string, kind: 'ORGANIZER' | 'MERCHANT'): Promise<string> {
  const { rows } = await client.query<{ operator_id: string }>('SELECT operator_id FROM party WHERE id = $1 AND kind = $2', [
    id,
    kind,
  ]);
  if (!rows[0]) throw new ProblemException('NOT_FOUND');
  return rows[0].operator_id;
}

function sameScope(a: ScopeRef, b: { scopeType: string; scopeId: string | null }): boolean {
  return a.type === b.scopeType && (a.type === 'PLATFORM' ? b.scopeId === null : a.id === b.scopeId);
}

/**
 * Rôle exercé : un des rôles demandés tenu sur une portée de la chaîne, le plus spécifique (premier maillon
 * couvert) ; `undefined` si aucun. Les attributions du principal sont les attributions actives (lues en base).
 */
export function exercisedRole(
  principal: Principal,
  roles: readonly Role[],
  chain: readonly ScopeLink[],
  options: RoleCheckOptions = {},
): Role | undefined {
  for (const { scope, viaParticipation } of chain) {
    if (viaParticipation && !options.participations) continue;
    const match = principal.assignments.find((a) => roles.includes(a.role) && sameScope(scope, a));
    if (match) return match.role;
  }
  return undefined;
}

export function hasRole(
  principal: Principal,
  roles: readonly Role[],
  chain: readonly ScopeLink[],
  options: RoleCheckOptions = {},
): boolean {
  return exercisedRole(principal, roles, chain, options) !== undefined;
}
