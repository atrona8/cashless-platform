// WP13, T056 : alertes de trous de numérotation et de numéros RETRY à 24 h ; une seule alerte, aucune action.
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { WorkerRegistry } from '../../../src/processes/worker';
import { SeqGapAgeWorker } from '../../../src/snapshots-signer/seq-gap-age.worker';
import { OWNER_URL } from '../../support/db';
import { harness, newWorld, seedGap, seedOperators, seedRetry, type Harness } from './support';

jest.setTimeout(120_000);

describe('seq-gap-age', () => {
  let owner: Pool;
  let h: Harness;
  let warn: jest.SpyInstance;

  const alerts = () => warn.mock.calls.map((call) => JSON.parse(call[0] as string));

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL, max: 3 });
    await seedOperators(owner);
  });
  afterAll(async () => {
    await owner.end();
  });
  beforeEach(async () => {
    // Les trous et RETRY laissés par les passages précédents sont marqués avant chaque test.
    h = harness('fake-kms:ecc:unused');
    await h.gaps.runOnce();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    warn.mockRestore();
    await h.close();
  });

  it('trou de 25 h : une alerte, puis aucune au passage suivant ; alarme 2', async () => {
    const world = await newWorld(owner);
    const gap = await seedGap(owner, world, 7, 25);
    expect(await h.gaps.runOnce()).toBe(1);
    expect(alerts()).toEqual([
      expect.objectContaining({
        event: 'SEQ_GAP_OPEN_24H',
        operator_id: world.operatorId,
        device_id: gap.deviceId,
        seq: '7',
      }),
    ]);
    expect(h.gaps.alarm()).toBe(2);
    expect(await h.gaps.runOnce()).toBe(0);
    expect(alerts()).toHaveLength(1);
    const marked = await owner.query('SELECT detail FROM anomaly WHERE id = $1', [gap.anomalyId]);
    expect(marked.rows[0].detail.alerted_at).toBeTruthy();
  });

  it('trou de 23 h : rien', async () => {
    const world = await newWorld(owner);
    await seedGap(owner, world, 8, 23);
    expect(await h.gaps.runOnce()).toBe(0);
    expect(alerts()).toEqual([]);
    expect(h.gaps.alarm()).toBe(0);
  });

  it('relance du processus (nouvelle instance) : toujours une seule alerte', async () => {
    const world = await newWorld(owner);
    await seedGap(owner, world, 9, 26);
    expect(await h.gaps.runOnce()).toBe(1);
    const again = harness('fake-kms:ecc:unused');
    try {
      expect(await again.gaps.runOnce()).toBe(0);
    } finally {
      await again.close();
    }
    expect(alerts()).toHaveLength(1);
  });

  it('numéro RETRY non renvoyé depuis 25 h : une alerte, marqué', async () => {
    const world = await newWorld(owner);
    const retry = await seedRetry(owner, world, 25);
    expect(await h.gaps.runOnce()).toBe(1);
    expect(alerts()).toEqual([
      expect.objectContaining({
        event: 'RETRY_NOT_RESENT_24H',
        device_id: retry.deviceId,
        seq: '1',
      }),
    ]);
    const row = await owner.query(
      'SELECT alerted_at FROM offline_batch_retry WHERE batch_id = $1',
      [retry.batchId],
    );
    expect(row.rows[0].alerted_at).not.toBeNull();
    expect(await h.gaps.runOnce()).toBe(0);
    expect(alerts()).toHaveLength(1);
  });

  it('--list décrit les alertes dues sans rien marquer', async () => {
    const world = await newWorld(owner);
    const gap = await seedGap(owner, world, 10, 30);
    const lines = await h.gaps.describe();
    expect(lines.some((line) => line.includes(gap.anomalyId))).toBe(true);
    expect(alerts()).toEqual([]);
    const row = await owner.query('SELECT detail FROM anomaly WHERE id = $1', [gap.anomalyId]);
    expect(row.rows[0].detail?.alerted_at).toBeUndefined();
    expect(h.gaps.alarm()).toBe(0);
  });

  it('aucune action automatique : seules les quatre fonctions d’alerte sont appelées', async () => {
    const world = await newWorld(owner);
    const gap = await seedGap(owner, world, 11, 40);
    await seedRetry(owner, world, 40);
    const called: string[] = [];
    const spied = new Proxy(h.repository, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          called.push(String(property));
          return value.apply(target, args);
        };
      },
    });
    const worker = new SeqGapAgeWorker(new WorkerRegistry(), spied);
    const before = await owner.query('SELECT status FROM device WHERE id = $1', [gap.deviceId]);
    expect(await worker.runOnce()).toBe(2);
    expect(new Set(called)).toEqual(
      new Set(['seqGapsToAlert', 'markSeqGapAlerted', 'retriesToAlert', 'markRetryAlerted']),
    );
    const after = await owner.query('SELECT status FROM device WHERE id = $1', [gap.deviceId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const anomaly = await owner.query('SELECT status FROM anomaly WHERE id = $1', [gap.anomalyId]);
    expect(anomaly.rows[0].status).toBe('OPEN');
  });
});
