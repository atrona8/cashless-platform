// Bases jetables du banc de bout en bout : `cashless_m8_central_<id>` (migrations du central,
// roles.sql,
// post-roles.sql, rôles `cashless_edge` et `cashless_edgeadmin`) et `cashless_m8_edge_<id>`
// (migrations
// `edge-NNNN` de la passerelle, rôle `edge_app`). Le banc REFUSE, par une erreur explicite : tout
// nom hors du
// préfixe `cashless_m8_`, la base `cashless_test`, le port 5434 (API du porteur) et le port 80.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { applyMigrations } from '../../src/db/migrate';
import { createGatewayPool, type GatewayPool } from '../../src/db/pool';

export const PREFIX = 'cashless_m8_';
const FORBIDDEN_PORTS = new Set([80, 5434]);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

export class BenchRefusal extends Error {
  constructor(message: string) {
    super(`BANC REFUSÉ : ${message}`);
    this.name = 'BenchRefusal';
  }
}

/** Nom de base accepté : préfixe `cashless_m8_`, caractères sûrs, jamais `cashless_test`. */
export function assertDisposableName(name: string): string {
  if (name === 'cashless_test' || name.startsWith('cashless_test')) {
    throw new BenchRefusal('la base cashless_test est réservée à l’orchestrateur');
  }
  if (!/^cashless_m8_[a-z0-9_]{1,40}$/.test(name)) {
    throw new BenchRefusal(`nom de base hors du préfixe ${PREFIX} : ${name}`);
  }
  return name;
}

/** Port du cluster de test : jamais 80 ni 5434 (API partagée du porteur). */
export function assertClusterPort(port: string): string {
  // Forme stricte : chiffres seuls, sans zéro de tête ni espace (`080`, ` 80` ne passent pas pour 80).
  if (!/^[1-9][0-9]{1,4}$/.test(port)) throw new BenchRefusal(`port invalide : ${port}`);
  if (FORBIDDEN_PORTS.has(Number(port))) {
    throw new BenchRefusal(`le port ${port} est celui de l’API du porteur, jamais utilisé`);
  }
  return port;
}

/** Refus explicite d'une base réservée demandée par `PGDATABASE` (jamais ignorée en silence). */
export function assertNoReservedDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const name = env.PGDATABASE;
  if (name !== undefined && name.startsWith('cashless_test')) {
    throw new BenchRefusal(
      `PGDATABASE=${name} : la base cashless_test est réservée à l’orchestrateur`,
    );
  }
}

export interface Cluster {
  host: string;
  port: string;
  user: string;
}

export function cluster(env: NodeJS.ProcessEnv = process.env): Cluster {
  assertNoReservedDatabase(env);
  return {
    host: env.PGHOST ?? '127.0.0.1',
    port: assertClusterPort(env.PGPORT ?? '5433'),
    user: env.PGUSER ?? 'postgres',
  };
}

const roleLocalPassword = (role: string, env: NodeJS.ProcessEnv): string =>
  env[`CASHLESS_${role.replace(/^cashless_/, '').toUpperCase()}_PASSWORD`] ?? `${role}_local`;

export const EDGE_APP_PASSWORD = 'edge_app_local';

export interface CentralUrls {
  owner: string;
  app: string;
  platform: string;
  edge: string;
  edgeadmin: string;
  maint: string;
  tagkeys: string;
  perso: string;
  tagcheck: string;
  keyadmin: string;
  snapcontent: string;
  snapsign: string;
}

export function centralUrls(database: string, c: Cluster = cluster()): CentralUrls {
  assertDisposableName(database);
  const url = (role: string): string =>
    `postgres://${role}:${roleLocalPassword(role, process.env)}@${c.host}:${c.port}/${database}`;
  return {
    owner: `postgres://${c.user}@${c.host}:${c.port}/${database}`,
    app: url('cashless_app'),
    platform: url('cashless_platform'),
    edge: url('cashless_edge'),
    edgeadmin: url('cashless_edgeadmin'),
    maint: url('cashless_maint'),
    tagkeys: url('cashless_tagkeys'),
    perso: url('cashless_perso'),
    tagcheck: url('cashless_tagcheck'),
    keyadmin: url('cashless_keyadmin'),
    snapcontent: url('cashless_snapcontent'),
    snapsign: url('cashless_snapsign'),
  };
}

/** Variables `DATABASE_URL_*` et mots de passe de rôle (valeurs locales de tools/dev-db/env.sh). */
export function centralEnv(database: string, c: Cluster = cluster()): Record<string, string> {
  const u = centralUrls(database, c);
  const passwords: Record<string, string> = {};
  for (const role of [
    'app',
    'platform',
    'tagkeys',
    'perso',
    'tagcheck',
    'keyadmin',
    'snapcontent',
    'snapsign',
    'maint',
    'edge',
    'edgeadmin',
  ]) {
    passwords[`CASHLESS_${role.toUpperCase()}_PASSWORD`] = roleLocalPassword(
      `cashless_${role}`,
      process.env,
    );
  }
  return {
    ...passwords,
    PGHOST: c.host,
    PGPORT: c.port,
    PGUSER: c.user,
    // CI : le propriétaire du cluster a un mot de passe ; sans lui les processus enfants ne se
    //   connectent pas.
    ...(process.env.PGPASSWORD ? { PGPASSWORD: process.env.PGPASSWORD } : {}),
    PGDATABASE: database,
    DATABASE_URL_OWNER: u.owner,
    DATABASE_URL_APP: u.app,
    DATABASE_URL_PLATFORM: u.platform,
    DATABASE_URL_EDGE: u.edge,
    DATABASE_URL_EDGEADMIN: u.edgeadmin,
    DATABASE_URL_MAINT: u.maint,
    DATABASE_URL_TAGKEYS: u.tagkeys,
    DATABASE_URL_PERSO: u.perso,
    DATABASE_URL_TAGCHECK: u.tagcheck,
    DATABASE_URL_KEYADMIN: u.keyadmin,
    DATABASE_URL_SNAPCONTENT: u.snapcontent,
    DATABASE_URL_SNAPSIGN: u.snapsign,
  };
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>, c: Cluster): Promise<T> {
  const client = new Client({
    connectionString: `postgres://${c.user}@${c.host}:${c.port}/postgres`,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const newId = (): string => randomBytes(4).toString('hex');

export interface CentralDatabase {
  name: string;
  urls: CentralUrls;
  env: Record<string, string>;
  drop(): Promise<void>;
}

/** Crée la base du central et joue ses migrations (les rôles de cluster sont idempotents). */
export async function createCentralDatabase(
  id: string = newId(),
  c: Cluster = cluster(),
): Promise<CentralDatabase> {
  const name = assertDisposableName(`${PREFIX}central_${id}`);
  await withAdmin((client) => client.query(`CREATE DATABASE ${name}`), c);
  const env = centralEnv(name, c);
  const run = spawnSync('npx', ['tsx', 'src/migrate.ts'], {
    cwd: join(REPO_ROOT, 'packages', 'ledger-sql'),
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (run.status !== 0) {
    await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`), c);
    throw new Error(`migrations du central en échec : ${run.stderr || run.stdout}`);
  }
  return {
    name,
    urls: centralUrls(name, c),
    env,
    drop: () =>
      withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`), c).then(
        () => undefined,
      ),
  };
}

export interface EdgeDatabase {
  name: string;
  url: string;
  pool: GatewayPool;
  drop(): Promise<void>;
}

/** Crée la base locale de la passerelle (rôle `edge_app` propriétaire) et joue les migrations
/** `edge-NNNN`. */
export async function createEdgeDatabase(
  id: string = newId(),
  c: Cluster = cluster(),
): Promise<EdgeDatabase> {
  const name = assertDisposableName(`${PREFIX}edge_${id}`);
  await withAdmin(async (client) => {
    await client.query('SELECT pg_advisory_lock(7788)');
    const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['edge_app']);
    if (rows.length === 0) {
      await client.query(
        `CREATE ROLE edge_app LOGIN PASSWORD '${EDGE_APP_PASSWORD}' NOSUPERUSER CREATEDB`,
      );
    }
    await client.query('SELECT pg_advisory_unlock(7788)');
    await client.query(`CREATE DATABASE ${name} OWNER edge_app`);
  }, c);
  const url = `postgres://edge_app:${EDGE_APP_PASSWORD}@${c.host}:${c.port}/${name}`;
  const pool = createGatewayPool(url);
  await applyMigrations(pool);
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end().catch(() => undefined);
      await withAdmin(
        (client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
        c,
      ).then(() => undefined);
    },
  };
}

/** Bases `cashless_m8_*` restantes sur le cluster (contrôle « aucune base résiduelle »). */
export async function residualDatabases(c: Cluster = cluster()): Promise<string[]> {
  return withAdmin(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'cashless\\_m8\\_%' ORDER BY 1`,
    );
    return rows.map((row) => row.datname);
  }, c);
}
