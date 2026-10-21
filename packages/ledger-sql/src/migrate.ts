// Exécuteur de migrations du grand livre (research R-02, data-model `ops.schema_migrations`).
// Rôle d'exécution : le propriétaire des tables (DATABASE_URL_OWNER), jamais `cashless_app`.
// La série (migrations non encore appliquées), puis le rejeu de `roles.sql` (idempotent) et de `post-roles.sql`
// s'il existe (droits que `roles.sql`, fichier du kit, ne peut pas poser : mission identite-roles), s'exécutent
// dans UNE transaction (mission 5a, lot WP07, décision du porteur du 20/10/2026) : une fonction créée par une
// migration n'est jamais validée avec l'EXECUTE que PUBLIC reçoit à sa création, et une série dont le rejeu des
// droits échoue n'applique rien. Une migration déjà appliquée dont la somme de contrôle a changé provoque un
// refus. Une migration ne doit donc contenir aucune instruction interdite en transaction (CREATE INDEX
// CONCURRENTLY, VACUUM, ALTER TYPE … ADD VALUE suivi d'un usage de la valeur dans la même série…).
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

/** Contenu des fichiers de droits rejoués après la série ; remplaçable par les tests. */
export interface RoleFiles {
  roles: string;
  /** `undefined` : pas de post-roles.sql. */
  postRoles?: string;
}

export function loadRoleFiles(): RoleFiles {
  return {
    roles: readFileSync(ROLES_FILE, 'utf8'),
    postRoles: existsSync(POST_ROLES_FILE) ? readFileSync(POST_ROLES_FILE, 'utf8') : undefined,
  };
}

// Deux exécutions simultanées (deux déploiements) se suivent au lieu de se croiser.
const MIGRATE_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('ledger-sql:migrate', 0))";

export async function migrate(
  client: Client,
  migrations: Migration[] = loadMigrations(),
  roleFiles: RoleFiles = loadRoleFiles(),
): Promise<MigrationReport> {
  const report: MigrationReport = { applied: [], skipped: [] };
  // Toutes les instructions des migrations, de roles.sql et de post-roles.sql (CREATE/ALTER ROLE, GRANT,
  // REVOKE, politiques, blocs DO) sont transactionnelles en PostgreSQL : une session concurrente voit l'état
  // d'avant la série ou celui d'après, jamais une fonction nouvelle encore exécutable par PUBLIC, ni les droits
  // que roles.sql rend au rôle applicatif (historiques, règles de passage, colonnes secrètes de `media`) avant
  // que post-roles.sql les retire (lot 20, cycle 5).
  await client.query('BEGIN');
  let step = 'préparation';
  try {
    await client.query(MIGRATE_LOCK);
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
      step = `migration ${migration.version}`;
      await client.query(migration.sql);
      await client.query('INSERT INTO ops.schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        migration.checksum,
      ]);
      report.applied.push(migration.version);
    }

    // Droits des rôles, rejoués à chaque série (donne leurs droits aux tables et fonctions nouvelles).
    step = 'droits des rôles';
    report.postRoles = roleFiles.postRoles !== undefined;
    await client.query(roleFiles.roles);
    // Retraits et droits par colonne posés après roles.sql (qui rend INSERT, UPDATE et EXECUTE sur tout).
    if (roleFiles.postRoles !== undefined) await client.query(roleFiles.postRoles);
    // roles.sql et post-roles.sql ne fixent volontairement aucun mot de passe : réglage local / CI seulement.
    // cashless_platform est créé par post-roles.sql : sans ce fichier, son mot de passe n'est pas posé.
    const passwords: [role: string, password: string | undefined][] = [
      ['cashless_app', process.env.CASHLESS_APP_PASSWORD],
      ['cashless_platform', report.postRoles ? process.env.CASHLESS_PLATFORM_PASSWORD : undefined],
      // Rôles des processus des clés de bracelet (mission bracelets-nfc), créés eux aussi par post-roles.sql.
      ['cashless_tagkeys', report.postRoles ? process.env.CASHLESS_TAGKEYS_PASSWORD : undefined],
      ['cashless_perso', report.postRoles ? process.env.CASHLESS_PERSO_PASSWORD : undefined],
      ['cashless_tagcheck', report.postRoles ? process.env.CASHLESS_TAGCHECK_PASSWORD : undefined],
      ['cashless_keyadmin', report.postRoles ? process.env.CASHLESS_KEYADMIN_PASSWORD : undefined],
    ];
    for (const [role, password] of passwords) {
      if (!password) continue;
      const { rows: quoted } = await client.query<{ literal: string }>(
        'SELECT quote_literal($1) AS literal',
        [password],
      );
      await client.query(`ALTER ROLE ${role} PASSWORD ${quoted[0]?.literal}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(
      `Échec de la série (${step}) : ${(error as Error).message} ; aucune migration appliquée.`,
      { cause: error },
    );
  }
  return report;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_OWNER;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_OWNER non défini (rôle propriétaire des tables, jamais cashless_app).',
    );
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
