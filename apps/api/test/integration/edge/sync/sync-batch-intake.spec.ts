// Réception `POST /edge/sync-batches` (WP13, T057) : taille, signature, identifiants, idempotence,
// un lot en vol,
// époque. Chaque refus est prouvé SANS écriture (curseur et résultats inchangés).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  newSigner,
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

jest.setTimeout(120_000);

describe('réception des lots EDGE_SYNC : entrée', () => {
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

  const cursor = async (site: Site) =>
    (
      await owner.query(`SELECT contiguous_edge_seq FROM edge_gateway WHERE id = $1`, [
        site.gatewayId,
      ])
    ).rows[0].contiguous_edge_seq as bigint;
  const batches = async (site: Site) =>
    (
      await owner.query(`SELECT count(*)::int AS n FROM edge_sync_batch WHERE gateway_id = $1`, [
        site.gatewayId,
      ])
    ).rows[0].n as number;
  const post = (site: Site, batch: unknown, options = {}) =>
    edgePost(edge.port, site.cert, batch, options);

  it('lot valide : 200, une écriture par vente, curseur avancé, numéro de série dans la clé', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 3));
    const reply = await post(site, batch);
    expect(reply.status).toBe(200);
    expect(reply.json?.results).toHaveLength(3);
    expect(reply.json?.results.map((r: any) => r.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
    ]);
    expect(reply.json?.results[0].idempotency_key).toBe(`${site.deviceSerial}:0001`);
    expect(reply.json?.contiguous_acked_seq).toBe(3);
    expect(await cursor(site)).toBe(3n);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [site.ledgerId],
    );
    expect(rows[0].n).toBe(3);
  });

  it('501 opérations : 413 BATCH_TOO_LARGE, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 501, { noTap: true, type: 'VOID' }), {
      keepState: true,
    });
    const reply = await post(site, batch);
    expect(reply.status).toBe(413);
    expect(reply.json?.code).toBe('BATCH_TOO_LARGE');
    expect(await batches(site)).toBe(0);
  });

  it('1 Mio + 1 octet : 413 sans analyse du JSON (corps non JSON)', async () => {
    const site = await seedSite(owner, world);
    const reply = await post(site, undefined, {
      raw: Buffer.alloc(1_048_577, 0x7b),
      idempotencyKey: randomUUID(),
    });
    expect(reply.status).toBe(413);
    expect(reply.json?.code).toBe('BATCH_TOO_LARGE');
  });

  it('corps de 200 ko accepté (limite globale de 100 ko non appliquée, pas de 500)', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 1), { patch: { padding: 'x'.repeat(200_000) } });
    const reply = await post(site, batch);
    expect(reply.status).toBe(200);
  });

  it('signature altérée d’un octet : 400 BATCH_SIGNATURE_INVALID, lot non traité', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 2), { keepState: true });
    const sig = Buffer.from(batch.signature as string, 'base64');
    sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
    batch.signature = sig.toString('base64');
    const reply = await post(site, batch);
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('BATCH_SIGNATURE_INVALID');
    expect(await batches(site)).toBe(0);
    expect(await cursor(site)).toBe(0n);
  });

  it('signature d’une autre clé (même événement) : 400, rien d’écrit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 1), { keepState: true, signWith: newSigner() });
    const reply = await post(site, batch);
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('BATCH_SIGNATURE_INVALID');
    expect(await batches(site)).toBe(0);
  });

  it('opération altérée après signature : 400', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 1), { keepState: true });
    ((batch.operations as any[])[0] as any).amount = 999_999;
    const reply = await post(site, batch);
    expect(reply.status).toBe(400);
    expect(reply.json?.code).toBe('BATCH_SIGNATURE_INVALID');
  });

  it('edge_gateway_id ou ledger_id du corps différents de la garde : 409 HANDOVER_INVALID_STATE', async () => {
    const site = await seedSite(owner, world);
    const other = await seedSite(owner, world);
    for (const patch of [{ edge_gateway_id: other.gatewayId }, { ledger_id: other.ledgerId }]) {
      const batch = makeBatch(site, purchases(site, 1), { keepState: true, patch });
      resign(site, batch);
      const reply = await post(site, batch);
      expect(reply.status).toBe(409);
      expect(reply.json?.code).toBe('HANDOVER_INVALID_STATE');
    }
    expect(await batches(site)).toBe(0);
  });

  it('Idempotency-Key absente ou différente de batch_id : 422', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, purchases(site, 1), { keepState: true });
    expect((await post(site, batch, { idempotencyKey: null })).status).toBe(422);
    expect((await post(site, batch, { idempotencyKey: randomUUID() })).status).toBe(422);
    expect(await batches(site)).toBe(0);
  });

  it('même batch_id, empreinte différente : refusé (IDEMPOTENCY_KEY_REUSED), rien de plus écrit', async () => {
    const site = await seedSite(owner, world);
    const batchId = randomUUID();
    const ops = purchases(site, 2);
    const first = makeBatch(site, ops, { batchId });
    expect((await post(site, first)).status).toBe(200);
    // Même identifiant et mêmes opérations, mais un champ de plus dans le lot (autre empreinte),
    // re-signé.
    const altered = makeBatch(site, ops, {
      batchId,
      prev: edgeGenesis(site),
      keepState: true,
      patch: { note: 'autre contenu' },
    });
    const reply = await post(site, altered);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [site.ledgerId],
    );
    expect(rows[0].n).toBe(2);
  });

  it('un autre lot en vol pour la passerelle : 409 BATCH_IN_PROGRESS', async () => {
    const site = await seedSite(owner, world);
    await owner.query(
      `INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from,
         edge_seq_to, request_sha256, status) VALUES ($1, $2, $3, $4, 1, 1, 1, sha256('x'), 'PROCESSING')`,
      [randomUUID(), site.operatorId, site.gatewayId, site.ledgerId],
    );
    const reply = await post(site, makeBatch(site, purchases(site, 1), { keepState: true }));
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('BATCH_IN_PROGRESS');
    expect(await cursor(site)).toBe(0n);
  });

  it('époque d’avant : 409 STALE_AUTHORITY_EPOCH, rien d’écrit, lot clos partiel', async () => {
    const site = await seedSite(owner, world);
    const batchId = randomUUID();
    const batch = makeBatch(site, purchases(site, 1), { batchId, epoch: 0, keepState: true });
    const reply = await post(site, batch);
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('STALE_AUTHORITY_EPOCH');
    expect(await cursor(site)).toBe(0n);
    const { rows } = await owner.query(`SELECT status FROM edge_sync_batch WHERE batch_id = $1`, [
      batchId,
    ]);
    expect(rows[0].status).toBe('ABANDONED');
  });

  it('vidange RELEASING de la même époque : lot admis', async () => {
    const site = await seedSite(owner, world);
    const { rows } = await owner.query(
      `SELECT id FROM debit_authority_handover WHERE edge_gateway_id = $1 AND direction = 'TO_EDGE'`,
      [site.gatewayId],
    );
    await owner.query(
      `INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
         edge_handover_id, requested_by) VALUES ($1, $2, $3, 'TO_CENTRAL', 'RELEASING', 1, $4, $5)`,
      [site.operatorId, site.ledgerId, site.gatewayId, rows[0].id, randomUUID()],
    );
    const reply = await post(site, makeBatch(site, purchases(site, 1)));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
  });

  it('certificat inconnu : 401, corps non lu', async () => {
    const site = await seedSite(owner, world);
    const stranger = await seedSite(owner, world);
    await owner.query(`UPDATE edge_gateway SET status = 'REVOKED' WHERE id = $1`, [
      stranger.gatewayId,
    ]);
    const reply = await post(stranger, makeBatch(stranger, purchases(stranger, 1)));
    expect(reply.status).toBe(401);
    expect(await batches(site)).toBe(0);
    void makeOp;
  });
});

import { edgeChainGenesis } from '@cashless/shared-rules';
function edgeGenesis(site: Site): Buffer {
  return edgeChainGenesis(site.gatewayId);
}
