// Contrôles d'entrée d'un lot (lot WP18, T073, T076) : un cas par contrôle, dans l'ordre du contrat.
import { createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import vectors from '../../fixtures/offline-vectors/vectors.json';
import { chainedContent, contentSha256 } from '@cashless/shared-rules';
import {
  buildJournal,
  chainHash,
  chainGenesis,
  testContentSha256,
  type TerminalResponse,
  type TestTerminal,
} from '../../support/test-terminal';
import { ownerRows } from '../../support/media-fixtures';
import { batchRow, purchase, startBatchWorld, type BatchWorld } from '../../support/batches-world';

describe('contrôles d’entrée des lots', () => {
  let world: BatchWorld;
  let t: TestTerminal;
  const ops = (n = 3) => Array.from({ length: n }, (_, i) => purchase(i));
  const send = (
    batch: { body: unknown; header: Record<string, unknown> },
    opts: Parameters<TestTerminal['submitBatch']>[3] = {},
    who: TestTerminal = t,
  ): Promise<TerminalResponse> =>
    who.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, batch, opts);
  const build = (o: Partial<Parameters<TestTerminal['buildBatch']>[1]> = {}, n = 3) =>
    t.buildBatch(ops(n), { ledgerId: world.w.ids.ledgerA, ...o });

  beforeAll(async () => {
    world = await startBatchWorld();
  });
  afterAll(async () => {
    await world?.close();
  });
  beforeEach(async () => {
    world.fake.reset();
    t = await world.enrolled();
  });

  it('TestTerminal : la chaîne s’accorde avec vectors.json, et avec chainedContent', () => {
    const v = vectors as unknown as {
      ops: Array<{ op: Record<string, unknown>; content_sha256: string }>;
      chain: { chain_hash_0: string; device_id: string; links: Array<{ chain_hash: string }> };
    };
    expect(chainGenesis(v.chain.device_id).toString('hex')).toBe(v.chain.chain_hash_0);
    for (const o of v.ops) {
      expect(testContentSha256(o.op).toString('hex')).toBe(o.content_sha256);
      expect(contentSha256(chainedContent(o.op)).toString('hex')).toBe(o.content_sha256);
    }
    const chained = v.chain.links.map(
      (l) =>
        v.ops.find(
          (o) => o.content_sha256 === (l as unknown as { content_sha256: string }).content_sha256,
        )!,
    );
    let chain = chainGenesis(v.chain.device_id);
    const hashes = chained.map((o) => {
      chain = chainHash(chain, testContentSha256(o.op));
      return chain.toString('hex');
    });
    expect(hashes).toEqual(v.chain.links.map((l) => l.chain_hash));
    expect(
      buildJournal([purchase(0)], { fromSeq: 1, prev: chainGenesis(t.deviceId) }).last,
    ).toEqual(chainHash(chainGenesis(t.deviceId), testContentSha256({ ...purchase(0), seq: 1 })));
  });

  it('un lot construit par TestTerminal est accepté (200)', async () => {
    const b = build();
    const res = await send(b);
    expect(res.status).toBe(200);
    expect(res.body.contiguous_acked_seq).toBe(3);
    expect((await batchRow(String(b.header.batch_id)))?.status).toBe('COMPLETED');
  });

  it('1 : corps de 1 048 577 octets -> 413 BATCH_TOO_LARGE', async () => {
    const b = build();
    const res = await send({
      header: b.header,
      body: { ...b.body, pad: 'x'.repeat(1_048_577) },
    });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('BATCH_TOO_LARGE');
  });

  it('2 : numéro > 2^53-1 -> 400 avec pointeur, aucune ligne écrite', async () => {
    const b = build();
    const text = JSON.stringify(b.body).replace(
      `"seq_to":${b.header.seq_to}`,
      '"seq_to":9007199254740993',
    );
    const res = await send({ header: b.header, body: text as never });
    // le corps JSON.stringify d'une chaîne serait entre guillemets : on passe par sentBody
    expect(res.status).toBeGreaterThanOrEqual(400);
    const raw = await t.request(
      world.api.baseUrl,
      world.api.tls.serverCaPem,
      {
        method: 'POST',
        path: '/offline-batches',
        body: b.body,
        idempotencyKey: String(b.header.batch_id),
      },
      { sentBody: text, headers: { 'X-Authority-Epoch': '0' } },
    );
    expect(raw.status).toBeGreaterThanOrEqual(400);
    expect(await batchRow(String(b.header.batch_id))).toBeUndefined();
  });

  it('3 : lot vide -> 400 ; 501 opérations -> 413 ; type inconnu -> 400', async () => {
    const empty = build({}, 1);
    const bodyEmpty = { ...empty.body, operations: [] };
    expect((await send({ header: empty.header, body: bodyEmpty })).status).toBe(400);
    const big = t.buildBatch(ops(501), { ledgerId: world.w.ids.ledgerA });
    const resBig = await send(big);
    expect(resBig.status).toBe(413);
    const odd = t.buildBatch([{ type: 'ACTIVATION', occurred_at: new Date().toISOString() }], {
      ledgerId: world.w.ids.ledgerA,
    });
    const resOdd = await send(odd);
    expect(resOdd.status).toBe(400);
  });

  it('4 : Idempotency-Key, série, grand livre, X-Authority-Epoch', async () => {
    const a = build();
    expect((await send(a, { idempotencyKey: '11111111-1111-4111-8111-111111111111' })).status).toBe(
      400,
    );
    const b = build({ serial: 'AUTRE' });
    expect((await send(b)).status).toBe(400);
    const c = build({ ledgerId: '22222222-2222-4222-8222-222222222222' });
    expect((await send(c)).status).toBe(400);
    const d = build();
    expect((await send(d, { epochHeader: '3' })).status).toBe(400);
    expect((await send(d, { epochHeader: null })).status).toBe(422);
  });

  it('5 : époque périmée -> 409 STALE_AUTHORITY_EPOCH ; supérieure -> 400', async () => {
    await ownerRows('UPDATE ledger SET authority_epoch = 2 WHERE id = $1', [world.w.ids.ledgerA]);
    try {
      const old = await send(build({ epoch: 1 }));
      expect(old.status).toBe(409);
      expect(old.body.code).toBe('STALE_AUTHORITY_EPOCH');
      expect(old.body.authority_epoch).toBe(2);
      expect((await send(build({ epoch: 3 }))).status).toBe(400);
    } finally {
      await ownerRows('UPDATE ledger SET authority_epoch = 0 WHERE id = $1', [world.w.ids.ledgerA]);
    }
  });

  it('6 : signature d’un autre en-tête, d’une autre clé, P1363, absente -> 400 BATCH_SIGNATURE_INVALID', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    for (const signature of [
      'other-header',
      'p1363',
      'none',
      { privateKey: other.privateKey },
    ] as const) {
      const b = build({ signature });
      const res = await send(b);
      expect([signature, res.status, res.body.code]).toEqual([
        signature,
        400,
        'BATCH_SIGNATURE_INVALID',
      ]);
      expect(await batchRow(String(b.header.batch_id))).toBeUndefined();
      t.nextBatchSeq = 1;
      t.chainTip = null;
    }
    void createPublicKey;
    const audits = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'OFFLINE_BATCH_REFUSED'
        AND after->>'code' = 'BATCH_SIGNATURE_INVALID'`,
    );
    expect(Number(audits[0]!.n)).toBeGreaterThanOrEqual(4);
  });

  it('7 : numéros non continus -> 400 SEQ_OUT_OF_ORDER', async () => {
    const res = await send(build({ skipSeqAt: 1 }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEQ_OUT_OF_ORDER');
  });

  it('8 : empreinte altérée (signature valide) -> 409 CHAIN_BROKEN, lot REJECTED, anomalie', async () => {
    const b = build({ alterOp: { index: 1, field: 'amount', value: 999 } });
    const res = await send(b);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHAIN_BROKEN');
    const row = await batchRow(String(b.header.batch_id));
    expect(row).toEqual({ status: 'REJECTED', reject_reason: 'CHAIN_BROKEN' });
    const an = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM anomaly WHERE device_id = $1 AND kind = 'CHAIN_BROKEN'`,
      [t.deviceId],
    );
    expect(Number(an[0]!.n)).toBe(1);
    const again = await send(b);
    expect([again.status, again.body.code]).toEqual([409, 'CHAIN_BROKEN']);
    expect(world.fake.calls).toHaveLength(0);
  });

  it('8 : chain_hash déclaré faux, ou last_chain_hash faux -> CHAIN_BROKEN', async () => {
    expect((await send(build({ tamperChainHashAt: 1 }))).body.code).toBe('CHAIN_BROKEN');
    t = await world.enrolled();
    expect((await send(build({ tamperLastChainHash: true }))).body.code).toBe('CHAIN_BROKEN');
  });

  it('9 : autorité EDGE -> 409 DEBIT_AUTHORITY_EDGE', async () => {
    await ownerRows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [
      world.w.ids.ledgerA,
    ]);
    try {
      const res = await send(build());
      expect([res.status, res.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);
    } finally {
      await ownerRows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [
        world.w.ids.ledgerA,
      ]);
    }
  });

  it('ordre : un lot cumulant époque périmée et signature fausse rapporte l’époque (5 avant 6)', async () => {
    await ownerRows('UPDATE ledger SET authority_epoch = 2 WHERE id = $1', [world.w.ids.ledgerA]);
    try {
      const res = await send(build({ epoch: 1, signature: 'p1363' }));
      expect(res.body.code).toBe('STALE_AUTHORITY_EPOCH');
      const res2 = await send(build({ signature: 'p1363', skipSeqAt: 1, epoch: 2 }));
      expect(res2.body.code).toBe('BATCH_SIGNATURE_INVALID');
    } finally {
      await ownerRows('UPDATE ledger SET authority_epoch = 0 WHERE id = $1', [world.w.ids.ledgerA]);
    }
  });

  it('10 : borne CL021 -> 409 SEQ_OUT_OF_RANGE', async () => {
    const res = await send(build({ fromSeq: 5_000_000, prev: chainGenesis(t.deviceId) }));
    expect([res.status, res.body.code]).toEqual([409, 'SEQ_OUT_OF_RANGE']);
  });

  it('terminal suspendu : lot admis ; révoqué : 403 DEVICE_REVOKED', async () => {
    const s = await world.enrolled();
    await ownerRows(`SELECT 1`);
    const { withOwner } = await import('../../support/db');
    await withOwner((db) => s.setStatus(db, 'SUSPENDED'));
    const res = await send(s.buildBatch(ops(), { ledgerId: world.w.ids.ledgerA }), {}, s);
    expect(res.status).toBe(200);
    await withOwner((db) => s.setStatus(db, 'REVOKED'));
    const rev = await send(s.buildBatch(ops(), { ledgerId: world.w.ids.ledgerA }), {}, s);
    expect([rev.status, rev.body.code]).toEqual([403, 'DEVICE_REVOKED']);
  });

  it('batch_id en majuscules : normalisé, un seul lot', async () => {
    const id = randomUUID().toUpperCase();
    const b = build({ batchId: id });
    const res = await send(b);
    expect(res.body.code).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body.batch_id).toBe(id.toLowerCase());
  });
});
