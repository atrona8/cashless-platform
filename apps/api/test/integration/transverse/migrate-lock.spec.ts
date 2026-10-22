// Intégration : verrou consultatif de migrate.ts (relecture WP07, mission 5a, renforcement). Deux
// exécutions simultanées (deux déploiements) se suivent au lieu de se croiser. Base jetable créée
// pour la suite, comme migrate-rights.spec.ts. Échoue si `MIGRATE_LOCK` est retiré ou pris après le
// premier accès à `ops.schema_migrations` : la seconde série n'attendrait pas la première (test 1),
// et deux séries simultanées appliqueraient deux fois la même migration ou échoueraient (test 2).
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import { loadMigrations, migrate } from '../../../../../packages/ledger-sql/src/migrate';
import { OWNER_URL, connect, withOwner } from '../../support/db';

const DB = `cashless_migrate_lock_${randomBytes(4).toString('hex')}`;
const dbUrl = (): string => {
  const url = new URL(OWNER_URL);
  url.pathname = `/${DB}`;
  return url.toString();
};
// Même clé que migrate.ts : `hashtextextended('ledger-sql:migrate', 0)`.
const LOCK_KEY = "hashtextextended('ledger-sql:migrate', 0)";

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition non atteinte à temps');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('migrate.ts : deux exécutions simultanées se suivent (verrou consultatif)', () => {
  const clients: Client[] = [];
  const open = async (): Promise<Client> => {
    const client = await connect(dbUrl());
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    await withOwner((owner) => owner.query(`CREATE DATABASE ${DB}`));
  }, 30_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
    await withOwner((owner) => owner.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
  });

  it('verrou tenu par une autre session : la série attend, ne lit ni n’écrit rien, puis passe', async () => {
    const holder = await open();
    const runner = await open();
    const { rows: pid } = await runner.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    const pending = migrate(runner);
    pending.catch(() => undefined);
    try {
      // La série attend le verrou consultatif, sur la clé de migrate.ts.
      await waitFor(async () => {
        const { rows } = await holder.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted AND pid = $1`,
          [pid[0]!.pid],
        );
        return rows[0]!.n > 0;
      });
      // Rien n'a encore été créé : le verrou est pris avant tout accès au registre des migrations.
      const { rows: registry } = await holder.query<{ present: boolean }>(
        "SELECT to_regclass('ops.schema_migrations') IS NOT NULL AS present",
      );
      expect(registry).toEqual([{ present: false }]);
    } finally {
      await holder.query('COMMIT');
    }
    const report = await pending;
    expect(report.applied).toEqual(loadMigrations().map((m) => m.version));
  }, 120_000);

  it('deux séries lancées ensemble : chaque migration appliquée une fois, la seconde n’a rien à faire', async () => {
    // Base vierge propre à ce cas (la première a déjà sa série).
    const fresh = `${DB}_b`;
    await withOwner((owner) => owner.query(`CREATE DATABASE ${fresh}`));
    const url = new URL(OWNER_URL);
    url.pathname = `/${fresh}`;
    const a = await connect(url.toString());
    const b = await connect(url.toString());
    try {
      const reports = await Promise.all([migrate(a), migrate(b)]);
      const versions = loadMigrations().map((m) => m.version);
      const applied = reports.flatMap((report) => report.applied).sort();
      expect(applied).toEqual([...versions].sort());
      // L'une a tout appliqué, l'autre a tout trouvé déjà appliqué.
      expect(reports.map((report) => report.applied.length).sort((x, y) => x - y)).toEqual([
        0,
        versions.length,
      ]);
      const second = reports.find((report) => report.applied.length === 0)!;
      expect(second.skipped).toEqual(versions);
      const { rows } = await a.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM ops.schema_migrations',
      );
      expect(rows).toEqual([{ n: versions.length }]);
    } finally {
      await a.end();
      await b.end();
      await withOwner((owner) => owner.query(`DROP DATABASE IF EXISTS ${fresh} WITH (FORCE)`));
    }
  }, 180_000);
});
