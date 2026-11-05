// Travailleur `journal-import` (mission 7, lot WP20, T085, T086 ; FR-034, FR-035 ; R-30.10) : canal IMPORT de bout en
// bout à travers le VRAI processeur de WP19, reprise après coupure, rejeu, isolation. Le travailleur traite toute la
// base : ces tests ne regardent que leurs propres terminaux et attendent la fin de LEUR import (un autre travailleur
// peut le prendre en parallèle).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TenantTx } from '../../../src/db/tenant-tx';
import {
  OFFLINE_OPERATION_PROCESSOR,
  type BatchContext,
  type OfflineOperationProcessor,
  type ParsedOperation,
} from '../../../src/offline/batches/batch.types';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { asOperator } from '../vendors/vendor-fixtures';
import { JournalWorld } from './journal-world';
import type { OfflineTerminal } from './processing-fixtures';

jest.setTimeout(240_000);

describe('travailleur journal-import (WP20)', () => {
  let world: JournalWorld;
  beforeAll(async () => {
    world = await JournalWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  const txs = (deviceId: string) =>
    ownerRows<{
      id: string;
      source: string;
      approved_by: string | null;
      created_by: string | null;
    }>(
      `SELECT id, source, approved_by, created_by FROM journal_transaction
        WHERE device_id = $1 AND type = 'PURCHASE' ORDER BY recorded_at`,
      [deviceId],
    );
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Demande + approbation d'un export ; rend l'import et la demande. */
  async function submitImport(t: OfflineTerminal, bodies: unknown[]) {
    const res = await world.requestImport(world.sup1, t.t.deviceId, bodies);
    expect(res.status).toBe(202);
    const requestId = res.body.approval_request_id as string;
    const importId = (await world.requestRow(requestId)).target_id;
    return { requestId, importId };
  }
  const approve = async (requestId: string) => {
    const res = await world.approve(requestId, world.sup2);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXECUTED');
  };

  it('2 lots appliqués : soldes exacts, valideur = approbateur, canal IMPORT, opération postérieure à la révocation rejetée', async () => {
    const s = await world.seller(3, 20_000);
    const [m0, m1, m2] = s.media;
    const first = world.exportBatches(s.t, [
      [world.sale(s.t, m0!, 1000, s.version, 1), world.sale(s.t, m1!, 2500, s.version, 1)],
    ]);
    await sleep(1200);
    await world.revoke(s.t);
    await sleep(1200);
    // Datée après la révocation : rejetée ; l'autre vente du même lot est appliquée.
    const second = world.exportBatches(s.t, [
      [world.sale(s.t, m2!, 700, s.version, 0), world.sale(s.t, m2!, 300, s.version, 0)],
    ]);
    const bodies = [...first, ...second].map((b) => b.body);
    const { requestId, importId } = await submitImport(s.t, bodies);
    await approve(requestId);
    const final = await world.runUntilFinal(importId);
    expect(final.result?.reason ?? 'ok').toBe('ok');
    expect(final.status).toBe('APPLIED');
    expect(final.approved_by).toBe(world.sup2.userId);

    const written = await txs(s.t.t.deviceId);
    const rejected = await ownerRows<{ seq: string; outcome: string }>(
      `SELECT seq::text, outcome FROM device_seq_registry WHERE device_id = $1 ORDER BY seq`,
      [s.t.t.deviceId],
    );
    expect(rejected).toHaveLength(4);
    // Les ventes d'avant la révocation sont écrites (OFFLINE_SYNC), validées par l'approbateur.
    expect(written.length).toBeGreaterThanOrEqual(2);
    for (const tx of written) {
      expect(tx.source).toBe('OFFLINE_SYNC');
      expect(tx.approved_by).toBe(world.sup2.userId);
    }
    expect(await world.pw.spendable(m0!.walletId)).toBe(19_000);
    expect(await world.pw.spendable(m1!.walletId)).toBe(17_500);
    // Postérieure à la révocation : aucune écriture, anomalie NON_COMPLIANT_OPERATION.
    expect(await world.pw.spendable(m2!.walletId)).toBe(20_000);
    expect(await world.pw.anomalies(s.t.t.deviceId, 'NON_COMPLIANT_OPERATION')).not.toHaveLength(0);
    const lateResults = await ownerRows<{ result: Record<string, unknown> }>(
      `SELECT result FROM offline_op_result WHERE batch_id = $1 ORDER BY seq`,
      [second[0]!.header.batch_id],
    );
    expect(lateResults.map((r) => [r.result.status, r.result.reject_reason])).toEqual([
      ['REJECTED', 'OFFLINE_NOT_ALLOWED'],
      ['REJECTED', 'OFFLINE_NOT_ALLOWED'],
    ]);
    const batches = await ownerRows<{
      id: string;
      received_via: string;
      import_id: string;
      status: string;
      operator_id: string;
    }>(
      'SELECT id, received_via, import_id, status, operator_id FROM offline_batch WHERE device_id = $1',
      [s.t.t.deviceId],
    );
    expect(batches).toHaveLength(2);
    for (const b of batches)
      expect(b).toMatchObject({
        received_via: 'IMPORT',
        import_id: importId,
        status: 'COMPLETED',
        operator_id: world.w.ops.a,
      });
    // Lecture : APPLIED avec un résultat par lot, conforme au contrat.
    const read = await world.bo(
      'GET',
      `/devices/${s.t.t.deviceId}/journal-imports/${importId}`,
      world.sup3,
    );
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('APPLIED');
    expect(contractViolations('DeviceJournalImportResult', read.body)).toEqual([]);
    expect((read.body.results as unknown[]).length).toBe(2);
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'DEVICE_JOURNAL_IMPORTED' AND object_id = $1`,
        [importId],
      ),
    ).toHaveLength(1);

    // Import rejoué après APPLIED : la base refuse (CL053), même export redemandé : rien n'est réécrit.
    await expect(
      withOwner((db) =>
        asOperator(db, world.w.ops.a, () =>
          db.query(
            `SELECT * FROM begin_device_journal_import($1, (SELECT batches_sha256 FROM device_journal_import WHERE id = $1), $2)`,
            [importId, world.sup2.userId],
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'CL053' });
    const before = (await txs(s.t.t.deviceId)).length;
    const again = await submitImport(s.t, bodies);
    await approve(again.requestId);
    const replay = await world.runUntilFinal(again.importId);
    expect(replay.status).toBe('APPLIED');
    expect((await txs(s.t.t.deviceId)).length).toBe(before);
    expect(await world.pw.spendable(m0!.walletId)).toBe(19_000);
  });

  it('coupure après 3 opérations sur 10 : au redémarrage 7 opérations, aucun doublon d’écriture', async () => {
    const s = await world.seller(1, 100_000);
    const ops = Array.from({ length: 10 }, (_, i) =>
      world.sale(s.t, s.media[0]!, 100 + i, s.version, 1),
    );
    const [batch] = world.exportBatches(s.t, [ops]);
    await sleep(1200);
    await world.revoke(s.t);
    const { requestId, importId } = await submitImport(s.t, [batch!.body]);
    await approve(requestId);
    const processor = world.api.app.get<OfflineOperationProcessor>(OFFLINE_OPERATION_PROCESSOR, {
      strict: false,
    });
    const original = processor.process.bind(processor);
    let calls = 0;
    const spy = jest
      .spyOn(processor, 'process')
      .mockImplementation(async (ctx: BatchContext, op: ParsedOperation) => {
        if (ctx.importId === importId) {
          calls += 1;
          if (calls > 3) throw new Error('coupure simulée');
        }
        return original(ctx, op);
      });
    try {
      for (let i = 0; i < 20 && calls <= 3; i += 1) {
        await world.worker.runOnce();
        if ((await world.importRow(importId))?.status === 'APPLIED') break;
      }
    } finally {
      spy.mockRestore();
    }
    const mid = await world.importRow(importId);
    if (mid?.status === 'PROCESSING') {
      expect(
        (
          await ownerRows<{ n: number }>(
            'SELECT count(*)::int AS n FROM device_seq_registry WHERE device_id = $1',
            [s.t.t.deviceId],
          )
        )[0]!.n,
      ).toBe(3);
    }
    const final = await world.runUntilFinal(importId);
    expect(final.status).toBe('APPLIED');
    const registry = await ownerRows<{ seq: string; transaction_id: string | null }>(
      'SELECT seq::text, transaction_id FROM device_seq_registry WHERE device_id = $1 ORDER BY device_seq_registry.seq',
      [s.t.t.deviceId],
    );
    expect(registry.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    const written = await txs(s.t.t.deviceId);
    expect(written).toHaveLength(10);
    expect(new Set(written.map((t) => t.id)).size).toBe(10);
    // 100 + 101 + ... + 109 = 1045 débités, une seule fois.
    expect(await world.pw.spendable(s.media[0]!.walletId)).toBe(100_000 - 1045);
  });

  it('canal IMPORT sans approbateur : le processeur lève (jamais d’écriture sans valideur)', async () => {
    const s = await world.seller(1);
    const [batch] = world.exportBatches(s.t, [[world.sale(s.t, s.media[0]!, 500, s.version)]]);
    await world.revoke(s.t);
    const { importId } = await submitImport(s.t, [batch!.body]);
    // Import PENDING : pas d'approbateur.
    const processor = world.api.app.get<OfflineOperationProcessor>(OFFLINE_OPERATION_PROCESSOR, {
      strict: false,
    });
    const op = batch!.body.operations[0]!;
    const ctx: BatchContext = {
      batchId: String(batch!.header.batch_id),
      deviceId: s.t.t.deviceId,
      operatorId: world.w.ops.a,
      ledgerId: world.pw.ledgerId,
      serial: s.t.t.serial,
      receivedAt: new Date(),
      receivedVia: 'IMPORT',
      importId,
      authorityEpoch: 0,
      inversions: [],
    };
    await expect(
      processor.process(ctx, {
        seq: BigInt(op.seq as number),
        raw: op,
        type: 'PURCHASE',
        contentSha256: Buffer.alloc(32),
      }),
    ).rejects.toThrow();
    expect(await txs(s.t.t.deviceId)).toHaveLength(0);
  });

  it('isolation : un autre prestataire ne lit ni n’approuve l’import, les lignes écrites sont du prestataire du terminal', async () => {
    const s = await world.seller(1);
    const [batch] = world.exportBatches(s.t, [[world.sale(s.t, s.media[0]!, 500, s.version)]]);
    await world.revoke(s.t);
    const { requestId, importId } = await submitImport(s.t, [batch!.body]);
    expect([403, 404]).toContain((await world.approve(requestId, world.supForeign)).status);
    await approve(requestId);
    await world.runUntilFinal(importId);
    const foreignRead = await world.bo(
      'GET',
      `/devices/${s.t.t.deviceId}/journal-imports/${importId}`,
      world.supForeign,
    );
    expect(foreignRead.status).toBe(404);
    // La fonction de lecture refuse la session d'un autre prestataire.
    const tx = world.api.app.get(TenantTx, { strict: false });
    await expect(
      tx.run(world.w.ops.b, (client) =>
        client.query('SELECT * FROM device_journal_import_view($1, false)', [importId]),
      ),
    ).rejects.toBeTruthy();
    const foreign = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM offline_batch WHERE device_id = $1 AND operator_id <> $2`,
      [s.t.t.deviceId, world.w.ops.a],
    );
    expect(foreign[0]!.n).toBe(0);
    void randomUUID;
  });
});
