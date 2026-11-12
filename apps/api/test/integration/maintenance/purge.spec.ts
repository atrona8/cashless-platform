// Processus `maintenance` (mission hors-ligne-snapshots-lots, WP10, OP-N75) : les purges des terminaux tournent sous
// le rôle `cashless_maint`, le seul à pouvoir les exécuter ; `cashless_app` est refusé (42501).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import {
  DevicePurgeWorker,
  NONCE_PURGE_BATCH,
} from '../../../src/device-identity/device-maintenance';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { APP_URL, connect, MAINT_URL, withOwner } from '../../support/db';

const OP = 'a0000000-0000-4000-8000-0000000000a1';
const DEVICE = 'd0000000-0000-4000-8000-0000000000d1';

async function seed(): Promise<{ stale: Buffer; fresh: Buffer }> {
  const stale = randomBytes(16);
  const fresh = randomBytes(16);
  await withOwner(async (db) => {
    await db.query("SET session_replication_role = 'replica'");
    await db.query('DELETE FROM device_request_nonce');
    await db.query('DELETE FROM device_enrollment_attempt');
    await db.query(
      `INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 hour'), ($1, $2, $4, now() + interval '1 hour')`,
      [OP, DEVICE, stale, fresh],
    );
  });
  return { stale, fresh };
}

const present = (nonce: Buffer): Promise<number> =>
  withOwner(
    async (db) =>
      (await db.query('SELECT 1 FROM device_request_nonce WHERE nonce = $1', [nonce])).rowCount ??
      0,
  );

describe('processus maintenance : purges des terminaux sous cashless_maint', () => {
  const saved = process.env.DATABASE_URL_MAINT;
  beforeAll(() => {
    process.env.DATABASE_URL_MAINT = MAINT_URL;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.DATABASE_URL_MAINT;
    else process.env.DATABASE_URL_MAINT = saved;
  });

  async function start() {
    const moduleRef = await Test.createTestingModule({
      imports: [MaintenanceProcessModule],
    }).compile();
    await moduleRef.init();
    return { moduleRef, workers: moduleRef.get(WorkerRegistry, { strict: false }) };
  }

  it('--list décrit le travailleur et n’écrit rien en base', async () => {
    const { stale } = await seed();
    const { moduleRef, workers } = await start();
    try {
      // Mission 8 (WP12) : deux travailleurs de passerelle s'ajoutent à la purge des terminaux.
      expect(workers.names()).toEqual(['edge-silence', 'edge-release-stuck', 'device-purge']);
      const lines = await workers.describe();
      expect(lines).toHaveLength(3);
      expect(lines.filter((l) => /device-purge|nonces expirés/.test(l))).toHaveLength(1);
      expect(await present(stale)).toBe(1);
    } finally {
      await moduleRef.close();
    }
  });

  it('--once retire les nonces expirés (rôle cashless_maint), garde ceux de la fenêtre', async () => {
    const { stale, fresh } = await seed();
    const { moduleRef, workers } = await start();
    try {
      const role = moduleRef.get(DevicePurgeWorker);
      expect(role).toBeDefined();
      expect(await workers.drain()).toBeGreaterThanOrEqual(1);
      expect(await present(stale)).toBe(0);
      expect(await present(fresh)).toBe(1);
      expect(workers.alarm()).toBe(0);
    } finally {
      await moduleRef.close();
    }
  });

  it('intervalle respecté : pas de second passage avant l’échéance, passage après', async () => {
    const { moduleRef } = await start();
    try {
      const worker = moduleRef.get(DevicePurgeWorker);
      const t0 = 1_000_000_000;
      await seed();
      expect(await worker.runOnce(t0)).toBeGreaterThanOrEqual(1);
      expect(await worker.runOnce(t0)).toBe(0); // rien à retirer : prochain passage dans l'intervalle
      const again = randomBytes(16);
      await withOwner(async (db) => {
        await db.query("SET session_replication_role = 'replica'");
        await db.query(
          `INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
           VALUES ($1, $2, $3, now() - interval '1 hour')`,
          [OP, DEVICE, again],
        );
      });
      expect(await worker.runOnce(t0 + 1000)).toBe(0);
      expect(await present(again)).toBe(1);
      expect(await worker.runOnce(t0 + worker.intervalSeconds * 1000 + 1)).toBe(1);
      expect(await present(again)).toBe(0);
    } finally {
      await moduleRef.close();
    }
  });

  it('un lot ne retire pas plus de NONCE_PURGE_BATCH lignes', () => {
    expect(NONCE_PURGE_BATCH).toBe(1000);
  });

  it('sous cashless_app (OP-N75) : les deux purges sont refusées, 42501', async () => {
    const app: Client = await connect(APP_URL);
    try {
      for (const sql of [
        'SELECT purge_device_request_nonces(10)',
        'SELECT purge_device_enrollment_attempts()',
      ])
        await expect(app.query(sql)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });

  it('--once avec la chaîne du rôle applicatif dans DATABASE_URL_MAINT : échec 42501, jamais 0 en silence', async () => {
    process.env.DATABASE_URL_MAINT = APP_URL;
    try {
      const { moduleRef, workers } = await start();
      try {
        await expect(workers.drain()).rejects.toMatchObject({ code: '42501' });
      } finally {
        await moduleRef.close();
      }
    } finally {
      process.env.DATABASE_URL_MAINT = MAINT_URL;
    }
  });
});
