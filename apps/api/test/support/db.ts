// Connexions de test à la base locale (cluster privé, tools/dev-db) : propriétaire et rôle applicatif.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

const LOCAL = '127.0.0.1:5433/cashless_test';
export const OWNER_URL = process.env.DATABASE_URL_OWNER || `postgres://postgres@${LOCAL}`;
export const APP_URL =
  process.env.DATABASE_URL_APP ||
  `postgres://cashless_app:${process.env.CASHLESS_APP_PASSWORD || 'cashless_app_local'}@${LOCAL}`;

const REPO_ROOT = join(__dirname, '../../../..');

/** Recrée la base de test par les migrations (packages/ledger-sql/scripts/reset-db.sh). */
export function resetDatabase(): void {
  execFileSync('bash', [join(REPO_ROOT, 'packages/ledger-sql/scripts/reset-db.sh')], { cwd: REPO_ROOT, stdio: 'ignore' });
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
