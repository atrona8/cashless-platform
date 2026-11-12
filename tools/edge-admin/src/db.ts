// Accès base de l'outil : le rôle `cashless_edgeadmin` seulement (EXECUTE sur six fonctions, aucun droit de table).
// Un seul pool, d'une connexion, ouvert à la première commande et fermé en `finally`. Chaque appel de fonction se fait
// dans une transaction qui pose `app.operator_id` (les fonctions appellent `assert_tenant`). Aucun SELECT direct.
import { Pool } from 'pg';

export const EDGEADMIN_ROLE = 'cashless_edgeadmin';

/** Les seules fonctions que l'outil appelle, avec le type de chacun de leurs paramètres (interfaces.md § 2, § 12). */
export const FUNCTIONS = {
  register_edge_gateway: [
    'uuid',
    'uuid',
    'text',
    'text',
    'bytea',
    'bytea',
    'bytea',
    'text',
    'text',
  ],
  revoke_edge_gateway: ['uuid', 'text', 'text'],
  rotate_edge_gateway_cert: ['uuid', 'bytea', 'text'],
  swap_edge_gateway_roles: ['uuid', 'uuid', 'text'],
  edge_register_snapshot_key: ['uuid', 'text', 'bytea', 'text'],
} as const satisfies Record<string, readonly string[]>;

export type AdminFunction = keyof typeof FUNCTIONS;

export interface AdminSession {
  call(fn: AdminFunction, args: readonly unknown[]): Promise<unknown>;
}

export interface AdminDb {
  /** Transaction sous `app.operator_id = operatorId` ; annulée si `work` échoue. */
  withOperator<T>(operatorId: string, work: (session: AdminSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Refuse toute URL qui ne soit pas celle du rôle d'administration (jamais `cashless_app`, `cashless_edge`...). */
export function assertEdgeAdminUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL_EDGEADMIN manquant');
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error('DATABASE_URL_EDGEADMIN illisible');
  }
  if (user !== EDGEADMIN_ROLE)
    throw new Error(`DATABASE_URL_EDGEADMIN doit désigner le rôle ${EDGEADMIN_ROLE}`);
  return url;
}

export function sqlFor(fn: AdminFunction): string {
  const types = FUNCTIONS[fn];
  return `SELECT ${fn}(${types.map((type, i) => `$${i + 1}::${type}`).join(', ')}) AS result`;
}

export function openAdminDb(connectionString: string): AdminDb {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    async withOperator(operatorId, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
        const result = await work({
          async call(fn, args) {
            const { rows } = await client.query<{ result: unknown }>(sqlFor(fn), [...args]);
            return rows[0]?.result;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
