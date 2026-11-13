// Audit des jetons tolérés, ordres locaux, lot abandonné et reprise (WP13, T062 ; décisions 18 et
// 33, A29).
import { randomUUID } from 'node:crypto';
import { chainStep, edgeChainGenesis, edgeContentSha256 } from '@cashless/shared-rules';
import type { Client } from 'pg';
import { EdgeSyncWriter } from '../../../../src/edge/sync/edge-sync.writer';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  iso,
  makeBatch,
  makeOp,
  openOwner,
  purchases,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';
import type { Loose } from '../../../support/loose';

jest.setTimeout(120_000);

describe('audit toléré, ordres locaux, lot abandonné', () => {
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
  afterEach(() => jest.restoreAllMocks());

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const count = async (sql: string, params: unknown[]): Promise<number> =>
    (await owner.query(sql, params)).rows[0].n;
  const written = (site: Site) =>
    count(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [site.ledgerId],
    );
  const staff = (seq: number, extra: Record<string, unknown> = {}) => ({
    edge_seq: seq,
    at: iso(-10),
    subject: 'agent-guichet-1',
    issuer: 'https://idp.example',
    jti: randomUUID(),
    seconds_past_expiry: 42,
    route: 'activateMedia',
    device_serial: 'TPE-1',
    ...extra,
  });

  it('audit toléré : lignes rangées dans edge_staff_token_audit et dans l’audit de la plateforme', async () => {
    const site = await seedSite(owner, world);
    const reply = await post(
      site,
      makeBatch(site, purchases(site, 2), { extra: { staff_token_audit: [staff(1), staff(2)] } }),
    );
    expect(reply.status).toBe(200);
    expect(
      await count(`SELECT count(*)::int AS n FROM edge_staff_token_audit WHERE gateway_id = $1`, [
        site.gatewayId,
      ]),
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'EDGE_STAFF_TOKEN_TOLERATED' AND object_id = $1`,
        [site.gatewayId],
      ),
    ).toBe(2);
  });

  it('ligne hors intervalle du lot : 400, lot non traité, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 2), {
      keepState: true,
      extra: { staff_token_audit: [staff(1), staff(7)] },
    });
    const reply = await post(site, batch);
    expect(reply.status).toBe(400);
    expect(await written(site)).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM edge_staff_token_audit WHERE gateway_id = $1`, [
        site.gatewayId,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM edge_sync_batch WHERE gateway_id = $1`, [
        site.gatewayId,
      ]),
    ).toBe(0);
  });

  it('ordres locaux : versés à l’audit du central, une seule fois même si le lot est rejoué', async () => {
    const site = await seedSite(owner, world);
    const order = {
      type: 'LOCAL_UNSTALE',
      gateway_id: site.gatewayId,
      holders: ['Awa Diop', 'Moussa Ba'],
      at: iso(-30),
      order_sha256: 'ab'.repeat(32),
    };
    const batch = makeBatch(site, purchases(site, 1), { extra: { local_orders: [order] } });
    expect((await post(site, batch)).status).toBe(200);
    expect((await post(site, batch)).status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'EDGE_LOCAL_ORDER_RECORDED' AND object_id = $1`,
        [site.gatewayId],
      ),
    ).toBe(1);
    // Jamais d'effet comptable : l'ordre n'écrit rien au grand livre.
    expect(await written(site)).toBe(1);
  });

  it('ordre local mal formé (un seul détenteur) : 422, lot non traité', async () => {
    const site = await seedSite(owner, world);
    const order = {
      type: 'PURGE',
      gateway_id: site.gatewayId,
      holders: ['Awa Diop'],
      at: iso(),
      order_sha256: 'ab'.repeat(32),
    };
    const reply = await post(
      site,
      makeBatch(site, purchases(site, 1), { keepState: true, extra: { local_orders: [order] } }),
    );
    expect(reply.status).toBe(422);
  });

  /** Fait échouer l'opération `edge_seq` donné (arrêt du central simulé : erreur non rejouée). */
  const crashAt = (seq: bigint) => {
    const writer = edge.app.get(EdgeSyncWriter);
    const real = writer.callEnvelope.bind(writer);
    let armed = true;
    jest.spyOn(writer, 'callEnvelope').mockImplementation(async (client, g, b, op, c, p) => {
      if (armed && op.edgeSeq === seq)
        throw Object.assign(new Error('arrêt simulé'), { code: 'XX000' });
      return real(client, g, b, op, c, p);
    });
    return () => {
      armed = false;
    };
  };

  it('arrêt du central entre deux opérations : le même lot reprend à la première opération sans résultat', async () => {
    const site = await seedSite(owner, world);
    const disarm = crashAt(2n);
    const batchId = randomUUID();
    const batch = makeBatch(site, purchases(site, 3), { batchId });
    expect((await post(site, batch)).status).toBe(500);
    expect(await written(site)).toBe(1);
    disarm();
    const resumed = await post(site, batch);
    expect(resumed.status).toBe(200);
    expect(resumed.json?.results.map((r: Loose) => r.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
    ]);
    expect(await written(site)).toBe(3);
    expect(
      (await owner.query(`SELECT status FROM edge_sync_batch WHERE batch_id = $1`, [batchId]))
        .rows[0].status,
    ).toBe('DONE');
  });

  it('lot abandonné (15 min) : rendu partiel, le reste repart sous un autre batch_id', async () => {
    const site = await seedSite(owner, world);
    const disarm = crashAt(2n);
    const ops = purchases(site, 3);
    const batchId = randomUUID();
    const first = makeBatch(site, ops, { batchId, keepState: true });
    expect((await post(site, first)).status).toBe(500);
    disarm();
    // Le traitement est interrompu depuis plus de 15 minutes.
    await owner.query('ALTER TABLE edge_sync_batch DISABLE TRIGGER USER');
    try {
      await owner.query(
        `UPDATE edge_sync_batch SET received_at = now() - interval '20 minutes' WHERE batch_id = $1`,
        [batchId],
      );
    } finally {
      await owner.query('ALTER TABLE edge_sync_batch ENABLE TRIGGER USER');
    }
    // Reste renvoyé sous un nouveau batch_id, premier numéro non enregistré = 2.
    const prev = chainStep(edgeChainGenesis(site.gatewayId), edgeContentSha256(ops[0] as never));
    const rest = makeBatch(site, [ops[1]!, ops[2]!], { prev });
    const reply = await post(site, rest);
    expect(reply.status).toBe(200);
    expect(reply.json?.results).toHaveLength(2);
    expect(await written(site)).toBe(3);
    // L'ancien lot n'est jamais rendu comme terminé.
    const old = await post(site, first);
    expect(old.status).toBe(200);
    expect(old.json?.abandoned).toBe(true);
    expect(old.json?.results).toHaveLength(1);
    expect(old.headers['idempotency-replayed']).toBeUndefined();
    void makeOp;
  });
});
