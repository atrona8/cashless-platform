// Intégration : concurrence des contestations (mission 6, lot WP13, T068 ; NFR-008 ; ordre des verrous : recharge,
// portefeuille, comptes). Vraie base, notifications signées par HTTPS pour les rejeux.
import { ownerRows } from '../../support/media-fixtures';
import { ChargebackWorld } from './chargeback-fixtures';

jest.setTimeout(180_000);

describe('contestations concurrentes', () => {
  let c: ChargebackWorld;
  beforeAll(async () => {
    c = await ChargebackWorld.create();
  }, 240_000);
  afterAll(async () => {
    await c.close();
  });

  it('20 notifications DISPUTE identiques en parallèle : un seul CHARGEBACK, une seule contestation', async () => {
    const t = await c.credited({ amount: 10_000 });
    const dispute = c.disputeId();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => c.postDispute(t.row, dispute, 3_000)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
    expect(await c.chargebacks(t.row.topupId)).toHaveLength(1);
    const events = (await c.w.events(t.row.configurationId)).filter((e) => e.kind === 'DISPUTE');
    expect(events).toHaveLength(20);
    expect(events.every((e) => e.status === 'PROCESSED')).toBe(true);
    expect(events.filter((e) => e.outcome === 'CHARGEBACK')).toHaveLength(1);
    expect(events.filter((e) => e.outcome === 'NO_EFFECT')).toHaveLength(19);
  });

  it('deux contestations dont la somme dépasse le net, en parallèle : une seule est écrite', async () => {
    const t = await c.credited({ amount: 10_000 });
    const half = Number(t.net) - 1_000;
    const a = c.disputeId();
    const b = c.disputeId();
    const [ra, rb] = await Promise.all([
      c.handle(t.row, c.notification(t.row, a, half)),
      c.handle(t.row, c.notification(t.row, b, half)),
    ]);
    expect([ra.outcome, rb.outcome].sort()).toEqual(['CHARGEBACK', 'MISMATCH']);
    expect(await c.chargebacks(t.row.topupId)).toHaveLength(1);
    const written =
      (await c.chargebackTxs(t.row.configurationId, a)).length +
      (await c.chargebackTxs(t.row.configurationId, b)).length;
    expect(written).toBe(1);
  });

  it('contestation pendant que le portefeuille dépense son solde payé : pas d’interblocage, blocage cohérent avec l’ordre', async () => {
    for (let round = 0; round < 3; round += 1) {
      const t = await c.credited({ amount: 10_000 });
      const dispute = c.disputeId();
      const amount = Number(t.net) - 2_000;
      // Si la contestation passe la première, le solde payé restant ne couvre plus la dépense : la base la
      // refuse (pas de découvert). C'est le seul refus admis pour la dépense.
      const [out, spent] = await Promise.all([
        c.handle(t.row, c.notification(t.row, dispute, amount)),
        c.spend(t.walletId, 5_000).then(
          () => true,
          (e: Error) => {
            if (!/Solde interdit/.test(e.message)) throw e;
            return false;
          },
        ),
      ]);
      expect(out.outcome).toBe('CHARGEBACK');
      const [tx] = await c.chargebackTxs(t.row.configurationId, dispute);
      const lines = await c.lines(tx!.id);
      const fromWallet = lines.WALLET_PAID ?? 0;
      // Blocage si et seulement si le solde payé n'a pas couvert le montant dans l'ordre de passage.
      const status = await c.walletStatus(t.walletId);
      expect(status).toBe(fromWallet < amount ? 'BLOCKED' : 'ACTIVE');
      // Dépense refusée : la contestation a tout pris sur le solde payé, sans blocage.
      if (!spent) expect(fromWallet).toBe(amount);
      // Le solde payé final ne devient jamais négatif.
      expect(await c.p.paidBalance(t.walletId)).toBeGreaterThanOrEqual(0);
      const [row] = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM psp_chargeback WHERE psp_topup_id = $1`,
        [t.row.topupId],
      );
      expect(row!.n).toBe(1);
    }
  });
});
