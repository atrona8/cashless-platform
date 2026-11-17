// Scellement, copie et vérification (mission 9b, WP12 ; FR-020, NFR-005, SC-004) : le processus `maintenance` scelle les
// grands livres (LOCKED compris) et les chaînes d'audit (plateforme comprise), copie à l'extérieur (SIMULÉE : décision du
// porteur jusqu'à la mission 12b), pose la référence une fois, et la vérification quotidienne détecte toute altération.
import 'reflect-metadata';
import type { TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { runWorkers } from '../../../src/processes/bootstrap';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { AuditSealWorker } from '../../../src/sealing/audit-seal.worker';
import { LedgerSealWorker } from '../../../src/sealing/ledger-seal.worker';
import type { SealExternalCopy, SealIdentity } from '../../../src/sealing/seal-copy';
import { SealVerifyWorker } from '../../../src/sealing/seal-verify.worker';
import { connect, MAINT_URL, resetDatabase, withOwner } from '../../support/db';
import {
  alertRows,
  listenAlerts,
  seedAgedAudit,
  seedLedger,
  startMaintenance,
  tampered,
  useMaintenanceEnv,
} from '../controls/ops-harness';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Copie « réelle » d'essai (mémoire du test, pas du processus) : sans `isFake`, donc relue et comparée. */
class MemoryCopy implements SealExternalCopy {
  readonly store = new Map<string, Buffer>();
  write(seal: SealIdentity, sealHash: Buffer): Promise<string> {
    const ref = `mem:${seal.kind}:${seal.id}:${seal.sealNo}`;
    this.store.set(ref, sealHash);
    return Promise.resolve(ref);
  }
  read(ref: string): Promise<Buffer | null> {
    return Promise.resolve(this.store.get(ref) ?? null);
  }
}

const seals = (table: 'ledger_seal' | 'audit_seal') =>
  withOwner(
    async (db) =>
      (
        await db.query(
          `SELECT seal_no, seal_hash, external_ref, sealed_at FROM ${table} ORDER BY 1`,
        )
      ).rows as Array<{
        seal_no: number;
        seal_hash: Buffer;
        external_ref: string | null;
        sealed_at: Date;
      }>,
  );

describe('scellement et copie externe simulée (FR-020, NFR-005)', () => {
  let restore: () => void;
  let moduleRef: TestingModule;
  let ids: Awaited<ReturnType<typeof seedLedger>>;
  beforeAll(async () => {
    resetDatabase();
    restore = useMaintenanceEnv();
    await withOwner(async (db) => {
      ids = await seedLedger(db, 8801);
      await seedLedger(db, 8802, { status: 'LOCKED' });
      // NFR-005 : écriture enregistrée il y a 5 min 30 s ; le travailleur doit la sceller et la copier tout de suite.
      await seedLedger(db, 8803, { ageMinutes: 5.5 });
      await seedAgedAudit(db, [ids.operator]);
    });
    moduleRef = await startMaintenance();
  });
  afterAll(async () => {
    await moduleRef.close();
    restore();
    resetDatabase();
  });

  it('grand livre : un scellement par grand livre (LOCKED compris), copie simulée posée une fois', async () => {
    const worker = moduleRef.get(LedgerSealWorker, { strict: false });
    const t0 = Date.now();
    // 3 scellements écrits + 3 références de copie posées.
    expect(await worker.runOnce(t0)).toBe(6);
    const rows = await seals('ledger_seal');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.external_ref).toBe(`fake:${row.seal_hash.toString('hex')}`);
    // Une seconde pose de la référence est refusée (CL029) ; le rejeu de la même référence ne fait rien.
    const maint = await connect(MAINT_URL);
    try {
      const sealed = await withOwner(
        async (db) =>
          (await db.query('SELECT ledger_id FROM ledger_seal WHERE ledger_id = $1', [ids.ledger]))
            .rows[0],
      );
      await expect(
        maint.query(`SELECT ops_record_seal_copy('LEDGER', $1::uuid, 1, 'autre')`, [
          sealed.ledger_id,
        ]),
      ).rejects.toMatchObject({ code: 'CL029' });
    } finally {
      await maint.end();
    }
    // Rien à faire : 0. Avant l'échéance : 0 aussi.
    expect(await worker.runOnce(t0 + MIN)).toBe(0);
    expect(await worker.runOnce(t0 + 6 * MIN)).toBe(0);
    expect(worker.alarm()).toBe(0);
  });

  it('NFR-005 : écriture de 5 min 30 s scellée ET copiée, bien avant 10 minutes (durée mesurée par la base)', async () => {
    const [row] = await withOwner(
      async (db) =>
        (
          await db.query(
            `SELECT s.external_ref IS NOT NULL AS copied,
                  clock_timestamp() - t.recorded_at < interval '10 minutes' AS within_10_min,
                  s.sealed_at >= t.recorded_at AS ordered
             FROM journal_transaction t JOIN ledger_seal s ON s.ledger_id = t.ledger_id
            WHERE t.id = $1`,
            [uid8803()],
          )
        ).rows,
    );
    expect(row).toEqual({ copied: true, within_10_min: true, ordered: true });
  });

  it('chaînes d’audit : plateforme comprise, une copie simulée par scellement', async () => {
    const worker = moduleRef.get(AuditSealWorker, { strict: false });
    const n = await worker.runOnce(Date.now());
    // Deux chaînes (le prestataire de 8801 et la plateforme) : deux scellements et deux copies au moins.
    expect(n).toBeGreaterThanOrEqual(4);
    const rows = await seals('audit_seal');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.external_ref === `fake:${r.seal_hash.toString('hex')}`)).toBe(true);
    expect(await worker.runOnce(Date.now() + 6 * MIN)).toBe(0);
  });

  it('la vérification d’une copie simulée rend « copie simulée », jamais « conforme »', async () => {
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    expect(await verify.runOnce(Date.now())).toBeGreaterThan(0);
    expect(verify.alarm()).toBe(0);
    expect(verify.lastState()).toBe('copie simulée');
    const lines = await verify.describe();
    expect(lines.join(' ')).toMatch(/SIMULÉE/);
    expect(lines.join(' ')).not.toMatch(/conforme/);
  });

  it('SC-004 : une ligne scellée modifiée est détectée (alarme 8, OPS_ALERT, notification, journal ALERT)', async () => {
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    const listener = await listenAlerts(() => connect(MAINT_URL));
    try {
      const before = (await alertRows(8)).length;
      await tampered(
        `UPDATE posting SET amount = amount + 1 WHERE ledger_id = '${ids.ledger}' AND line_no = 1`,
        `UPDATE posting SET amount = amount - 1 WHERE ledger_id = '${ids.ledger}' AND line_no = 1`,
        async () => {
          expect(await verify.runOnce(Date.now() + DAY)).toBeGreaterThan(0);
        },
      );
      expect(verify.alarm()).toBe(8);
      expect(verify.lastState()).toBe('ÉCART');
      const rows = await alertRows(8);
      expect(rows.length).toBe(before + 1);
      expect(rows[0]).toMatchObject({
        worker: 'seal-verify',
        check: 'ledger_chain',
        ledger_id: ids.ledger,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(listener.received.some((n) => n.code === 8)).toBe(true);
      expect(logged.some((line) => /"level":"ALERT","code":8/.test(line))).toBe(true);
      // Réparé : le passage suivant est propre, l'alarme redescend.
      expect(await verify.runOnce(Date.now() + 2 * DAY)).toBeGreaterThan(0);
      expect(verify.alarm()).toBe(0);
      expect(verify.lastState()).toBe('copie simulée');
    } finally {
      spy.mockRestore();
      await listener.stop();
    }
  });

  it('SC-004 : une ligne d’audit modifiée (chaîne d’un prestataire) est détectée', async () => {
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    await tampered(
      `UPDATE audit_log SET object_id = '999' WHERE operator_id = '${ids.operator}' AND action = 'T88'`,
      `UPDATE audit_log SET object_id = '1' WHERE operator_id = '${ids.operator}' AND action = 'T88'`,
      async () => {
        await verify.runOnce(Date.now() + 3 * DAY);
      },
    );
    expect(verify.alarm()).toBe(8);
    expect((await alertRows(8))[0]).toMatchObject({
      check: 'audit_chain',
      chain_key: ids.operator,
    });
    await verify.runOnce(Date.now() + 4 * DAY);
    expect(verify.alarm()).toBe(0);
  });

  it('SC-004 : la chaîne d’audit de la plateforme altérée est détectée', async () => {
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    await tampered(
      `UPDATE audit_log SET object_id = '999' WHERE operator_id IS NULL AND action = 'T88'`,
      `UPDATE audit_log SET object_id = '1' WHERE operator_id IS NULL AND action = 'T88'`,
      async () => {
        await verify.runOnce(Date.now() + 5 * DAY);
      },
    );
    expect(verify.alarm()).toBe(8);
    await verify.runOnce(Date.now() + 6 * DAY);
    expect(verify.alarm()).toBe(0);
  });

  it('SC-004 : un seal_hash falsifié est détecté', async () => {
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    const original = (await seals('ledger_seal'))[0]!.seal_hash.toString('hex');
    await tampered(
      `UPDATE ledger_seal SET seal_hash = sha256('faux'::bytea) WHERE ledger_id = '${ids.ledger}'`,
      `UPDATE ledger_seal SET seal_hash = decode('${original}', 'hex') WHERE ledger_id = '${ids.ledger}'`,
      async () => {
        await verify.runOnce(Date.now() + 7 * DAY);
      },
    );
    expect(verify.alarm()).toBe(8);
    await verify.runOnce(Date.now() + 8 * DAY);
    expect(verify.alarm()).toBe(0);
  });
});

function uid8803(): string {
  return '00000000-0000-4000-8000-000000880306';
}

describe('copie réelle d’essai : relue et comparée (SC-004, copie qui diffère)', () => {
  let restore: () => void;
  let moduleRef: TestingModule;
  const copy = new MemoryCopy();
  beforeAll(async () => {
    resetDatabase();
    restore = useMaintenanceEnv();
    await withOwner(async (db) => {
      await seedLedger(db, 8821);
    });
    moduleRef = await startMaintenance(copy);
  });
  afterAll(async () => {
    await moduleRef.close();
    restore();
    resetDatabase();
  });

  it('copie conforme : « conforme » ; copie différente ou introuvable : alarme 8', async () => {
    await moduleRef.get(LedgerSealWorker, { strict: false }).runOnce(Date.now());
    const verify = moduleRef.get(SealVerifyWorker, { strict: false });
    expect(await verify.runOnce(Date.now())).toBeGreaterThan(0);
    expect(verify.alarm()).toBe(0);
    expect(verify.lastState()).toBe('conforme');
    const [ref] = [...copy.store.keys()];
    const good = copy.store.get(ref!)!;
    copy.store.set(ref!, Buffer.alloc(good.length, 1));
    await verify.runOnce(Date.now() + DAY);
    expect(verify.alarm()).toBe(8);
    expect((await alertRows(8))[0]).toMatchObject({ check: 'copy', reason: 'copie différente' });
    copy.store.delete(ref!);
    await verify.runOnce(Date.now() + 2 * DAY);
    expect(verify.alarm()).toBe(8);
    expect((await alertRows(8))[0]).toMatchObject({ reason: 'copie introuvable' });
    copy.store.set(ref!, good);
    await verify.runOnce(Date.now() + 3 * DAY);
    expect(verify.alarm()).toBe(0);
  });

  it('une copie qui échoue ne bloque pas le scellement ; elle est reprise au passage suivant (alarme 7)', async () => {
    await withOwner(async (db) => {
      await seedLedger(db, 8822);
    });
    const worker = moduleRef.get(LedgerSealWorker, { strict: false });
    const original = copy.write.bind(copy);
    copy.write = () => Promise.reject(new Error('stockage indisponible : secret=abc'));
    const t0 = Date.now() + 10 * DAY;
    expect(await worker.runOnce(t0)).toBe(1);
    expect(worker.alarm()).toBe(7);
    const alert = (await alertRows(7))[0]!;
    expect(alert).toMatchObject({ worker: 'ledger-seal', step: 'copy' });
    expect(JSON.stringify(alert)).not.toMatch(/secret|stockage/);
    expect((await seals('ledger_seal')).filter((s) => s.external_ref === null)).toHaveLength(1);
    copy.write = original;
    expect(await worker.runOnce(t0 + 6 * MIN)).toBe(1);
    expect(worker.alarm()).toBe(0);
    expect((await seals('ledger_seal')).filter((s) => s.external_ref === null)).toHaveLength(0);
  });
});

describe('droits et démarrage (FR-020, règle « aucun faux en production »)', () => {
  let restore: () => void;
  beforeAll(() => {
    resetDatabase();
    restore = useMaintenanceEnv();
  });
  afterAll(() => {
    restore();
    resetDatabase();
  });

  it('cashless_maint appelle les ops_* et rien d’autre : aucune lecture de table', async () => {
    const maint = await connect(MAINT_URL);
    try {
      await maint.query('SELECT * FROM ops_seals_since(NULL)');
      for (const table of [
        'ledger_seal',
        'audit_seal',
        'audit_log',
        'posting',
        'payout',
        'anomaly',
      ])
        await expect(maint.query(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      const { rows } = await maint.query(
        `SELECT pg_has_role('cashless_maint', 'pg_signal_backend', 'member') AS signal,
                pg_has_role('cashless_maint', 'pg_read_all_stats', 'member') AS stats`,
      );
      expect(rows[0]).toEqual({ signal: false, stats: false });
    } finally {
      await maint.end();
    }
  });

  it('--once hors production : passe, code de sortie 0', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await runWorkers(MaintenanceProcessModule, ['--once'])).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  it('--list décrit les huit travailleurs, la copie est dite SIMULÉE', async () => {
    const lines: string[] = [];
    const log = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      expect(await runWorkers(MaintenanceProcessModule, ['--list'])).toBe(0);
    } finally {
      log.mockRestore();
    }
    const text = lines.join('\n');
    for (const name of [
      'ledger-seal',
      'audit-seal',
      'seal-verify',
      'ledger-controls',
      'payout-overdue',
      'statement-unmatched',
      'open-anomalies',
      'long-transactions',
    ])
      expect(text).toContain(name);
    expect(text).toMatch(/SIMULÉE/);
  });
});
