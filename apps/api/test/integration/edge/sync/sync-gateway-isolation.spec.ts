// Isolation entre DEUX passerelles d'un même prestataire (WP25 partie A3) pour les fonctions étroites de la
// migration 0066 que le rôle `cashless_edge` exécute : `edge_sync_results`, `edge_fee_config`, `edge_tap_proof`.
// Connexion réelle `cashless_edge`, session posée comme la garde mTLS (prestataire et passerelle). Chaque fonction
// est appelée avec la passerelle B pour une donnée de la passerelle A : rien ne doit sortir ; A voit ses données.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect, EDGE_URL } from '../../../support/db';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  openOwner,
  seedSite,
  startSyncEdge,
  type Site,
  type SyncEdge,
} from './sync-support';

jest.setTimeout(120_000);

describe('isolation entre deux passerelles d’un même prestataire (cashless_edge)', () => {
  let owner: Client;
  let edgeDb: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;
  let a: Site;
  let b: Site;
  let batchA: string;

  beforeAll(async () => {
    owner = await openOwner();
    edgeDb = await connect(EDGE_URL);
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(undefined, undefined, owner);
    a = await seedSite(owner, world, [[1, 50_000]]);
    b = await seedSite(owner, world, [[1, 50_000]]);
    // Même prestataire, deux événements, deux grands livres, deux passerelles.
    expect(a.operatorId).toBe(b.operatorId);
    expect(a.gatewayId).not.toBe(b.gatewayId);
    for (const site of [a, b]) {
      await owner.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           rate_bps, trigger, valid_from, version)
         VALUES ($1, 'PARTICIPATION', $2, 'MERCHANT', 'ORG_COM', 'SALE_AMOUNT', $3, 'REALTIME',
           now() - interval '1 day', 1)`,
        [site.operatorId, site.participationId, site === a ? 250 : 900],
      );
    }
    batchA = randomUUID();
    const reply = await edgePost(
      edge.port,
      a.cert,
      makeBatch(a, [makeOp(a, { amount: 1000 })], { batchId: batchA }),
    );
    expect(reply.status).toBe(200);
  });
  afterAll(async () => {
    await edge?.close();
    await edgeDb?.end();
    await owner?.end();
  });

  /** Une requête sous la session de `site` (prestataire et passerelle locaux à la transaction). */
  async function as<T>(site: Site, sql: string, args: unknown[]): Promise<T[]> {
    await edgeDb.query('BEGIN');
    try {
      await edgeDb.query(`SELECT set_config('app.operator_id', $1, true)`, [site.operatorId]);
      await edgeDb.query(`SELECT set_config('app.gateway_id', $1, true)`, [site.gatewayId]);
      return (await edgeDb.query(sql, args)).rows as T[];
    } finally {
      await edgeDb.query('ROLLBACK');
    }
  }

  it('edge_sync_results : la passerelle A voit les résultats de son lot, la B n’en voit aucun', async () => {
    const own = await as(a, 'SELECT * FROM edge_sync_results($1::uuid, $2::uuid)', [
      a.gatewayId,
      batchA,
    ]);
    expect(own).toHaveLength(1);
    const foreign = await as(b, 'SELECT * FROM edge_sync_results($1::uuid, $2::uuid)', [
      b.gatewayId,
      batchA,
    ]);
    expect(foreign).toEqual([]);
    // Prétendre être A depuis la session de B : refus 42501, jamais les résultats de A.
    await expect(
      as(b, 'SELECT * FROM edge_sync_results($1::uuid, $2::uuid)', [a.gatewayId, batchA]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('edge_fee_config : chaque passerelle ne voit que sa règle ; le terminal de l’autre est inconnu', async () => {
    const sql = 'SELECT * FROM edge_fee_config($1::uuid, $2, now())';
    const ownA = await as<{ rate_bps: number }>(a, sql, [a.gatewayId, a.deviceSerial]);
    const ownB = await as<{ rate_bps: number }>(b, sql, [b.gatewayId, b.deviceSerial]);
    expect(ownA.map((r) => r.rate_bps)).toEqual([250]);
    expect(ownB.map((r) => r.rate_bps)).toEqual([900]);
    expect(await as(b, sql, [b.gatewayId, a.deviceSerial])).toEqual([]);
    expect(await as(a, sql, [a.gatewayId, b.deviceSerial])).toEqual([]);
    await expect(as(b, sql, [a.gatewayId, a.deviceSerial])).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('edge_tap_proof : le bracelet du grand livre de A est prouvé pour A, jamais pour B', async () => {
    const w = a.wallets.get(1)!;
    const sql = 'SELECT edge_tap_proof($1::uuid, $2::bytea, $3::bytea, $4::bytea) AS ok';
    const args = (site: Site) => [
      site.gatewayId,
      Buffer.from(w.tokenHash, 'hex'),
      Buffer.from(w.nfcUid, 'hex'),
      Buffer.from(w.signature),
    ];
    expect((await as<{ ok: boolean }>(a, sql, args(a)))[0]!.ok).toBe(true);
    expect((await as<{ ok: boolean }>(b, sql, args(b)))[0]!.ok).toBe(false);
    await expect(as(b, sql, args(a))).rejects.toMatchObject({ code: '42501' });
  });
});
