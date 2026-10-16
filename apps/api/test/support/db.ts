// Connexions de test à la base locale (cluster privé, tools/dev-db) : propriétaire, rôle applicatif et rôle de la
// plateforme.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

const LOCAL = '127.0.0.1:5433/cashless_test';
export const OWNER_URL = process.env.DATABASE_URL_OWNER || `postgres://postgres@${LOCAL}`;
export const APP_URL =
  process.env.DATABASE_URL_APP ||
  `postgres://cashless_app:${process.env.CASHLESS_APP_PASSWORD || 'cashless_app_local'}@${LOCAL}`;
export const PLATFORM_URL =
  process.env.DATABASE_URL_PLATFORM ||
  `postgres://cashless_platform:${process.env.CASHLESS_PLATFORM_PASSWORD || 'cashless_platform_local'}@${LOCAL}`;

/** Rôles de base des processus des clés de bracelet (mission bracelets-nfc, post-roles.sql). */
const roleUrl = (variable: string, role: string, passwordVariable: string): string =>
  process.env[variable] ||
  `postgres://${role}:${process.env[passwordVariable] || `${role}_local`}@${LOCAL}`;
export const TAGKEYS_URL = roleUrl(
  'DATABASE_URL_TAGKEYS',
  'cashless_tagkeys',
  'CASHLESS_TAGKEYS_PASSWORD',
);
export const PERSO_URL = roleUrl('DATABASE_URL_PERSO', 'cashless_perso', 'CASHLESS_PERSO_PASSWORD');
export const TAGCHECK_URL = roleUrl(
  'DATABASE_URL_TAGCHECK',
  'cashless_tagcheck',
  'CASHLESS_TAGCHECK_PASSWORD',
);
export const KEYADMIN_URL = roleUrl(
  'DATABASE_URL_KEYADMIN',
  'cashless_keyadmin',
  'CASHLESS_KEYADMIN_PASSWORD',
);

const REPO_ROOT = join(__dirname, '../../../..');

/** Recrée la base de test par les migrations (packages/ledger-sql/scripts/reset-db.sh). */
export function resetDatabase(): void {
  execFileSync('bash', [join(REPO_ROOT, 'packages/ledger-sql/scripts/reset-db.sh')], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
}

/** Client connecté (à fermer par l'appelant). */
export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function withOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(OWNER_URL);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Écriture concurrente qui devance une lecture sans verrou (lot 20, cycle 8) : `write` est faite dans une transaction
 * ouverte du propriétaire, `start` est lancé, et l'écriture n'est validée qu'une fois qu'une session du rôle `waiter`
 * attend un verrou sur une instruction qui contient `statement`. Rend le résultat de `start`.
 */
export async function commitWhileWaiting<T>(
  write: { sql: string; params: unknown[] },
  waiter: { role: string; statement: string },
  start: () => PromiseLike<T>,
): Promise<T> {
  const holder = await connect(OWNER_URL);
  try {
    await holder.query('BEGIN');
    await holder.query(write.sql, write.params);
    const pending = Promise.resolve(start());
    pending.catch(() => undefined);
    for (let waited = 0; ; waited += 20) {
      const { rows } = await withOwner((db) =>
        db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1 AND wait_event_type = 'Lock' AND position($2 in query) > 0`,
          [waiter.role, waiter.statement],
        ),
      );
      if (rows[0]!.n > 0) break;
      if (waited >= 10_000)
        throw new Error(
          `aucune session ${waiter.role} n'attend le verrou de « ${waiter.statement} »`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    return await pending;
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    await holder.end();
  }
}
