// Outils communs des essais du processus `maintenance` (mission 9b, WP12 ; SC-004, SC-005) : démarrage du processus
// sous le rôle `cashless_maint`, données du propriétaire (grands livres, écritures anciennes, journal d'audit) et
// altérations simulées (déclencheurs désactivés le temps de l'altération, modèle `tests_audit_log.sql`).
import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Client } from 'pg';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { SEAL_COPY } from '../../../src/security/port-tokens';
import type { SealExternalCopy } from '../../../src/sealing/seal-copy';
import { MAINT_URL, withOwner } from '../../support/db';

/** Identifiant de test : `00000000-0000-4000-8000-<12 chiffres>`. */
export const uid = (n: string | number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Environnement du processus : rôle `cashless_maint`, hors production (le faux de copie y est admis). */
export function useMaintenanceEnv(): () => void {
  const saved = { maint: process.env.DATABASE_URL_MAINT, env: process.env.NODE_ENV };
  process.env.DATABASE_URL_MAINT = MAINT_URL;
  process.env.NODE_ENV = 'test';
  return () => {
    if (saved.maint === undefined) delete process.env.DATABASE_URL_MAINT;
    else process.env.DATABASE_URL_MAINT = saved.maint;
    if (saved.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.env;
  };
}

export async function startMaintenance(copy?: SealExternalCopy): Promise<TestingModule> {
  let builder = Test.createTestingModule({ imports: [MaintenanceProcessModule] });
  if (copy) builder = builder.overrideProvider(SEAL_COPY).useValue(copy);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}

/**
 * Prestataire, organisateur, grand livre (compte bancaire et compte de droits) et UNE écriture équilibrée de 500
 * enregistrée il y a `ageMinutes` minutes. Ids : `<n>01` prestataire, `<n>02` organisateur, `<n>03` grand livre,
 * `<n>04` banque, `<n>05` droits, `<n>06` transaction.
 */
export async function seedLedger(
  db: Client,
  n: number,
  options: { ageMinutes?: number; status?: 'OPEN' | 'LOCKED' } = {},
): Promise<{ operator: string; ledger: string; bank: string; claims: string; tx: string }> {
  const id = (k: number) => uid(`${n}${String(k).padStart(2, '0')}`);
  const [operator, organizer, ledger, bank, claims, tx] = [1, 2, 3, 4, 5, 6].map(id) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  await db.query(
    `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (essai)'
      WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
  );
  await db.query(
    `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Prestataire ' || $2::text, 'SN')`,
    [operator, String(n)],
  );
  await db.query(
    `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Org ' || $3::text)`,
    [organizer, operator, String(n)],
  );
  await db.query(
    `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
     VALUES ($1, $2, 'EVENT', gen_random_uuid(), 'XOF', $3, $3)`,
    [ledger, operator, organizer],
  );
  await db.query(
    `INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side, hot, allow_negative) VALUES
       ($1, $3, $4, 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
       ($2, $3, $4, 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false)`,
    [bank, claims, operator, ledger],
  );
  await db.query(
    `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at,
                                      recorded_at, source)
     VALUES ($1::uuid, $2, $3, 'TOPUP', 'k' || $1::text, 'h', now(), now() - ($4::float8 * interval '1 minute'), 'ONLINE')`,
    [tx, operator, ledger, options.ageMinutes ?? 60],
  );
  await db.query(
    `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) VALUES
       ($1, $2, $3, 1, $4, 500), ($1, $2, $3, 2, $5, -500)`,
    [operator, ledger, tx, bank, claims],
  );
  if (options.status === 'LOCKED')
    await db.query(`UPDATE ledger SET status = 'LOCKED' WHERE id = $1`, [ledger]);
  return { operator, ledger, bank, claims, tx };
}

/** Une ligne d'audit par chaîne (une prestataire, la plateforme), vieillie d'une heure : scellable tout de suite. */
export async function seedAgedAudit(db: Client, operators: string[]): Promise<void> {
  for (const operator of operators)
    await db.query(
      `INSERT INTO audit_log (operator_id, action, object_type, object_id, origin) VALUES ($1, 'T88', 'x', '1', 'test')`,
      [operator],
    );
  await db.query(
    `INSERT INTO audit_log (operator_id, action, object_type, object_id, origin) VALUES (NULL, 'T88', 'x', '1', 'test')`,
  );
  await db.query("SET session_replication_role = 'replica'");
  try {
    await db.query(`UPDATE audit_log SET occurred_at = occurred_at - interval '1 hour'`);
    await db.query(
      `UPDATE audit_log SET row_hash = sha256(prev_hash || convert_to(audit_row_canonical(audit_log), 'UTF8'))`,
    );
  } finally {
    await db.query("SET session_replication_role = 'origin'");
  }
}

/** Altération par le propriétaire (déclencheurs désactivés le temps de l'instruction) puis retour en arrière. */
export async function tampered<T>(sql: string, undo: string, run: () => Promise<T>): Promise<T> {
  await withOwner(async (db) => {
    await db.query("SET session_replication_role = 'replica'");
    await db.query(sql);
  });
  try {
    return await run();
  } finally {
    await withOwner(async (db) => {
      await db.query("SET session_replication_role = 'replica'");
      await db.query(undo);
    });
  }
}

/** Écoute `ops_alert` ; `stop` rend les notifications reçues. */
export async function listenAlerts(
  connect: () => Promise<Client>,
): Promise<{ received: Array<{ code: number; audit_id: number }>; stop: () => Promise<void> }> {
  const client = await connect();
  const received: Array<{ code: number; audit_id: number }> = [];
  client.on('notification', (message) => {
    if (message.channel === 'ops_alert' && message.payload)
      received.push(JSON.parse(message.payload) as { code: number; audit_id: number });
  });
  await client.query('LISTEN ops_alert');
  return { received, stop: () => client.end() };
}

/** Lignes d'audit `OPS_ALERT` (plateforme) du code donné, plus récentes d'abord. */
export async function alertRows(code: number): Promise<Array<Record<string, unknown>>> {
  return withOwner(async (db) => {
    const { rows } = await db.query(
      `SELECT after FROM audit_log WHERE action = 'OPS_ALERT' AND object_id = $1 ORDER BY id DESC`,
      [String(code)],
    );
    return rows.map((row: { after: Record<string, unknown> }) => row.after);
  });
}
