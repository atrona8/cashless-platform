// Lots de terminal relayés (WP13, T061) : signature d'origine, chaîne du terminal, terminal d'un
// autre événement,
// `device_batch_id` absent, TOPUP_CASH relayé rejeté, un seul effet.
import { createHash, randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { chainedContent, chainStep, contentSha256 } from '@cashless/shared-rules';
import type { Client } from 'pg';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  iso,
  makeBatch,
  makeOp,
  newSigner,
  openOwner,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Signer,
  type Site,
  type SyncEdge,
} from './sync-support';
import type { Loose } from '../../../support/loose';

jest.setTimeout(120_000);

interface Relayed {
  ops: Array<Record<string, unknown>>;
  deviceBatch: { header: Record<string, unknown>; signature: string };
  batchId: string;
}

const signHeader = (signer: Signer, header: Record<string, unknown>): string =>
  signer.sign(Buffer.from(canonicalize(header)!, 'utf8'));

/** Lot hors ligne d'un terminal relayé : opérations `DEVICE_OFFLINE`, chaîne du terminal, en-tête signé. */
function relayed(
  site: Site,
  specs: Array<{ type?: string; amount?: number }>,
  options: { signer?: Signer; serial?: string } = {},
): Relayed {
  const batchId = randomUUID();
  const prev = createHash('sha256').update(`terminal-${batchId}`).digest();
  let chain: Buffer = prev;
  const serial = options.serial ?? site.deviceSerial;
  const ops = specs.map((spec) => {
    const op = makeOp(site, {
      mode: 'DEVICE_OFFLINE',
      type: spec.type ?? 'PURCHASE',
      amount: spec.amount ?? 700,
      deviceBatchId: batchId,
      noTap: true,
      patch: { device_serial: serial },
    });
    op.tap = {
      nfc_uid: site.wallets.get(1)!.nfcUid,
      token_hash: site.wallets.get(1)!.tokenHash,
      counter: 1,
      key_index: 1,
      pack_verified: true,
      occurred_at: iso(-5),
    };
    chain = chainStep(chain, contentSha256(chainedContent(op)));
    op.chain_hash = chain.toString('hex');
    return op;
  });
  const first = ops[0]!.seq as number;
  const header = {
    batch_id: batchId,
    device_serial: serial,
    ledger_id: site.ledgerId,
    authority_epoch: 1,
    seq_from: first,
    seq_to: first + ops.length - 1,
    count: ops.length,
    created_at: iso(-60),
    prev_chain_hash: prev.toString('hex'),
    last_chain_hash: chain.toString('hex'),
  };
  return {
    ops,
    deviceBatch: { header, signature: signHeader(options.signer ?? site.deviceKey, header) },
    batchId,
  };
}

describe('lots de terminal relayés', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(new TestCentral(owner), new TestTapProof(owner), owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const written = async (site: Site): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
        [site.ledgerId],
      )
    ).rows[0].n;
  const send = (site: Site, r: Relayed, keepState = false) =>
    post(site, makeBatch(site, r.ops, { keepState, extra: { device_batches: [r.deviceBatch] } }));

  it('lot relayé valide : opérations écrites (le lot signé du terminal tient lieu de preuve)', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await send(site, relayed(site, [{}, { amount: 300 }]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results.map((r: Loose) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(await written(site)).toBe(2);
  });

  it('signature d’origine fausse (autre clé) : 400 BATCH_SIGNATURE_INVALID, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const reply = await send(site, relayed(site, [{}], { signer: newSigner() }), true);
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('BATCH_SIGNATURE_INVALID');
    expect(await written(site)).toBe(0);
  });

  it('en-tête modifié après signature : 400', async () => {
    const site = await seedSite(owner, world);
    const r = relayed(site, [{}]);
    r.deviceBatch.header.count = 99;
    expect((await send(site, r, true)).json?.code).toBe('BATCH_SIGNATURE_INVALID');
  });

  it('chaîne du terminal rompue : 409 CHAIN_BROKEN, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const r = relayed(site, [{}, {}]);
    r.ops[1]!.chain_hash = 'ab'.repeat(32);
    const reply = await send(site, r, true);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('CHAIN_BROKEN');
    expect(await written(site)).toBe(0);
  });

  it('dernier maillon différent de celui de l’en-tête signé : 409 CHAIN_BROKEN', async () => {
    const site = await seedSite(owner, world);
    const r = relayed(site, [{}]);
    r.deviceBatch.header.last_chain_hash = 'cd'.repeat(32);
    r.deviceBatch.signature = signHeader(site.deviceKey, r.deviceBatch.header);
    expect((await send(site, r, true)).json?.code).toBe('CHAIN_BROKEN');
  });

  it('terminal d’un autre événement ou révoqué : refus uniforme', async () => {
    const site = await seedSite(owner, world);
    const other = await seedSite(owner, world);
    const foreign = relayed(site, [{}], { serial: other.deviceSerial, signer: other.deviceKey });
    const reply = await send(site, foreign, true);
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('BATCH_SIGNATURE_INVALID');
    site.nextEdgeSeq = 1n;
    await owner.query(`UPDATE device SET status = 'REVOKED' WHERE id = $1`, [site.deviceId]);
    const revoked = await send(site, relayed(site, [{}]), true);
    expect(revoked.json?.code).toBe('BATCH_SIGNATURE_INVALID');
    expect(await written(site)).toBe(0);
  });

  it('device_batch_id absent des device_batches : 400', async () => {
    const site = await seedSite(owner, world);
    const r = relayed(site, [{}]);
    const reply = await post(site, makeBatch(site, r.ops, { keepState: true }));
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('VALIDATION_FAILED');
    expect(await written(site)).toBe(0);
  });

  it('device_batch_id d’un autre terminal que device_serial : 400', async () => {
    const site = await seedSite(owner, world);
    const r = relayed(site, [{}]);
    r.deviceBatch.header.device_serial = 'AUTRE';
    r.deviceBatch.signature = signHeader(site.deviceKey, r.deviceBatch.header);
    expect((await send(site, r, true)).status).toBe(400);
  });

  it('TOPUP_CASH relayé : REJECTED / OFFLINE_NOT_ALLOWED, le numéro est consommé', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await send(site, relayed(site, [{ type: 'TOPUP_CASH', amount: 1000 }, {}]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0]).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'OFFLINE_NOT_ALLOWED',
    });
    expect(reply.json?.results[1].status).toBe('ACCEPTED');
  });

  it('relayé deux fois (autres numéros) : un seul effet', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const r = relayed(site, [{}]);
    expect((await send(site, r)).status).toBe(200);
    const again = { ...r.ops[0]!, edge_seq: Number(site.nextEdgeSeq) };
    site.nextEdgeSeq += 1n;
    const reply = await post(
      site,
      makeBatch(site, [again], { extra: { device_batches: [r.deviceBatch] } }),
    );
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].effect).toBe('NONE');
    expect(await written(site)).toBe(1);
  });
});
