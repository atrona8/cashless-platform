import { effectiveBalance as shared } from '@cashless/shared-rules';
import { addOp, makeRep, q, uid, type Rep } from './_support/harness';

let r: Rep;
beforeEach(async () => {
  r = await makeRep();
});
afterEach(async () => {
  await r.close();
});

const balance = (w: string) => r.tx.run((tx) => r.svc.effectiveBalance(tx, w));
const pageWith = (w: string, paid: number, promo: number, seqApplied: number, to: number) =>
  r.page({
    from_posting_id: to - 1 < 0 ? 0 : to - 1,
    to_posting_id: to,
    edge_seq_applied: seqApplied,
    wallets: [{ wallet_id: w, status: 'ACTIVE', paid, promo }],
  });

describe('solde effectif', () => {
  it('crédit du central visible, débit local déduit', async () => {
    const w = uid();
    r.feed.queue.push(pageWith(w, 1000, 200, 0, 1));
    await r.svc.pullOnce();
    expect(await balance(w)).toEqual({ paid: 1000n, promo: 200n });
    await addOp(r, w, -300, -50);
    expect(await balance(w)).toEqual({ paid: 700n, promo: 150n });
    r.feed.queue.push(pageWith(w, 1500, 200, 0, 2)); // crédit du central
    await r.svc.pullOnce();
    expect(await balance(w)).toEqual({ paid: 1200n, promo: 150n });
  });

  it('aucun double comptage quand la page apporte le débit déjà compté', async () => {
    const w = uid();
    r.feed.queue.push(pageWith(w, 1000, 0, 0, 1));
    await r.svc.pullOnce();
    const seq = await addOp(r, w, -400);
    expect((await balance(w)).paid).toBe(600n);
    // le central a rejoué la vente : son solde 600 porte déjà le débit, edge_seq_applied l’indique
    r.feed.queue.push(pageWith(w, 600, 0, seq, 2));
    await r.svc.pullOnce();
    expect((await balance(w)).paid).toBe(600n);
    // un second débit local, plus récent, reste déduit
    await addOp(r, w, -100);
    expect((await balance(w)).paid).toBe(500n);
  });

  it('jamais négatif', async () => {
    const w = uid();
    r.feed.queue.push(pageWith(w, 100, 10, 0, 1));
    await r.svc.pullOnce();
    await addOp(r, w, -250, -80);
    expect(await balance(w)).toEqual({ paid: 0n, promo: 0n });
    expect(await balance(uid())).toEqual({ paid: 0n, promo: 0n });
  });

  it('une recharge espèces locale relève le solde effectif immédiatement (B.7-5)', async () => {
    const w = uid();
    r.feed.queue.push(pageWith(w, 100, 0, 0, 1));
    await r.svc.pullOnce();
    await addOp(r, w, 5000);
    expect((await balance(w)).paid).toBe(5100n);
  });

  it('égal à la fonction partagée sur des vecteurs', async () => {
    const vectors = [
      {
        c: [1000n, 100n],
        d: [
          [-100n, 0n],
          [-250n, -30n],
          [500n, 0n],
        ],
      },
      { c: [0n, 500n], d: [[0n, -200n]] },
      { c: [42n, 7n], d: [] as Array<[bigint, bigint]> },
    ];
    let to = 0;
    for (const v of vectors) {
      const w = uid();
      to += 1;
      r.feed.queue.push(pageWith(w, Number(v.c[0]), Number(v.c[1]), 0, to));
      await r.svc.pullOnce();
      for (const d of v.d) await addOp(r, w, Number(d[0]), Number(d[1]));
      const expected = shared(
        { paid: v.c[0] as bigint, promo: v.c[1] as bigint },
        v.d.map((d) => ({ paid: d[0] as bigint, promo: d[1] as bigint })),
      );
      expect(await balance(w)).toEqual(expected);
      await q(r, 'DELETE FROM edge_op_delta');
    }
  });
});
