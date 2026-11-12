// WP25 partie A2 (décision 50, ADR-187, OP-N119) : purge manuelle AVEC lien. La file étant vide, le vidage envoie
// un lot d'ordres seuls ; rien n'est détruit avant l'accusé du central, puis la purge a lieu. Lot refusé ou lien
// coupé : la purge forcée avec sa trace `CENTRAL_UNCONFIRMED` reste (décision 33).
import { appendAckedOps, signOrder } from '../authority/_support/harness';
import type { OrderPayload } from '../../src/authority/site-order';
import { DrainService } from '../../src/queue/drain.service';
import { acceptAll } from '../queue/_support/queue-harness';
import { count, makePurgeRig, readMarker, seedCanary, type PurgeRig } from './_support/harness';

jest.setTimeout(30_000);

let rig: PurgeRig;
let drain: DrainService;
let n = 0;
const nonce = (): string => `link-${String(++n).padStart(4, '0')}-abcdefghijklmnop`;

beforeEach(async () => {
  rig = await makePurgeRig({
    centralWait: { graceMs: 1500, pollMs: 5 },
    drain: (h, keystore) => {
      drain = new DrainService(h.tx, h.client, keystore, h.clock);
      return drain;
    },
  });
  await seedCanary(rig);
  await appendAckedOps(rig.h.db, 1, true);
  // L'opération est acquittée par le central (résultat reçu) : la file est résolue, seuls des ordres peuvent partir.
  await rig.h.db.pool.query(`UPDATE edge_op SET central_status = 'ACCEPTED'`);
  drain.start();
});
afterEach(async () => {
  await drain.stop();
  await rig.close();
});

const order = (): OrderPayload => ({
  kind: 'PURGE',
  gateway_id: rig.h.gatewayId,
  issued_at: rig.h.clock.now().toISOString(),
  nonce: nonce(),
});
const submit = () => {
  const o = order();
  return rig.orders.handle({
    order: o,
    signatures: [signOrder(o, rig.h.siteKeys[0]), signOrder(o, rig.h.siteKeys[1])],
  });
};
const steps = async (): Promise<string[]> =>
  (
    await rig.h.db.pool.query(`SELECT detail->>'step' AS step FROM edge_audit WHERE kind = 'PURGE'`)
  ).rows.map((r) => r.step);
const batchRequests = () => rig.h.central.requests.filter((r) => r.path === '/edge/sync-batches');

describe('purge manuelle avec lien', () => {
  it('lot d’ordres seuls envoyé, RIEN détruit au moment où le central le reçoit, purge après l’accusé', async () => {
    const seenAtCentral: Array<{ marker: unknown; media: number }> = [];
    rig.h.central.script = (request) => {
      // Le central reçoit le lot : à cet instant, rien n'est encore détruit.
      void count(rig, 'edge_media').then((media) =>
        seenAtCentral.push({ marker: readMarker(rig), media }),
      );
      return acceptAll(request);
    };
    expect(await submit()).toMatchObject({ status: 200 });
    // Un seul lot, d'ordres seuls : intervalle vide après le dernier numéro, un ordre PURGE.
    expect(batchRequests()).toHaveLength(1);
    const body = batchRequests()[0]!.body as Record<string, any>;
    expect(body).toMatchObject({ edge_seq_from: 2, edge_seq_to: 1, operations: [] });
    expect(body.local_orders).toHaveLength(1);
    expect(body.local_orders[0]).toMatchObject({ type: 'PURGE' });
    expect(seenAtCentral).toEqual([{ marker: null, media: 1 }]);
    // Puis l'accusé, puis la destruction (jamais l'inverse).
    expect((await steps()).slice(0, 3)).toEqual(['AWAITING_CENTRAL', 'CENTRAL_ACKED', 'MARKER']);
    expect(readMarker(rig)?.state).toBe('DONE');
    expect(await count(rig, 'edge_media')).toBe(0);
    expect(await steps()).not.toContain('CENTRAL_UNCONFIRMED');
    // L'ordre est versé : plus rien à verser (le lot a été accusé).
    expect(
      Number(
        (
          await rig.h.db.pool.query(
            `SELECT count(*) AS n FROM edge_audit
              WHERE kind = 'SITE_ORDER_ACCEPTED' AND sent_in_batch IS NULL`,
          )
        ).rows[0].n,
      ),
    ).toBe(0);
  });

  it('lot refusé par le central : rien n’est détruit pendant l’attente, puis purge forcée tracée', async () => {
    let atRefusal: unknown = 'non vu';
    rig.h.central.script = () => {
      atRefusal = readMarker(rig);
      return { status: 409, body: { code: 'STALE_AUTHORITY_EPOCH' } };
    };
    expect(await submit()).toMatchObject({ status: 200 });
    expect(atRefusal).toBeNull();
    expect(await steps()).toEqual(
      expect.arrayContaining(['AWAITING_CENTRAL', 'CENTRAL_UNCONFIRMED', 'MARKER']),
    );
    expect(await steps()).not.toContain('CENTRAL_ACKED');
    expect(readMarker(rig)?.state).toBe('DONE');
  });

  it('lien coupé : purge forcée tracée, l’ordre reste à verser', async () => {
    rig.h.central.script = () => ({ destroy: true });
    expect(await submit()).toMatchObject({ status: 200 });
    expect(await steps()).toContain('CENTRAL_UNCONFIRMED');
    expect(await steps()).not.toContain('CENTRAL_ACKED');
    expect(readMarker(rig)?.state).toBe('DONE');
    expect(
      Number(
        (
          await rig.h.db.pool.query(
            `SELECT count(*) AS n FROM edge_audit
              WHERE kind = 'SITE_ORDER_ACCEPTED' AND sent_in_batch IS NULL`,
          )
        ).rows[0].n,
      ),
    ).toBe(1);
  });
});
