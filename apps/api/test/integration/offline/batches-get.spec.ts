// Lecture du résultat d'un lot, audit, registre (lot WP18, T075 ; FR-029) et garde de production du processeur.
import { Test } from '@nestjs/testing';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DeviceSeqRegistry } from '../../../src/payments/device-seq-registry';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { OfflineBatchesModule } from '../../../src/offline/batches/offline-batches.module';
import { ownerRows } from '../../support/media-fixtures';
import { purchase, startBatchWorld, type BatchWorld } from '../../support/batches-world';
import type { TestTerminal } from '../../support/test-terminal';

jest.setTimeout(60_000);

describe('lecture du résultat d’un lot', () => {
  let world: BatchWorld;
  const get = (t: TestTerminal, id: string) =>
    t.request(world.api.baseUrl, world.api.tls.serverCaPem, {
      method: 'GET',
      path: `/offline-batches/${id}`,
    });

  beforeAll(async () => {
    world = await startBatchWorld();
  });
  afterAll(async () => {
    await world?.close();
  });
  beforeEach(() => world.fake.reset());

  it('200 terminé, 202 + Retry-After en cours, 404 neutre inconnu ou d’un autre terminal', async () => {
    const t = await world.enrolled();
    const other = await world.enrolled();
    const b = t.buildBatch([purchase(0), purchase(1)], { ledgerId: world.w.ids.ledgerA });
    let open!: () => void;
    world.fake.reset({ gate: new Promise<void>((r) => (open = r)) });
    const sending = t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
    await new Promise((r) => setTimeout(r, 500));
    const id = String(b.header.batch_id);
    const running = await get(t, id);
    expect(running.status).toBe(202);
    expect(running.headers['retry-after']).toBe('2');
    open();
    const sent = await sending;
    const done = await get(t, id);
    expect(done.status).toBe(200);
    expect(JSON.stringify(done.body.results)).toBe(JSON.stringify(sent.body.results));
    const foreign = await get(other, id);
    const unknown = await get(other, '33333333-3333-4333-8333-333333333333');
    expect([foreign.status, unknown.status]).toEqual([404, 404]);
    expect(foreign.text.replace(/"instance":"[^"]*"/, '')).toBe(
      unknown.text.replace(/"instance":"[^"]*"/, ''),
    );
    expect((await get(t, 'pas-un-uuid')).status).toBe(404);
  });

  it('audit : une ligne « reçu » par lot, pas de doublon au renvoi', async () => {
    const t = await world.enrolled();
    const b = t.buildBatch([purchase(0)], { ledgerId: world.w.ids.ledgerA });
    await t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
    const rows = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'OFFLINE_BATCH_RECEIVED' AND object_id = $1`,
      [b.header.batch_id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
    // renvoi : pas de seconde ligne « reçu »
    await t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
    const again = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'OFFLINE_BATCH_RECEIVED' AND object_id = $1`,
      [b.header.batch_id],
    );
    expect(Number(again[0]!.n)).toBe(1);
  });

  it('audit : chaîne rompue refusée, sans valeur reçue ni montant', async () => {
    const t = await world.enrolled();
    const b = t.buildBatch([purchase(0)], {
      ledgerId: world.w.ids.ledgerA,
      alterOp: { index: 0, field: 'amount', value: 123456789 },
    });
    await t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
    const rows = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_log WHERE action = 'OFFLINE_BATCH_REFUSED' AND object_id = $1`,
      [b.header.batch_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after.code).toBe('CHAIN_BROKEN');
    expect(JSON.stringify(rows[0]!.after)).not.toContain('123456789');
  });

  it('registre : lookup rend la ligne du prestataire, rien pour un autre prestataire (isolation)', async () => {
    const t = await world.enrolled();
    const b = t.buildBatch([purchase(0)], { ledgerId: world.w.ids.ledgerA });
    expect((await t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b)).status).toBe(200);
    const registry = new DeviceSeqRegistry(world.api.app.get(TenantTx, { strict: false }));
    const tx = world.api.app.get(TenantTx, { strict: false });
    const own = await tx.run(world.w.ops.a, (c) => registry.lookup(c, t.deviceId, 1n));
    expect(own).toMatchObject({ outcome: 'VOID' });
    const foreign = await tx.run(world.w.ops.b, (c) => registry.lookup(c, t.deviceId, 1n));
    expect(foreign).toBeNull();
  });
});

describe('processeur d’opérations : aucun faux en production', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('le faux processeur fait refuser le démarrage en configuration de production', async () => {
    const { OfflineProcessorGuard } = await import(
      '../../../src/offline/batches/offline-batches.module'
    );
    const { APP_CONFIG } = await import('../../../src/config/config');
    const { OFFLINE_OPERATION_PROCESSOR } = await import(
      '../../../src/offline/batches/batch.types'
    );
    const build = (production: boolean) =>
      Test.createTestingModule({
        providers: [
          OfflineProcessorGuard,
          { provide: APP_CONFIG, useValue: { production } },
          { provide: OFFLINE_OPERATION_PROCESSOR, useValue: { isFake: true, process: jest.fn() } },
        ],
      }).compile();
    await expect(build(true)).rejects.toThrow(FakeInProductionError);
    await expect(build(false)).resolves.toBeDefined();
    void OfflineBatchesModule;
  });
});
