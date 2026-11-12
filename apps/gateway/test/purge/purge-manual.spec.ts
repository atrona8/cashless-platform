import { readFileSync } from 'node:fs';
import { appendAckedOps, signOrder } from '../authority/_support/harness';
import { ORDER_VALIDITY_MS, type OrderPayload } from '../../src/authority/site-order';
import { count, makePurgeRig, readMarker, seedCanary, type PurgeRig } from './_support/harness';
import { markLocalOrdersSent, pendingLocalOrders } from '../../src/purge/local-orders-feed';

let rig: PurgeRig;
let n = 0;
const nonce = (): string => `purge-${String(++n).padStart(4, '0')}-abcdefghijklmnop`;

beforeEach(async () => {
  rig = await makePurgeRig();
  await seedCanary(rig);
  await appendAckedOps(rig.h.db, 1, true);
});
afterEach(async () => rig.close());

const order = (over: Partial<OrderPayload> = {}): OrderPayload => ({
  kind: 'PURGE',
  gateway_id: rig.h.gatewayId,
  issued_at: rig.h.clock.now().toISOString(),
  nonce: nonce(),
  ...over,
});
const both = (o: OrderPayload) => [
  signOrder(o, rig.h.siteKeys[0]),
  signOrder(o, rig.h.siteKeys[1]),
];
const send = (o: unknown, signatures: unknown) => rig.orders.handle({ order: o, signatures });

async function assertNothingDestroyed(): Promise<void> {
  expect(readMarker(rig)).toBeNull();
  expect(await count(rig, 'edge_media')).toBe(1);
  expect(await count(rig, 'edge_token_key')).toBe(1);
  await rig.keystore.sign('token', Buffer.from('x'));
  await rig.keystore.publicKey('agreement');
}

describe('purge manuelle à deux personnes', () => {
  it('ordre valide : exécution, audit PURGE avec les deux auteurs, nonce consigné', async () => {
    const o = order();
    expect(await send(o, both(o))).toMatchObject({ status: 200, body: { kind: 'PURGE' } });
    expect(readMarker(rig)?.state).toBe('DONE');
    expect(await count(rig, 'edge_media')).toBe(0);
    const marker = JSON.parse(readFileSync(rig.marker.path, 'utf8'));
    expect(marker.holders).toEqual(['Responsable A', 'Responsable B']);
    const rows = (
      await rig.h.db.pool.query(`SELECT detail FROM edge_audit WHERE kind = 'PURGE' ORDER BY id`)
    ).rows;
    // Décision 48 : sans lien (ici, rien pour porter l'ordre), purge forcée avec trace.
    expect(rows.map((r) => r.detail.step).slice(0, 3)).toEqual([
      'AWAITING_CENTRAL',
      'CENTRAL_UNCONFIRMED',
      'MARKER',
    ]);
    expect(rows[2].detail).toMatchObject({
      trigger: 'MANUAL',
      central: 'UNCONFIRMED',
      holders: ['Responsable A', 'Responsable B'],
    });
    expect(await count(rig, "edge_audit WHERE kind = 'SITE_ORDER_ACCEPTED'")).toBe(1);
    // Rejouer le même ordre : refusé.
    expect((await send(o, both(o))).status).toBeGreaterThanOrEqual(400);
  });

  it('une seule signature : refus, rien détruit', async () => {
    const o = order();
    expect((await send(o, [signOrder(o, rig.h.siteKeys[0])])).body).toEqual({
      code: 'SIGNATURE_COUNT',
    });
    await assertNothingDestroyed();
  });

  it('deux fois la même personne : refus, rien détruit', async () => {
    const o = order();
    const same = signOrder(o, rig.h.siteKeys[0]);
    expect((await send(o, [same, same])).body).toEqual({ code: 'SAME_SIGNER' });
    await assertNothingDestroyed();
  });

  it('ordre périmé (11 minutes) : refus, rien détruit', async () => {
    const o = order({
      issued_at: new Date(rig.h.clock.now().getTime() - ORDER_VALIDITY_MS - 60_000).toISOString(),
    });
    expect((await send(o, both(o))).body).toEqual({ code: 'EXPIRED' });
    await assertNothingDestroyed();
  });

  it(
    'ordre pour une autre passerelle (même signé par les deux) : refus ' + 'WRONG_GATEWAY',
    async () => {
      const o = order({ gateway_id: '33333333-3333-4333-8333-333333333333' });
      expect((await send(o, both(o))).body).toEqual({ code: 'WRONG_GATEWAY' });
      await assertNothingDestroyed();
    },
  );

  it(
    'ordre modifié après signature : BAD_SIGNATURE ; type LOCAL_UNSTALE refusé par ' +
      'le traitement PURGE',
    async () => {
      const o = order();
      expect((await send({ ...o, nonce: nonce() }, both(o))).body).toEqual({
        code: 'BAD_SIGNATURE',
      });
      await assertNothingDestroyed();
      const wrong = order({ kind: 'LOCAL_UNSTALE' });
      await expect(
        rig.manual.handle({ order: wrong, signatures: both(wrong) }),
      ).rejects.toMatchObject({
        code: 'KIND_MISMATCH',
      });
      await assertNothingDestroyed();
    },
  );

  it('champ en trop dans l’ordre : refus', async () => {
    const o = order({ epoch: 3 });
    expect((await send(o, both(o))).body).toEqual({ code: 'MALFORMED' });
    await assertNothingDestroyed();
  });

  it(
    'nonce rejoué : refus (même après un refus pour file non acquittée, le nonce ' + 'reste libre)',
    async () => {
      await appendAckedOps(rig.h.db, 1, false);
      const o = order();
      expect((await send(o, both(o))).body).toEqual({ code: 'REFUSED' });
      await assertNothingDestroyed();
      // La file n'est pas acquittée : le refus n'a pas consommé le nonce.
      expect(await count(rig, "edge_audit WHERE kind = 'SITE_ORDER_ACCEPTED'")).toBe(0);
    },
  );

  it(
    'nonce rejoué après un ordre accepté (purge d’une autre passerelle impossible, ' +
      'ordre identique refusé)',
    async () => {
      const o = order();
      await rig.h.db.pool.query(
        `INSERT INTO edge_audit (kind, actor, detail) VALUES ('SITE_ORDER_ACCEPTED', 'x', $1)`,
        [JSON.stringify({ nonce: o.nonce })],
      );
      expect((await send(o, both(o))).body).toEqual({ code: 'NONCE_REPLAYED' });
      await assertNothingDestroyed();
    },
  );
});

describe('versement des ordres locaux au central (décision 33)', () => {
  it(
    'un ordre accepté part dans local_orders, sans signature ni clé, puis est marqué ' + 'versé',
    async () => {
      const o = order();
      await send(o, both(o));
      const lines = await rig.h.tx.run((tx) => pendingLocalOrders(tx));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'PURGE',
        gateway_id: rig.h.gatewayId,
        holders: ['Responsable A', 'Responsable B'],
      });
      expect(lines[0]!.order_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(lines)).not.toContain(both(o)[0]!.signature);
      const batchId = '22222222-2222-4222-8222-222222222222';
      await rig.h.db.pool.query(
        `INSERT INTO edge_outgoing_batch (batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256,
                                        status, body)
       VALUES ($1, 1, 1, 1, $2, 'SENT', $3)`,
        [batchId, Buffer.alloc(32, 1), JSON.stringify({ local_orders: lines })],
      );
      await rig.h.tx.run((tx) => markLocalOrdersSent(tx, batchId));
      expect(await rig.h.tx.run((tx) => pendingLocalOrders(tx))).toHaveLength(0);
    },
  );

  it('ligne invalide : non envoyée, alerte LOCAL_ORDER_UNSENDABLE (une seule fois)', async () => {
    await rig.h.db.pool.query(
      `INSERT INTO edge_audit (kind, actor, detail) VALUES ('SITE_ORDER_ACCEPTED', 'x', $1)`,
      [JSON.stringify({ order_kind: 'PURGE', holders: ['seul'], order_sha256: 'zz' })],
    );
    expect(await rig.h.tx.run((tx) => pendingLocalOrders(tx))).toEqual([]);
    expect(await rig.h.tx.run((tx) => pendingLocalOrders(tx))).toEqual([]);
    expect(await count(rig, "edge_audit WHERE kind = 'LOCAL_ORDER_UNSENDABLE'")).toBe(1);
  });
});

describe('versement au central AVANT la destruction (décision 48)', () => {
  const sentBatch = async (orderSha: string): Promise<void> => {
    const batchId = '44444444-4444-4444-8444-444444444444';
    await rig.h.db.pool.query(
      `INSERT INTO edge_outgoing_batch (batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256,
                                        status, body, done_reason)
       VALUES ($1, 1, 1, 1, $2, 'DONE', $3, 'RESULTS')`,
      [
        batchId,
        Buffer.alloc(32, 2),
        JSON.stringify({ local_orders: [{ order_sha256: orderSha }] }),
      ],
    );
    await rig.h.tx.run((tx) => markLocalOrdersSent(tx, batchId));
  };
  const waitFor = async (cond: () => Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 200; i += 1) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('condition non atteinte');
  };

  it('avec lien : rien n’est détruit avant l’accusé du central, puis la purge a lieu', async () => {
    await rig.close();
    rig = await makePurgeRig({ centralWait: { graceMs: 30_000, pollMs: 5 } });
    await seedCanary(rig);
    await appendAckedOps(rig.h.db, 1, true);
    const o = order();
    const pending = send(o, both(o));
    await waitFor(async () => (await count(rig, "edge_audit WHERE kind = 'PURGE'")) >= 1);
    // En attente : ordre inscrit, non versé ; marqueur absent, colis et clés intacts.
    await new Promise((r) => setTimeout(r, 60));
    await assertNothingDestroyed();
    expect(await rig.h.tx.run((tx) => pendingLocalOrders(tx))).toHaveLength(1);
    const sha = (await rig.h.tx.run((tx) => pendingLocalOrders(tx)))[0]!.order_sha256;
    await sentBatch(sha); // accusé du central
    expect(await pending).toMatchObject({ status: 200 });
    expect(readMarker(rig)?.state).toBe('DONE');
    const steps = (
      await rig.h.db.pool.query(
        `SELECT detail->>'step' AS step, detail->>'central' AS central FROM edge_audit
          WHERE kind = 'PURGE' ORDER BY id`,
      )
    ).rows;
    expect(steps.map((r) => r.step).slice(0, 3)).toEqual([
      'AWAITING_CENTRAL',
      'CENTRAL_ACKED',
      'MARKER',
    ]);
    expect(steps[2].central).toBe('ACKED');
  });

  it(
    'sans lien : purge locale forcée après le délai, trace gardée, ordre toujours à ' + 'verser',
    async () => {
      const o = order();
      expect(await send(o, both(o))).toMatchObject({ status: 200 });
      expect(readMarker(rig)?.state).toBe('DONE');
      const steps = (
        await rig.h.db.pool.query(
          `SELECT detail->>'step' AS step FROM edge_audit WHERE kind='PURGE'`,
        )
      ).rows.map((r) => r.step);
      expect(steps).toContain('CENTRAL_UNCONFIRMED');
      // La ligne d'ordre survit à la purge (table protégée) et reste à verser (decision 33).
      const lines = await rig.h.tx.run((tx) => pendingLocalOrders(tx));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'PURGE',
        holders: ['Responsable A', 'Responsable B'],
      });
    },
  );

  it('file remplie pendant l’attente : refus, rien détruit', async () => {
    await rig.close();
    rig = await makePurgeRig({ centralWait: { graceMs: 30_000, pollMs: 5 } });
    await seedCanary(rig);
    await appendAckedOps(rig.h.db, 1, true);
    const o = order();
    const pending = send(o, both(o));
    await waitFor(async () => (await count(rig, "edge_audit WHERE kind = 'PURGE'")) >= 1);
    await appendAckedOps(rig.h.db, 1, false);
    const sha = (await rig.h.tx.run((tx) => pendingLocalOrders(tx)))[0]!.order_sha256;
    await sentBatch(sha);
    expect((await pending).body).toEqual({ code: 'REFUSED' });
    await assertNothingDestroyed();
  });
});
