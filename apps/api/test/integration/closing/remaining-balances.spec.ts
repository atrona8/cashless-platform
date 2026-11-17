// FR-008 : relevé des soldes restants, JSON et CSV ; vide une fois le grand livre verrouillé.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

describe('soldes restants des portefeuilles', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.toSettling();
  });
  afterAll(async () => w.close());

  it('FR-008 : totaux JSON par nature, sans donnée personnelle', async () => {
    const res = await w.get('/remaining-balances');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ event_id: w.fx.eventId, currency: 'XOF' });
    expect(res.body.wallet_count).toBeGreaterThan(0);
    expect(res.body.paid_total).toBeGreaterThan(0);
    expect(res.body.promo_total).toBe(1000);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'as_of',
        'cash_due_total',
        'currency',
        'event_id',
        'paid_total',
        'promo_total',
        'wallet_count',
      ].sort(),
    );
  });

  it('FR-008 : CSV une ligne par portefeuille, mêmes totaux que le JSON', async () => {
    const json = (await w.get('/remaining-balances')).body;
    const res = await w.get('/remaining-balances?format=csv').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('wallet_id,paid,cash_due,promo');
    expect(lines.length - 1).toBe(json.wallet_count);
    const sum = (col: number) => lines.slice(1).reduce((t, l) => t + Number(l.split(',')[col]), 0);
    expect([sum(1), sum(2), sum(3)]).toEqual([
      json.paid_total,
      json.cash_due_total,
      json.promo_total,
    ]);
    expect((await w.get('/remaining-balances?format=xml')).status).toBe(400);
  });
});
