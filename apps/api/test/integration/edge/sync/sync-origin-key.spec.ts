// Décision 52 (WP25) : la clé d'origine de la voie passerelle est `deviceKey(serial, seq)`, comme les
// voies en ligne et hors ligne (`<serial>:<seq>` complété à 4 chiffres). Une même opération reçue du
// terminal (journal écrit sous `deviceKey`) puis de la passerelle est un DOUBLON, un seul débit.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { deviceKey } from '../../../../src/idempotency/device-key';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  openOwner,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';
import type { Loose } from '../../../support/loose';

jest.setTimeout(120_000);

describe('clé d’origine de la voie passerelle alignée sur deviceKey (décision 52)', () => {
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
  const debits = async (site: Site): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM journal_transaction
          WHERE ledger_id = $1 AND type = 'PURCHASE' AND device_id = $2`,
        [site.ledgerId, site.deviceId],
      )
    ).rows[0].n;
  /** Ce que la voie hors ligne du terminal écrit au journal (`offline-operation.processor`). */
  const offlineDirectWrite = async (site: Site, seq: number): Promise<void> => {
    await owner.query(
      `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash,
                                        occurred_at, source, device_id)
       VALUES (gen_random_uuid(), $1, $2, 'PURCHASE', $3, 'empreinte', now(), 'OFFLINE_SYNC', $4)`,
      [site.operatorId, site.ledgerId, deviceKey(site.deviceSerial, BigInt(seq)), site.deviceId],
    );
  };

  it('terminal hors ligne direct d’abord, passerelle ensuite : DUPLICATE, un seul débit', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const op = makeOp(site, { amount: 1000 });
    const seq = op.seq as number;
    expect(seq).toBeLessThan(1000);
    await offlineDirectWrite(site, seq);
    const reply = await post(site, makeBatch(site, [op]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('DUPLICATE');
    expect(reply.json?.results[0].idempotency_key).toBe(deviceKey(site.deviceSerial, BigInt(seq)));
    expect(await debits(site)).toBe(1);
  });

  it('passerelle d’abord, terminal hors ligne ensuite : la clé écrite est celle que le terminal rejoue', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const op = makeOp(site, { amount: 1000 });
    const seq = op.seq as number;
    const reply = await post(site, makeBatch(site, [op]));
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    const key = deviceKey(site.deviceSerial, BigInt(seq));
    const found = await owner.query(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2`,
      [site.ledgerId, key],
    );
    expect(found.rows[0].n).toBe(1);
    const registry = await owner.query(
      `SELECT origin_key FROM edge_sync_registry WHERE gateway_id = $1 AND outcome = 'ACCEPTED'`,
      [site.gatewayId],
    );
    expect(registry.rows.map((r) => r.origin_key)).toEqual([key]);
    // Le terminal rejoue la même opération hors ligne : la voie hors ligne cherche cette clé, trouve
    // l'écriture et ne débite pas une seconde fois (offline-operation.processor, `deviceKey`).
    expect(await debits(site)).toBe(1);
  });

  it('caution en espèces : clé `<serial>:<seq>#deposit`, distincte de celle de l’activation', async () => {
    const site = await seedSite(owner, world);
    const activation = makeOp(site, {
      type: 'ACTIVATION',
      noTap: true,
      patch: { edge_guichet: { media_id: randomUUID() } },
    });
    const deposit = makeOp(site, {
      type: 'DEPOSIT_CASH',
      noTap: true,
      patch: { seq: activation.seq, edge_guichet: { media_id: randomUUID() } },
    });
    const reply = await post(site, makeBatch(site, [activation, deposit]));
    expect(reply.status).toBe(200);
    const base = deviceKey(site.deviceSerial, BigInt(activation.seq as number));
    expect(reply.json?.results.map((r: Loose) => r.idempotency_key)).toEqual([
      base,
      `${base}#deposit`,
    ]);
    const registry = await owner.query(
      `SELECT origin_key FROM edge_sync_registry WHERE gateway_id = $1 ORDER BY edge_seq`,
      [site.gatewayId],
    );
    expect(registry.rows.map((r) => r.origin_key)).toEqual([base, `${base}#deposit`]);
  });

  it('le complément ne tronque pas : seq de 5 chiffres', async () => {
    expect(deviceKey('S', 12_345n)).toBe('S:12345');
    expect(deviceKey('S', 7n)).toBe('S:0007');
  });
});
