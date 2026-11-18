// Contrôles permanents, alertes et transactions longues (mission 9b, WP12 ; FR-021, FR-023, NFR-006, SC-005, C-010,
// C-011) : chaque contrôle échoue sur une donnée faussée par le propriétaire, lève son alerte (audit `OPS_ALERT`,
// notification `ops_alert`, journal `ALERT`) et son code d'alarme ; réparé, il redescend à 0. Les alertes ne sont pas
// envoyées à une personne (décision du porteur, jusqu'à la mission 12b).
import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { Client } from 'pg';
import { AlarmLog, ALARM_LOG_REPEAT_MS } from '../../../src/processes/bootstrap';
import { LedgerControlsWorker } from '../../../src/processes/controls/ledger-controls.worker';
import { LongTransactionsWorker } from '../../../src/processes/controls/long-transactions.worker';
import { OpenAnomaliesWorker } from '../../../src/processes/controls/open-anomalies.worker';
import { PayoutOverdueWorker } from '../../../src/processes/controls/payout-overdue.worker';
import { StatementUnmatchedWorker } from '../../../src/processes/controls/statement-unmatched.worker';
import { OpsAlerts, scrubDetail } from '../../../src/processes/ops-alerts';
import { APP_URL, connect, MAINT_URL, resetDatabase, withOwner } from '../../support/db';
import {
  alertRows,
  listenAlerts,
  seedLedger,
  startMaintenance,
  uid,
  useMaintenanceEnv,
} from './ops-harness';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Horloge de test des travailleurs (échéances et rappels) : toujours croissante, chaque appel avance de `step`. */
let clock = Date.now();
const tick = (step = 2 * HOUR): number => (clock += step);

/** Passe en mode « réplica » le temps d'une série d'instructions du propriétaire (contourne les gardes). */
const asOwner = (sql: string[]): Promise<void> =>
  withOwner(async (db) => {
    await db.query("SET session_replication_role = 'replica'");
    for (const statement of sql) await db.query(statement);
  });

describe('alertes : journal, audit, jamais silencieuses (C-010)', () => {
  it('scrubDetail retire les clés interdites à toute profondeur et borne la taille', () => {
    const clean = scrubDetail({
      worker: 'x',
      Query: 'select 1',
      nested: { IBAN: 'FR76', ok: 1, list: [{ msisdn: '221', n: 2 }] },
    });
    expect(JSON.stringify(clean)).not.toMatch(/select|FR76|221|iban|msisdn|query/i);
    expect(clean).toMatchObject({ worker: 'x', nested: { ok: 1, list: [{ n: 2 }] } });
    expect(scrubDetail({ worker: 'w', big: 'x'.repeat(5000) })).toEqual({
      truncated: true,
      worker: 'w',
    });
  });

  it('une panne de l’écriture en base ne fait pas taire le journal ALERT et ne lève jamais', async () => {
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    try {
      const broken = {
        withoutTenant: () => Promise.reject(Object.assign(new Error('boom'), { code: '08006' })),
      };
      await new OpsAlerts(broken as never).raise(9, { worker: 'ledger-controls', ledger_id: 'x' });
      expect(logged[0]).toBe(
        JSON.stringify({ level: 'ALERT', code: 9, worker: 'ledger-controls', ledger_id: 'x' }),
      );
      expect(logged[1]).toMatch(/OPS_ALERT_WRITE_FAILED.*08006/);
      expect(logged.join('')).not.toMatch(/boom/);
    } finally {
      spy.mockRestore();
    }
  });

  it('sync : un écart qui dure n’est pas relevé à chaque passage, mais rappelé après une heure', async () => {
    const calls: unknown[] = [];
    const alerts = new OpsAlerts({
      withoutTenant: (fn: (c: unknown) => Promise<unknown>) =>
        fn({ query: (_sql: string, params: unknown[]) => calls.push(params) }),
    } as never);
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const item = { key: 'k', detail: { worker: 'w' } };
      expect(await alerts.sync('w', 9, [item], 0)).toBe(1);
      expect(await alerts.sync('w', 9, [item], 5 * 60_000)).toBe(0);
      expect(await alerts.sync('w', 9, [item], HOUR + 1)).toBe(1);
      expect(await alerts.sync('w', 9, [], 2 * HOUR)).toBe(0);
      expect(await alerts.sync('w', 9, [item], 2 * HOUR + 1)).toBe(1);
      expect(calls).toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('travailleurs : aucune lecture de table (cashless_maint n’a que les ops_*)', () => {
  const dirs = ['src/sealing', 'src/processes/controls'];
  const files = dirs.flatMap((dir) =>
    readdirSync(join(__dirname, '../../..', dir)).map((f) => join(__dirname, '../../..', dir, f)),
  );
  it.each(files.map((f) => [f.split('/src/')[1]!, f]))(
    '%s : FROM et JOIN ne visent que des ops_*',
    (_n, file) => {
      const sql = [...readFileSync(file, 'utf8').matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map(
        (m) => m[1]!,
      );
      for (const target of sql) expect(target).toMatch(/^ops_/);
    },
  );
  it('aucun worker ne nomme la colonne query', () => {
    for (const file of files.filter((f) => /long-transactions/.test(f)))
      expect(readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '')).not.toMatch(
        /\bquery\s*[:,)]|a\.query/,
      );
  });
});

describe('boucle continue : journal du code d’alarme (R-12)', () => {
  it('à chaque changement, au plus une fois par minute pour un code qui dure, le retour à 0 une fois', () => {
    const lines: string[] = [];
    const log = new AlarmLog((line) => lines.push(line));
    expect(log.observe(0, 0)).toBe(false);
    expect(log.observe(9, 1000)).toBe(true);
    for (let t = 6000; t < 1000 + ALARM_LOG_REPEAT_MS; t += 5000)
      expect(log.observe(9, t)).toBe(false);
    expect(log.observe(9, 1000 + ALARM_LOG_REPEAT_MS)).toBe(true);
    expect(log.observe(11, 1000 + ALARM_LOG_REPEAT_MS + 5000)).toBe(true);
    expect(log.observe(0, 1000 + ALARM_LOG_REPEAT_MS + 10_000)).toBe(true);
    expect(log.observe(0, 1000 + ALARM_LOG_REPEAT_MS + 15_000)).toBe(false);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'WORKER_ALARM', code: 9, level: 'ALERT' });
    expect(JSON.parse(lines[3]!)).toMatchObject({ event: 'WORKER_ALARM', code: 0, cleared: 11 });
  });
});

describe('SC-005 : chaque contrôle échoue et lève son alerte', () => {
  let restore: () => void;
  let moduleRef: TestingModule;
  let ctx: Awaited<ReturnType<typeof seedLedger>>;
  const logged: string[] = [];
  let spy: jest.SpyInstance;
  let listener: Awaited<ReturnType<typeof listenAlerts>>;

  beforeAll(async () => {
    resetDatabase();
    restore = useMaintenanceEnv();
    await withOwner(async (db) => {
      ctx = await seedLedger(db, 8851);
    });
    moduleRef = await startMaintenance();
    spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    listener = await listenAlerts(() => connect(MAINT_URL));
  });
  afterAll(async () => {
    spy.mockRestore();
    await listener.stop();
    await moduleRef.close();
    restore();
    resetDatabase();
  });

  it('sans écart : aucun code, aucune alerte (états sains)', async () => {
    for (const cls of [
      LedgerControlsWorker,
      PayoutOverdueWorker,
      StatementUnmatchedWorker,
      OpenAnomaliesWorker,
    ]) {
      const worker = moduleRef.get(cls, { strict: false });
      expect(await worker.runOnce(tick(DAY))).toBe(0);
      expect(worker.alarm()).toBe(0);
    }
    expect(await alertRows(9)).toHaveLength(0);
  });

  it('somme non nulle et droits ≠ argent : alerte 9 ; réparé : code 0', async () => {
    const worker = moduleRef.get(LedgerControlsWorker, { strict: false });
    await asOwner([
      `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
       VALUES ('${ctx.operator}', '${ctx.ledger}', '${ctx.tx}', 3, '${ctx.bank}', 7)`,
    ]);
    const t0 = tick(DAY);
    expect(await worker.runOnce(t0)).toBeGreaterThanOrEqual(2);
    expect(worker.alarm()).toBe(9);
    const controls = (await alertRows(9)).map((a) => a.control).sort();
    expect(controls).toEqual(expect.arrayContaining(['SUM_ZERO', 'CLAIMS_EQUAL_MONEY']));
    expect(await alertRows(9)).toContainEqual(
      expect.objectContaining({ ledger_id: ctx.ledger, detail_count: 1 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(listener.received.filter((n) => n.code === 9).length).toBeGreaterThanOrEqual(2);
    expect(logged.some((l) => /"level":"ALERT","code":9.*SUM_ZERO/.test(l))).toBe(true);
    // Un écart qui dure n'est pas relevé à chaque passage de 5 minutes (le code, lui, reste posé).
    const count = (await alertRows(9)).length;
    await worker.runOnce(t0 + 6 * 60_000);
    expect(worker.alarm()).toBe(9);
    expect((await alertRows(9)).length).toBe(count);
    await asOwner([
      `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
       VALUES ('${ctx.operator}', '${ctx.ledger}', '${ctx.tx}', 4, '${ctx.bank}', -7)`,
    ]);
    await worker.runOnce(t0 + 12 * 60_000);
    expect(worker.alarm()).toBe(0);
    clock = t0 + 12 * 60_000;
  });

  it('cache de soldes faux et compte chaud du mauvais côté : alerte 9 (horloge lente) ; réparé : 0', async () => {
    const worker = moduleRef.get(LedgerControlsWorker, { strict: false });
    await asOwner([
      `INSERT INTO account_balance (account_id, operator_id, balance) VALUES ('${ctx.bank}', '${ctx.operator}', 505)
       ON CONFLICT (account_id) DO UPDATE SET balance = 505`,
    ]);
    const t0 = tick(DAY);
    await worker.runOnce(t0);
    expect(worker.alarm()).toBe(9);
    expect(
      (await alertRows(9)).some((a) => a.control === 'BALANCE_CACHE' && a.ledger_id === ctx.ledger),
    ).toBe(true);
    await asOwner([`UPDATE account_balance SET balance = 500 WHERE account_id = '${ctx.bank}'`]);
    await worker.runOnce(t0 + 2 * HOUR);
    expect(worker.alarm()).toBe(0);
    // Compte chaud (normal D) en solde négatif.
    await asOwner([
      `UPDATE account SET hot = true, purpose = 'ORG_COM' WHERE id = '${ctx.bank}'`,
      `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
       VALUES ('${ctx.operator}', '${ctx.ledger}', '${ctx.tx}', 5, '${ctx.bank}', -5000),
              ('${ctx.operator}', '${ctx.ledger}', '${ctx.tx}', 6, '${ctx.claims}', 5000)`,
    ]);
    await worker.runOnce(t0 + 4 * HOUR);
    clock = t0 + 4 * HOUR;
    expect(worker.alarm()).toBe(9);
    expect((await alertRows(9)).some((a) => a.control === 'HOT_ACCOUNT_SIDE')).toBe(true);
  });

  it('versement INITIATED vieilli de 49 h : alerte 10 sans montant ni coordonnée ; versement récent ignoré', async () => {
    const worker = moduleRef.get(PayoutOverdueWorker, { strict: false });
    await asOwner([
      `INSERT INTO payout (id, operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_at,
                           initiated_by, approved_by, initiated_tx_id) VALUES
        ('${uid(885101)}', '${ctx.operator}', '${ctx.ledger}', '${uid(885102)}', 100, 'CASH', 'INITIATED',
         now() - interval '49 hours', '${uid(885103)}', '${uid(885104)}', '${ctx.tx}'),
        ('${uid(885111)}', '${ctx.operator}', '${ctx.ledger}', '${uid(885102)}', 100, 'CASH', 'INITIATED',
         now() - interval '1 hour', '${uid(885103)}', '${uid(885104)}', '${ctx.tx}')`,
    ]);
    expect(await worker.runOnce(tick(DAY))).toBe(1);
    expect(worker.alarm()).toBe(10);
    const rows = (await alertRows(10)).filter((a) => a.worker === 'payout-overdue');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payout_id: uid(885101), ledger_id: ctx.ledger });
    expect(Object.keys(rows[0]!)).not.toEqual(expect.arrayContaining(['amount']));
    await asOwner([`UPDATE payout SET initiated_at = now() WHERE id = '${uid(885101)}'`]);
    await worker.runOnce(tick(DAY));
    expect(worker.alarm()).toBe(0);
  });

  it('ligne de relevé non rapprochée : alerte 10 ; rapprochée : code 0', async () => {
    const worker = moduleRef.get(StatementUnmatchedWorker, { strict: false });
    await asOwner([
      `INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount)
       VALUES ('${ctx.operator}', '${ctx.ledger}', '${ctx.bank}', 'BANK', 'r8851-old', current_date - 10, 100),
              ('${ctx.operator}', '${ctx.ledger}', '${ctx.bank}', 'BANK', 'r8851-new', current_date, 100)`,
    ]);
    expect(await worker.runOnce(tick(DAY))).toBe(1);
    expect(worker.alarm()).toBe(10);
    const alert = (await alertRows(10)).find((a) => a.worker === 'statement-unmatched')!;
    expect(alert).toMatchObject({ account_id: ctx.bank, unmatched: 1 });
    expect(JSON.stringify(alert)).not.toMatch(/r8851/);
    await asOwner([
      `UPDATE external_statement_line SET matched_tx_id = '${ctx.tx}', matched_by = '${uid(885103)}',
              matched_at = now() WHERE external_ref = 'r8851-old'`,
    ]);
    await worker.runOnce(tick(DAY));
    expect(worker.alarm()).toBe(0);
  });

  it('anomalie nouvelle : alerte 10 ; une anomalie déjà vue ne relève pas l’alerte', async () => {
    const worker = moduleRef.get(OpenAnomaliesWorker, { strict: false });
    await asOwner([
      `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, created_at)
       VALUES ('${uid(885121)}', '${ctx.operator}', '${ctx.ledger}', 'CASH_DIFF', 0, now())`,
    ]);
    const t0 = tick(DAY);
    const count = () =>
      alertRows(10).then((rows) => rows.filter((a) => a.worker === 'open-anomalies').length);
    expect(await worker.runOnce(t0)).toBe(1);
    expect(worker.alarm()).toBe(10);
    expect(await count()).toBe(1);
    // Passage suivant : la même anomalie, toujours ouverte, n'est pas relevée de nouveau.
    expect(await worker.runOnce(t0 + 6 * 60_000)).toBe(0);
    expect(worker.alarm()).toBe(0);
    expect(await count()).toBe(1);
    await asOwner([
      `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, created_at)
       VALUES ('${uid(885122)}', '${ctx.operator}', '${ctx.ledger}', 'CASH_DIFF', 0, now())`,
    ]);
    expect(await worker.runOnce(t0 + 12 * 60_000)).toBe(1);
    expect(await count()).toBe(2);
    clock = t0 + 12 * 60_000;
  });

  it('un contrôle qui échoue (fonction refusée) lève son alerte et son code, jamais le silence', async () => {
    const worker = moduleRef.get(PayoutOverdueWorker, { strict: false });
    const broken = worker as unknown as { tx: { withoutTenant: () => Promise<never> } };
    const original = broken.tx;
    broken.tx = {
      withoutTenant: () => Promise.reject(Object.assign(new Error('x'), { code: '42501' })),
    };
    try {
      await worker.runOnce(tick(DAY));
      expect(worker.alarm()).toBe(10);
    } finally {
      broken.tx = original;
    }
    await worker.runOnce(tick(DAY));
    expect(worker.alarm()).toBe(0);
  });
});

describe('transactions longues (C-011, FR-023)', () => {
  let restore: () => void;
  let moduleRef: TestingModule;
  let held: Client;
  beforeAll(async () => {
    resetDatabase();
    restore = useMaintenanceEnv();
    moduleRef = await startMaintenance();
  });
  afterAll(async () => {
    await held?.end().catch(() => undefined);
    await moduleRef.close();
    restore();
    resetDatabase();
  });

  it('transaction tenue par une session du rôle applicatif : alerte 11 sans texte de requête ; terminée : 0', async () => {
    const worker = moduleRef.get(LongTransactionsWorker, { strict: false });
    worker.useThreshold('1 second');
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    try {
      expect(await worker.runOnce(Date.now())).toBe(0);
      expect(worker.alarm()).toBe(0);
      held = await connect(APP_URL);
      await held.query('BEGIN');
      await held.query("SELECT 'requete-secrete-8861', pg_sleep(0)");
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(await worker.runOnce(Date.now() + HOUR)).toBe(1);
      expect(worker.alarm()).toBe(11);
      const alert = (await alertRows(11))[0]!;
      expect(alert).toMatchObject({ worker: 'long-transactions', usename: 'cashless_app' });
      expect(typeof alert.pid).toBe('number');
      expect(Number(alert.xact_seconds)).toBeGreaterThanOrEqual(1);
      // C-011 : ni la colonne `query`, ni le texte de la requête, nulle part (réponse, alerte, journal).
      const response = await withOwner(async (db) => {
        await db.query('SET ROLE cashless_maint');
        return db.query("SELECT * FROM ops_long_transactions('1 second')");
      });
      expect(response.fields.map((f) => f.name)).not.toContain('query');
      for (const text of [
        JSON.stringify(response.rows),
        JSON.stringify(alert),
        logged.join('\n'),
      ]) {
        expect(text).not.toMatch(/query|requete-secrete|pg_sleep/i);
      }
      expect(logged.some((l) => /"level":"ALERT","code":11/.test(l))).toBe(true);
      // Aucun arrêt de session : la session tenue répond encore.
      await expect(held.query('SELECT 1')).resolves.toBeDefined();
      await held.query('ROLLBACK');
      await worker.runOnce(Date.now() + 2 * HOUR);
      expect(worker.alarm()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
