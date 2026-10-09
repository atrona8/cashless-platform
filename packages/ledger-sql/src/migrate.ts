// Exécuteur de migrations du grand livre (research R-02, data-model `ops.schema_migrations`).
// Rôle d'exécution : le propriétaire des tables (DATABASE_URL_OWNER), jamais `cashless_app`.
// Chaque migration s'exécute dans sa propre transaction ; une migration déjà appliquée dont la somme de contrôle
// a changé provoque un refus. Après la série, `roles.sql` est rejoué (idempotent), puis `post-roles.sql` s'il existe
// (droits que `roles.sql`, fichier du kit, ne peut pas poser : mission identite-roles).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Client } from 'pg';

const PACKAGE_DIR = resolve(__dirname, '..');
export const MIGRATIONS_DIR = join(PACKAGE_DIR, 'migrations');
export const ROLES_FILE = join(PACKAGE_DIR, 'roles.sql');
export const POST_ROLES_FILE = join(PACKAGE_DIR, 'post-roles.sql');

// Directive d'inclusion : `-- @include <chemin relatif au fichier de migration>` (seule sur sa ligne).
const INCLUDE_DIRECTIVE = /^--\s*@include\s+(\S+)\s*$/;

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

/** Contenu effectif d'une migration : chaque directive `@include` est remplacée par le fichier inclus. */
export function resolveMigrationSql(file: string): string {
  const raw = readFileSync(file, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const match = INCLUDE_DIRECTIVE.exec(line);
      return match?.[1] ? readFileSync(resolve(dirname(file), match[1]), 'utf8') : line;
    })
    .join('\n');
}

export function sha256(text: string): string {
  // Fins de ligne normalisées : la somme ne dépend pas de la plateforme d'extraction du dépôt.
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = resolveMigrationSql(join(dir, name));
      return { version: name.replace(/\.sql$/, ''), sql, checksum: sha256(sql) };
    });
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
  postRoles?: boolean;
}

export async function migrate(client: Client, migrations: Migration[] = loadMigrations()): Promise<MigrationReport> {
  await client.query('CREATE SCHEMA IF NOT EXISTS ops');
  await client.query('REVOKE ALL ON SCHEMA ops FROM PUBLIC');
  await client.query(`CREATE TABLE IF NOT EXISTS ops.schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM ops.schema_migrations',
  );
  const known = new Map(rows.map((row) => [row.version, row.checksum]));
  const report: MigrationReport = { applied: [], skipped: [] };

  for (const migration of migrations) {
    const appliedChecksum = known.get(migration.version);
    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.version} déjà appliquée avec une autre somme de contrôle ` +
            `(${appliedChecksum} en base, ${migration.checksum} sur disque) : refus.`,
        );
      }
      report.skipped.push(migration.version);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO ops.schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        migration.checksum,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Échec de la migration ${migration.version} : ${(error as Error).message}`, { cause: error });
    }
    report.applied.push(migration.version);
  }

  // Droits du rôle applicatif, rejoués à chaque série (donne leurs droits aux tables nouvelles).
  await client.query(readFileSync(ROLES_FILE, 'utf8'));
  // Retraits et droits par colonne posés après roles.sql (qui rend INSERT, UPDATE et EXECUTE sur tout).
  report.postRoles = existsSync(POST_ROLES_FILE);
  if (report.postRoles) await client.query(readFileSync(POST_ROLES_FILE, 'utf8'));
  const password = process.env.CASHLESS_APP_PASSWORD;
  if (password) {
    // roles.sql ne fixe volontairement aucun mot de passe : réglage local / CI seulement.
    const { rows: quoted } = await client.query<{ literal: string }>('SELECT quote_literal($1) AS literal', [password]);
    await client.query(`ALTER ROLE cashless_app PASSWORD ${quoted[0]?.literal}`);
  }
  return report;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_OWNER;
  if (!connectionString) {
    throw new Error('DATABASE_URL_OWNER non défini (rôle propriétaire des tables, jamais cashless_app).');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await migrate(client);
    for (const version of report.applied) console.log(`[migrate] appliquée : ${version}`);
    for (const version of report.skipped) console.log(`[migrate] déjà appliquée : ${version}`);
    console.log('[migrate] roles.sql rejoué');
    if (report.postRoles) console.log('[migrate] post-roles.sql rejoué');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[migrate] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
