// WP25 partie A1 (décision 45, ADR-185) : l'ordre de dépense répliqué (`edge_terms.spend_order`) règle la
// répartition payé/offert d'une vente de la passerelle, comme `edge_spend_promo_first` au rejeu central
// (apps/api/test/integration/edge/sync/sync-spend-order.spec.ts, mêmes montants). Champ absent : les ventes qui
// mêlent crédit payé et crédit offert sont refusées, les autres passent.
import { makeBench, type Bench } from './_support/harness';
import { lineFor, newTill, queueState, tapAndPay, type Till } from './_support/helpers';

let b: Bench;
let till: Till;
let counter = 0;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  till = await newTill(b);
});
afterAll(async () => b.close());
afterEach(async () => {
  await setTerms({ spend_order: 'PROMO_FIRST' });
});

const setTerms = (terms: Record<string, unknown> | null) =>
  b.q('UPDATE edge_event_setting SET edge_terms = $1', [terms && JSON.stringify(terms)]);
const deltas = async (walletId: string) =>
  (
    await b.q<{ paid_delta: string; promo_delta: string }>(
      'SELECT paid_delta, promo_delta FROM edge_op_delta WHERE wallet_id = $1',
      [walletId],
    )
  ).map((r) => [Number(r.paid_delta), Number(r.promo_delta)]);
const sale = async (paid: number, promo: number, amount: number) => {
  const bracelet = await b.newBracelet({ paid, promo });
  counter += 1;
  const res = await tapAndPay(b, till, bracelet, counter, {
    amount,
    lines: [lineFor(till, amount / 500)],
  });
  return { bracelet, res };
};

describe('ordre de dépense répliqué', () => {
  it.each([
    ['PAID_FIRST', 1_500, [[-1_500, 0]], { paid: 2_500, promo: 1_000 }],
    ['PROMO_FIRST', 1_500, [[-500, -1_000]], { paid: 3_500, promo: 0 }],
    ['PAID_FIRST', 500, [[-500, 0]], { paid: 3_500, promo: 1_000 }],
    ['PROMO_FIRST', 500, [[0, -500]], { paid: 4_000, promo: 500 }],
  ] as const)('%s, vente de %i : répartition appliquée', async (order, amount, expected, after) => {
    await setTerms({ spend_order: order });
    const { bracelet, res } = await sale(4_000, 1_000, amount);
    expect(res.status).toBe(201);
    expect(res.json!.balance_after).toMatchObject({
      ...after,
      spendable: after.paid + after.promo,
    });
    expect(await deltas(bracelet.walletId)).toEqual(expected);
  });

  it('champ absent (edge_terms vide ou nul) : vente mêlant payé et offert refusée, aucune écriture, VOID', async () => {
    for (const terms of [{}, null, { max_cash_topup: 500_000 }]) {
      await setTerms(terms);
      const before = await queueState(b);
      const { bracelet, res } = await sale(4_000, 1_000, 500);
      expect(res.status).toBe(409);
      expect(res.json!.code).toBe('CONFLICT_STATE');
      expect(String(res.json!.detail)).toContain('SPEND_ORDER_UNKNOWN');
      expect(await deltas(bracelet.walletId)).toEqual([]);
      // Le refus consomme un numéro par un VOID (comme tout refus), sans effet sur le solde.
      const after = await queueState(b);
      expect(after.head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
      const [op] = await b.q<{ type: string }>('SELECT type FROM edge_op WHERE edge_seq = $1', [
        after.head.last_edge_seq,
      ]);
      expect(op!.type).toBe('VOID');
    }
  });

  it('champ absent : les ventes dont la répartition ne dépend pas de l’ordre passent', async () => {
    await setTerms({});
    const onlyPaid = await sale(3_000, 0, 500);
    expect(onlyPaid.res.status).toBe(201);
    expect(await deltas(onlyPaid.bracelet.walletId)).toEqual([[-500, 0]]);
    const onlyPromo = await sale(0, 3_000, 500);
    expect(onlyPromo.res.status).toBe(201);
    expect(await deltas(onlyPromo.bracelet.walletId)).toEqual([[0, -500]]);
    // Tout le solde dépensé : même répartition dans les deux ordres.
    const all = await sale(1_000, 500, 1_500);
    expect(all.res.status).toBe(201);
    expect(await deltas(all.bracelet.walletId)).toEqual([[-1_000, -500]]);
  });

  it('champ absent : un solde insuffisant reste INSUFFICIENT_FUNDS', async () => {
    await setTerms({});
    const { res } = await sale(100, 100, 500);
    expect(res.status).toBe(422);
    expect(res.json!.code).toBe('INSUFFICIENT_FUNDS');
  });
});
