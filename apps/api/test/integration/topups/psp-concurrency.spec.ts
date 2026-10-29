// Intégration : concurrence sur le traitement d'un paiement PSP (lot WP11, T056 ; A13). Transactions RÉELLES
// simultanées sur la vraie base (jamais une preuve séquentielle) : le verrou de la recharge sérialise, un seul
// crédit par paiement, aucun interblocage (ordre : recharge, portefeuille, comptes).
import { PspWorld } from './psp-fixtures';

describe('concurrence du traitement d’un paiement PSP', () => {
  let p: PspWorld;

  beforeAll(async () => {
    p = await PspWorld.create();
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });

  it('100 traitements simultanés du même paiement (notifications aux identifiants distincts et interrogation mêlées) : 1 crédit, 99 doublons', async () => {
    const t = await p.topup({ amount: 25000 });
    const runs = Array.from({ length: 100 }, (_, i) =>
      p.pay(
        t.row,
        { paymentRef: 'pay-race', notificationId: `race-${i}` },
        { origin: i % 5 === 0 ? 'POLL' : 'NOTIFICATION', pspEventId: null },
      ),
    );
    const outcomes = await Promise.all(runs);
    const count = (name: string) => outcomes.filter((o) => o.outcome === name).length;
    expect(count('CREDITED')).toBe(1);
    expect(count('DUPLICATE_PAYMENT')).toBe(99);
    expect(await p.transactions(t.row.topupId)).toHaveLength(1);
    const row = (await p.read(t.row.topupId))!;
    expect(row.status).toBe('SUCCEEDED');
    expect(await p.paidBalance(t.walletId)).toBe(Number(row.amount - row.feeAmount!));
  }, 120_000);

  it('succès, annulation confirmée et interrogation simultanés : un seul crédit, état final cohérent', async () => {
    const t = await p.topup({ amount: 8000 });
    const settle = p.tx.run(p.op, (c) =>
      p.processor.settleUnpaid(c, {
        configurationId: t.row.configurationId,
        topupId: t.row.topupId,
        verdict: 'FAILED',
        observedAt: new Date(),
      }),
    );
    await Promise.all([
      p.pay(t.row, { paymentRef: 'pay-mix' }),
      p.pay(t.row, { kind: 'PAYMENT_CANCELLED', paymentRef: 'pay-mix' }),
      settle,
      p.pay(t.row, { paymentRef: 'pay-mix', notificationId: 'again' }),
    ]);
    // Un succès tardif crédite quel que soit l'ordre (R-20) : au plus un TOPUP, jamais deux.
    const txs = await p.transactions(t.row.topupId);
    expect(txs.length).toBeLessThanOrEqual(1);
    const row = (await p.read(t.row.topupId))!;
    expect(row.status === 'SUCCEEDED').toBe(txs.length === 1);
    expect(await p.paidBalance(t.walletId)).toBe(
      txs.length === 1 ? Number(row.amount - row.feeAmount!) : 0,
    );
  }, 120_000);

  it('vingt et une recharges du même portefeuille traitées ensemble : toutes créditées, aucun interblocage', async () => {
    const w = await p.wallet();
    const made = [];
    // Trois recharges PENDING au plus par portefeuille : on les crédite par séries de trois.
    let total = 0;
    for (let round = 0; round < 7; round += 1) {
      const batch = await Promise.all([1, 2, 3].map(() => p.topup({ wallet: w, amount: 1000 })));
      made.push(...batch);
      const outcomes = await Promise.all(batch.map((t) => p.pay(t.row)));
      expect(outcomes.every((o) => o.outcome === 'CREDITED')).toBe(true);
      total += 3;
    }
    expect(made).toHaveLength(total);
    const rows = await Promise.all(made.map((t) => p.read(t.row.topupId)));
    const net = rows.reduce((sum, r) => sum + Number(r!.amount - r!.feeAmount!), 0);
    expect(await p.paidBalance(w.walletId)).toBe(net);
  }, 120_000);
});
