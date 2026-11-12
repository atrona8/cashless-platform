// Bases jetables `cashless_m8_edge_*` (jamais `cashless_test`), rôle `edge_app` non
// superutilisateur, propriétaire.
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { applyMigrations } from '../../../src/db/migrate';
import { createGatewayPool, type GatewayPool } from '../../../src/db/pool';

const HOST = process.env.PGHOST ?? '127.0.0.1';
const PORT = process.env.PGPORT ?? '5433';
export const APP_PASSWORD = 'edge_app_local';

export const adminUrl = (port = PORT, database = 'postgres'): string =>
  `postgres://${process.env.PGUSER ?? 'postgres'}@${HOST}:${port}/${database}`;
export const appUrl = (
  database: string,
  port = PORT,
  role = 'edge_app',
  password = APP_PASSWORD,
): string => `postgres://${role}:${password}@${HOST}:${port}/${database}`;

export async function admin<T>(fn: (client: Client) => Promise<T>, port = PORT): Promise<T> {
  const client = new Client({ connectionString: adminUrl(port) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureRole(
  port = PORT,
  role = 'edge_app',
  password = APP_PASSWORD,
): Promise<void> {
  await admin(async (c) => {
    await c.query('SELECT pg_advisory_lock(7788)');
    const { rows } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (rows.length === 0) {
      await c.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER CREATEDB`);
    }
    await c.query('SELECT pg_advisory_unlock(7788)');
  }, port);
}

export interface TestDb {
  name: string;
  url: string;
  pool: GatewayPool;
  drop(): Promise<void>;
}

export async function createTestDb(
  options: { migrate?: boolean; port?: string; role?: string; password?: string } = {},
): Promise<TestDb> {
  const port = options.port ?? PORT;
  const role = options.role ?? 'edge_app';
  const password = options.password ?? APP_PASSWORD;
  await ensureRole(port, role, password);
  const name = `cashless_m8_edge_${randomBytes(4).toString('hex')}`;
  await admin((c) => c.query(`CREATE DATABASE ${name} OWNER ${role}`), port);
  const url = appUrl(name, port, role, password);
  const pool = createGatewayPool(url);
  if (options.migrate !== false) await applyMigrations(pool);
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end();
      await admin((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`), port);
    },
  };
}

/**
 * Superutilisateur jetable au mot de passe fort de test, supprimé en `finally` : le mot de passe
 * du superutilisateur du serveur de test peut être absent (CI) ou trivial, refusé avant la règle
 * du rôle ; un rôle jetable isole la seule règle « rôle superutilisateur refusé ». Rend l'URL de
 * connexion à la base `dbName` sous ce rôle.
 */
export async function withDisposableSuperuser<T>(
  dbName: string,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  const password = 'Zk9-Longue-Phrase-8hQw3';
  const role = `edge_su_${randomBytes(4).toString('hex')}`;
  await admin((c) => c.query(`CREATE ROLE ${role} LOGIN SUPERUSER PASSWORD '${password}'`));
  try {
    return await fn(`postgres://${role}:${password}@${HOST}:${PORT}/${dbName}`);
  } finally {
    await admin((c) => c.query(`DROP ROLE IF EXISTS ${role}`));
  }
}
