// Cas de la matrice x-roles : people (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'listUsers' },
  { operationId: 'createUser' },
  { operationId: 'getUser' },
  { operationId: 'disableUser' },
  {
    operationId: 'grantRole',
    note: 'Personne cible distincte à chaque appel. PLATFORM_ADMIN n’attribue que OPERATOR_ADMIN (role-rules.ts GRANTERS) : son corps l’attribue ; les autres attribuent CASHIER sur l’événement.',
    prepare: async (fx, role) => ({
      method: 'POST',
      path: `/operators/${fx.ids.operator_id}/users/${await fx.newTargetUser()}/role-assignments`,
      body:
        role === 'PLATFORM_ADMIN'
          ? { role: 'OPERATOR_ADMIN', scope_type: 'OPERATOR', scope_id: fx.ids.operator_id }
          : { role: 'CASHIER', scope_type: 'EVENT', scope_id: fx.ids.event_id },
    }),
  },
  {
    operationId: 'revokeRole',
    note: 'Attribution fraîche (OPERATOR_ADMIN pour PLATFORM_ADMIN, qui n’attribue que ce rôle ; CASHIER sinon) à chaque appel (créée en propriétaire) : un appel déclaré la consomme.',
    prepare: async (fx, role) => {
      const user = await fx.newTargetUser();
      const [granted, type, scope] =
        role === 'PLATFORM_ADMIN'
          ? ['OPERATOR_ADMIN', 'OPERATOR', fx.ids.operator_id]
          : ['CASHIER', 'EVENT', fx.ids.event_id];
      const id = await fx.owner(
        async (db) =>
          (
            await db.query<{ id: string }>(
              `INSERT INTO role_assignment (user_id, role, scope_type, scope_id)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [user, granted, type, scope],
            )
          ).rows[0]!.id,
      );
      return {
        method: 'POST',
        path: `/operators/${fx.ids.operator_id}/role-assignments/${id}/revoke`,
        body: {},
      };
    },
  },
  { operationId: 'createPlatformAdmin' },
];
