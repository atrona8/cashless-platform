// Migrations de la base locale : `migrations/edge-NNNN_*.sql` jouées dans l'ordre, une transaction
// chacune, avec
// `edge_schema_migration (nom, empreinte)`. Une empreinte modifiée refuse de poursuivre : un
// fichier déjà joué ne
// change jamais (une correction est une nouvelle migration).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GatewayPool } from './pool';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const FILE = /^edge-[0-9]{4}_[a-z0-9_]+\.sql$/;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationResult {
  applied: string[];
}

export async function applyMigrations(
  pool: GatewayPool,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((name) => FILE.test(name))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Un seul exécuteur à la fois (deux démarrages simultanés).
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['edge_schema_migration']);
    await client.query(
      `CREATE TABLE IF NOT EXISTS edge_schema_migration (
         name       text PRIMARY KEY,
         sha256     text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    for (const name of files) {
      const sql = readFileSync(join(dir, name), 'utf8');
      const sha256 = createHash('sha256').update(sql).digest('hex');
      const known = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM edge_schema_migration WHERE name = $1',
        [name],
      );
      const row = known.rows[0];
      if (row) {
        if (row.sha256 !== sha256) {
          throw new MigrationError(`migration ${name} modifiée après avoir été jouée (empreinte)`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO edge_schema_migration (name, sha256) VALUES ($1, $2)', [
          name,
          sha256,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      applied.push(name);
    }
    return { applied };
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', ['edge_schema_migration'])
      .catch(() => undefined);
    client.release();
  }
}
