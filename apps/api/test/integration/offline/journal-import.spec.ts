// Import du journal d'un terminal révoqué, côté demande et approbation (mission 7, lot WP20, T084, T086 ; FR-034,
// FR-035 ; R-30.10). Route réelle, deux personnes, lots exportés par `TestTerminal` (non envoyés au serveur).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { sign as cryptoSign } from 'node:crypto';
import canonicalize from 'canonicalize';
import { JournalImportActions } from '../../../src/offline/journal/journal-import.action';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { asOperator } from '../vendors/vendor-fixtures';
import { JournalWorld } from './journal-world';
import type { OfflineTerminal } from './processing-fixtures';

jest.setTimeout(240_000);

describe('import du journal : demande et approbation (WP20)', () => {
  let world: JournalWorld;
  beforeAll(async () => {
    world = await JournalWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  /** Terminal avec un export de 2 lots (2 + 1 ventes), non révoqué. */
  async function exported(options: { batchIds?: string[] } = {}) {
    const s = await world.seller(3);
    const batches = world.exportBatches(
      s.t,
      [
        [
          world.sale(s.t, s.media[0]!, 1000, s.version),
          world.sale(s.t, s.media[1]!, 2500, s.version),
        ],
        [world.sale(s.t, s.media[2]!, 700, s.version)],
      ],
      options,
    );
    return { ...s, batches, bodies: batches.map((b) => b.body) };
  }
  const txCount = (deviceId: string) =>
    ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE device_id = $1',
      [deviceId],
    ).then((r) => r[0]!.n);
  const importsOf = (deviceId: string) =>
    ownerRows<{ id: string; status: string }>(
      'SELECT id, status FROM device_journal_import WHERE device_id = $1',
      [deviceId],
    );

  it('terminal ACTIVE ou SUSPENDED : 409 CONFLICT_STATE, rien créé', async () => {
    const e = await exported();
    const active = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect([active.status, active.body.code]).toEqual([409, 'CONFLICT_STATE']);
    await withOwner((db) => e.t.t.setStatus(db, 'SUSPENDED'));
    const suspended = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect([suspended.status, suspended.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(await importsOf(e.t.t.deviceId)).toHaveLength(0);
  });

  it('signature d’une autre clé, signature P1363, chaîne rompue, opération altérée : refus immédiat, rien créé', async () => {
    const s = await world.seller(1);
    const ledgerId = world.pw.ledgerId;
    const fresh = (options: Record<string, unknown>) => {
      const t = s.t.t;
      const saved = { next: t.nextBatchSeq, tip: t.chainTip };
      const b = t.buildBatch([world.sale(s.t, s.media[0]!, 100, s.version)], {
        ledgerId,
        ...options,
      });
      t.nextBatchSeq = saved.next;
      t.chainTip = saved.tip;
      return b.body;
    };
    await world.revoke(s.t);
    const other = (await import('node:crypto')).generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const cases: Array<[string, Record<string, unknown>, number, string]> = [
      [
        'autre clé',
        { signature: { privateKey: other.privateKey } },
        400,
        'BATCH_SIGNATURE_INVALID',
      ],
      ['P1363', { signature: 'p1363' }, 400, 'BATCH_SIGNATURE_INVALID'],
      ['maillon altéré', { tamperChainHashAt: 0 }, 409, 'CHAIN_BROKEN'],
      [
        'opération altérée',
        { alterOp: { index: 0, field: 'amount', value: 999_999 } },
        409,
        'CHAIN_BROKEN',
      ],
      ['dernière empreinte', { tamperLastChainHash: true }, 409, 'CHAIN_BROKEN'],
    ];
    for (const [label, options, status, code] of cases) {
      const res = await world.requestImport(world.sup1, s.t.t.deviceId, [fresh(options)]);
      expect([label, res.status, res.body.code]).toEqual([label, status, code]);
    }
    expect(await importsOf(s.t.t.deviceId)).toHaveLength(0);
    void cryptoSign;
  });

  it('numéro au-delà de 2^53 - 1 dans un lot, lots en double, 0 ou 21 lots, champ inconnu, motif court : refusés', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const raw = JSON.stringify({
      batches: e.bodies,
      reason: 'Import du journal après perte',
    }).replace(/"seq_from":(\d+)/, '"seq_from":9007199254740993');
    const big = await world.bo(
      'POST',
      `/devices/${e.t.t.deviceId}/journal-imports`,
      world.sup1,
      raw,
    );
    expect([big.status, big.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const dup = await world.requestImport(world.sup1, e.t.t.deviceId, [e.bodies[0], e.bodies[0]]);
    expect(dup.status).toBe(400);
    expect((await world.requestImport(world.sup1, e.t.t.deviceId, [])).status).toBe(400);
    expect(
      (await world.requestImport(world.sup1, e.t.t.deviceId, Array(21).fill(e.bodies[0]))).status,
    ).toBe(400);
    const extra = await world.bo('POST', `/devices/${e.t.t.deviceId}/journal-imports`, world.sup1, {
      batches: e.bodies,
      reason: 'Import du journal après perte',
      operator_id: randomUUID(),
    });
    expect(extra.status).toBe(422);
    expect((await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies, 'court')).status).toBe(
      422,
    );
    expect(await importsOf(e.t.t.deviceId)).toHaveLength(0);
  });

  it('corps de plus de 21 Mio : 413 BATCH_TOO_LARGE avant tout JSON.parse', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const huge = `{"reason":"${'x'.repeat(22 * 1_048_576)}"}`;
    const res = await world.bo(
      'POST',
      `/devices/${e.t.t.deviceId}/journal-imports`,
      world.sup1,
      huge,
    );
    expect([res.status, res.body.code]).toEqual([413, 'BATCH_TOO_LARGE']);
  });

  it('demande : 202, synthèse et empreinte dans la charge utile, import PENDING, lots stockés en minuscules, audit', async () => {
    const upper = [randomUUID().toUpperCase(), randomUUID()];
    const e = await exported({ batchIds: upper });
    await world.revoke(e.t);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(res.status).toBe(202);
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    const row = await world.requestRow(res.body.approval_request_id);
    const imp = await world.importRow(row.target_id);
    expect(imp).toMatchObject({
      status: 'PENDING',
      requested_by: world.sup1.userId,
      approved_by: null,
    });
    const [stored] = await ownerRows<{ batches: Array<{ batch_id: string }>; sha: string }>(
      `SELECT batches, encode(batches_sha256, 'hex') AS sha FROM device_journal_import WHERE id = $1`,
      [row.target_id],
    );
    expect(stored!.batches.map((b) => b.batch_id)).toEqual(upper.map((u) => u.toLowerCase()));
    expect(stored!.sha).toBe(JournalWorld.sha(stored!.batches));
    expect(row.payload).toMatchObject({
      import_id: row.target_id,
      device_id: e.t.t.deviceId,
      batches_sha256: stored!.sha,
      scope_type: 'EVENT',
      scope_id: world.w.ids.eventA,
      summary: {
        batch_count: 2,
        operation_count: 3,
        sales_total: '4200',
        seq_min: 1,
        seq_max: 3,
      },
    });
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'DEVICE_JOURNAL_IMPORT_REQUESTED' AND object_id = $1`,
        [row.target_id],
      ),
    ).toHaveLength(1);
    expect(await txCount(e.t.t.deviceId)).toBe(0);
    // Un second import est refusé tant que le premier est actif.
    const second = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(second.status).toBe(409);
  });

  it('droits : même personne refusée, CASHIER 403, sans jeton 401, autre prestataire 404 (demande et approbation)', async () => {
    const e = await exported();
    await world.revoke(e.t);
    for (const who of [world.w.cashierA, world.w.operatorAdminA])
      expect((await world.requestImport(who, e.t.t.deviceId, e.bodies)).status).toBe(403);
    const anonymous = await world.bo(
      'POST',
      `/devices/${e.t.t.deviceId}/journal-imports`,
      world.sup1,
      { batches: e.bodies, reason: 'Import du journal après perte' },
      randomUUID(),
      { authorization: '' },
    );
    expect(anonymous.status).toBe(401);
    expect((await world.requestImport(world.supForeign, e.t.t.deviceId, e.bodies)).status).toBe(
      404,
    );
    expect(await importsOf(e.t.t.deviceId)).toHaveLength(0);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    expect(res.status).toBe(202);
    const id = res.body.approval_request_id;
    expect((await world.approve(id, world.sup1)).status).toBe(409);
    // Approbateur d'un autre prestataire : refusé par le service d'approbation, import inchangé.
    expect([403, 404]).toContain((await world.approve(id, world.supForeign)).status);
    const imp = await world.importRow((await world.requestRow(id)).target_id);
    expect(imp).toMatchObject({ status: 'PENDING', approved_by: null });
    // Défense en profondeur : l'action elle-même refuse un approbateur étranger ou identique au demandeur.
    const actions = world.api.app.get(JournalImportActions, { strict: false });
    const tx = world.api.app.get((await import('../../../src/db/tenant-tx')).TenantTx, {
      strict: false,
    });
    await tx.run(world.w.ops.a, async (client) => {
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, world.supForeign.userId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, world.sup1.userId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, world.w.cashierA.userId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        actions.assertApprover(client, world.w.ops.a, world.sup1.userId, world.sup2.userId),
      ).resolves.toBeUndefined();
    });
  });

  it('approbation : PROCESSING rendu, approbateur posé ; deux approbations parallèles : une seule application', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    const id = res.body.approval_request_id;
    const [a, b] = await Promise.all([
      world.approve(id, world.sup2),
      world.approve(id, world.sup3),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = a.status === 200 ? a : b;
    expect(ok.body.status).toBe('EXECUTED');
    expect(contractViolations('DeviceJournalImportResult', ok.body.result)).toEqual([]);
    expect(ok.body.result).toMatchObject({
      device_id: e.t.t.deviceId,
      status: 'PROCESSING',
      results: [],
    });
    const imp = await world.importRow((await world.requestRow(id)).target_id);
    expect(imp?.approved_by).toBe(a.status === 200 ? world.sup2.userId : world.sup3.userId);
    expect(['PROCESSING', 'APPLIED']).toContain(imp?.status);
    await world.runUntilFinal(imp!.id);
  });

  it('empreinte altérée : la demande et l’import figés sont immuables, begin_ refuse une autre empreinte (CL053)', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    const id = res.body.approval_request_id;
    // La charge utile de la demande est immuable (garde de la base).
    await expect(
      withOwner((db) =>
        db.query(
          `UPDATE approval_request SET payload = jsonb_set(payload, '{batches_sha256}', to_jsonb(repeat('ab', 32))) WHERE id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow();
    const importId = (await world.requestRow(id)).target_id;
    // Une empreinte différente de celle de l'import : CL053, l'import reste PENDING.
    await expect(
      withOwner((db) =>
        asOperator(db, world.w.ops.a, () =>
          db.query('SELECT * FROM begin_device_journal_import($1, $2, $3)', [
            importId,
            Buffer.alloc(32, 7),
            world.sup2.userId,
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code: 'CL053' });
    expect((await world.importRow(importId))?.status).toBe('PENDING');
    expect(await txCount(e.t.t.deviceId)).toBe(0);
  });

  it('lot du terminal récent encore PROCESSING : 409 BATCH_IN_PROGRESS à la demande', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const batchId = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes,
                                    prev_chain_hash, last_chain_hash, signature, chain_status)
         VALUES ($1, $2, $3, $4, 100, 100, ARRAY[decode(repeat('01', 32), 'hex')],
                 decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'), '\\x00', 'PENDING')`,
        [batchId, world.w.ops.a, e.t.t.deviceId, world.pw.ledgerId],
      ),
    );
    try {
      const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
      expect([res.status, res.body.code]).toEqual([409, 'BATCH_IN_PROGRESS']);
    } finally {
      await withOwner((db) =>
        db.query(
          `UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED' WHERE id = $1`,
          [batchId],
        ),
      );
    }
  });

  it('lecture : 404 neutre (autre terminal, autre prestataire, import inconnu, PENDING) ; ORGANIZER_ADMIN et SUPERVISOR lisent', async () => {
    const e = await exported();
    await world.revoke(e.t);
    const res = await world.requestImport(world.sup1, e.t.t.deviceId, e.bodies);
    const importId = (await world.requestRow(res.body.approval_request_id)).target_id;
    const path = (d: string, i: string) => `/devices/${d}/journal-imports/${i}`;
    expect((await world.bo('GET', path(e.t.t.deviceId, importId), world.sup1)).status).toBe(404);
    await world.approve(res.body.approval_request_id, world.sup2);
    for (const who of [world.sup1, world.w.organizerAdminA]) {
      const read = await world.bo('GET', path(e.t.t.deviceId, importId), who);
      expect(read.status).toBe(200);
      expect(contractViolations('DeviceJournalImportResult', read.body)).toEqual([]);
      expect(['PROCESSING', 'APPLIED']).toContain(read.body.status);
    }
    expect((await world.bo('GET', path(e.t.t.deviceId, importId), world.supForeign)).status).toBe(
      404,
    );
    expect((await world.bo('GET', path(e.t.t.deviceId, randomUUID()), world.sup1)).status).toBe(
      404,
    );
    expect((await world.bo('GET', path(randomUUID(), importId), world.sup1)).status).toBe(404);
    expect((await world.bo('GET', path(e.t.t.deviceId, importId), world.w.cashierA)).status).toBe(
      403,
    );
    await world.runUntilFinal(importId);
    void canonicalize;
    void (null as unknown as OfflineTerminal);
  });
});
