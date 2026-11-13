// Ordre et chaîne des lots EDGE_SYNC (WP13, T058) : le central recalcule, ne croit jamais la
// passerelle.
import { randomUUID } from 'node:crypto';
import { chainStep, edgeChainGenesis, edgeContentSha256 } from '@cashless/shared-rules';
import type { Client } from 'pg';
import { verifyEdgeChain } from '../../../../src/edge/sync/edge-sync-chain';
import type { ParsedEdgeBatch } from '../../../../src/edge/sync/edge-sync-body';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import vectors from '../../../fixtures/edge-vectors/vectors.json';
import {
  edgePost,
  makeBatch,
  makeOp,
  openOwner,
  purchases,
  resign,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';
import type { Loose } from '../../../support/loose';

jest.setTimeout(120_000);

describe('vecteurs indépendants (R-12, cas a à j)', () => {
  it('le central recalcule les mêmes empreintes que le générateur Python', () => {
    for (const entry of vectors.ops) {
      expect(edgeContentSha256(entry.op as never).toString('hex')).toBe(entry.content_sha256);
    }
    for (const genesis of vectors.genesis) {
      expect(edgeChainGenesis(genesis.gateway_id).toString('hex')).toBe(genesis.chain_hash_0);
    }
    let chain = edgeChainGenesis(vectors.chain.gateway_id);
    expect(chain.toString('hex')).toBe(vectors.chain.chain_hash_0);
    for (const link of vectors.chain.links) {
      chain = chainStep(chain, Buffer.from(link.content_sha256, 'hex'));
      expect(chain.toString('hex')).toBe(link.chain_hash);
    }
  });

  it('verifyEdgeChain accepte la chaîne des vecteurs et refuse un maillon d’un autre contenu', () => {
    const gatewayId = vectors.chain.gateway_id;
    const ops = vectors.chain.ops.map(
      (name) => vectors.ops.find((o) => o.name === name)!.op as Record<string, unknown>,
    );
    const build = (declared: string[], last: string): ParsedEdgeBatch =>
      ({
        from: 1n,
        to: 3n,
        prevChainHash: edgeChainGenesis(gatewayId),
        lastChainHash: Buffer.from(last, 'hex'),
        operations: ops.map((raw, i) => ({
          raw: { ...raw, chain_hash: declared[i] },
          edgeSeq: BigInt(i + 1),
          mode: 'EDGE_ONLINE' as const,
        })),
      }) as never;
    const links = vectors.chain.links.map((l) => l.chain_hash);
    const cursor = { contiguousEdgeSeq: 0n, lastChainHash: null };
    expect(verifyEdgeChain(build(links, links[2]!), cursor, gatewayId).contents).toHaveLength(3);
    const wrong = [...links];
    wrong[1] = links[0]!;
    expect(() => verifyEdgeChain(build(wrong, links[2]!), cursor, gatewayId)).toThrow();
  });
});

describe('réception des lots EDGE_SYNC : ordre et chaîne', () => {
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

  const post = (site: Site, batch: unknown, options = {}) =>
    edgePost(edge.port, site.cert, batch, options);
  const written = async (site: Site): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
        [site.ledgerId],
      )
    ).rows[0].n;
  const alerts = async (site: Site, action: string): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = $1 AND object_id = $2`,
        [action, site.gatewayId],
      )
    ).rows[0].n;

  it('edge_seq_from inattendu : 409 SEQ_OUT_OF_ORDER, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    site.nextEdgeSeq = 5n;
    const reply = await post(site, makeBatch(site, purchases(site, 2), { keepState: true }));
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('SEQ_OUT_OF_ORDER');
    expect(await written(site)).toBe(0);
  });

  it('deux opérations inversées ou un numéro sauté : 409 SEQ_OUT_OF_ORDER', async () => {
    const site = await seedSite(owner, world);
    const ops = purchases(site, 3);
    const swapped = makeBatch(site, [ops[1]!, ops[0]!, ops[2]!], {
      keepState: true,
      rawChain: true,
    });
    expect((await post(site, swapped)).json?.code).toBe('SEQ_OUT_OF_ORDER');
    const gap = makeBatch(site, [ops[0]!, ops[2]!], {
      keepState: true,
      rawChain: true,
      patch: { edge_seq_to: 3 },
    });
    resign(site, gap);
    expect((await post(site, gap)).status).toBe(409);
    expect(await written(site)).toBe(0);
  });

  it('edge_seq au-delà de 2^53 - 1 : 400 VALIDATION_FAILED, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 1), { keepState: true });
    const text = JSON.stringify(batch).replace('"edge_seq":1,', '"edge_seq":9007199254740992,');
    const reply = await post(site, batch, { raw: Buffer.from(text) });
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('VALIDATION_FAILED');
    expect(await written(site)).toBe(0);
  });

  it('chaîne altérée sur une opération : 409 CHAIN_BROKEN, alerte, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 2), { keepState: true });
    ((batch.operations as Loose[])[0] as Loose).chain_hash = 'ab'.repeat(32);
    resign(site, batch);
    const reply = await post(site, batch);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('CHAIN_BROKEN');
    expect(await written(site)).toBe(0);
    expect(await alerts(site, 'EDGE_CHAIN_BROKEN')).toBe(1);
  });

  it('un last_chain_hash qui n’est pas le recalcul : 409 CHAIN_BROKEN (jamais cru)', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 2), {
      keepState: true,
      patch: { last_chain_hash: 'cd'.repeat(32) },
    });
    resign(site, batch);
    const reply = await post(site, batch);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('CHAIN_BROKEN');
    expect(await written(site)).toBe(0);
  });

  it('last_chain_hash faux mais cohérent avec un prev_chain_hash falsifié : 409 CHAIN_BROKEN', async () => {
    const site = await seedSite(owner, world);
    // La passerelle part d'une autre chaîne que celle du central : tout est cohérent entre soi,
    // mais pas avec lui.
    const forged = Buffer.from('ef'.repeat(32), 'hex');
    const batch = makeBatch(site, purchases(site, 2), { keepState: true, prev: forged });
    const reply = await post(site, batch);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('CHAIN_BROKEN');
    expect(await written(site)).toBe(0);
  });

  it('deuxième lot : la chaîne du central continue celle de la passerelle (même chaîne des deux côtés)', async () => {
    const site = await seedSite(owner, world);
    expect((await post(site, makeBatch(site, purchases(site, 2)))).status).toBe(200);
    const second = await post(site, makeBatch(site, purchases(site, 2)));
    expect(second.status).toBe(200);
    const { rows } = await owner.query(
      `SELECT contiguous_edge_seq, last_chain_hash FROM edge_gateway WHERE id = $1`,
      [site.gatewayId],
    );
    expect(rows[0].contiguous_edge_seq).toBe(4n);
    expect((rows[0].last_chain_hash as Buffer).toString('hex')).toBe(site.chain.toString('hex'));
  });

  it('même edge_seq, contenu différent : refusé, jamais une écriture de plus', async () => {
    const site = await seedSite(owner, world);
    const first = purchases(site, 2);
    expect((await post(site, makeBatch(site, first))).status).toBe(200);
    // Renvoi du numéro 2 sous un autre lot avec un autre montant (chaîne recalculée par la
    // passerelle hostile).
    const replay = { ...first[1]!, amount: 55 };
    const prev = chainStep(edgeChainGenesis(site.gatewayId), edgeContentSha256(first[0] as never));
    const batch = makeBatch(site, [replay], { keepState: true, prev });
    const reply = await post(site, batch);
    expect(reply.status).toBe(409);
    expect(await written(site)).toBe(2);
    void randomUUID;
    void makeOp;
  });
});
