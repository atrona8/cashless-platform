// Intégration : contestation d'un paiement par carte (mission 6, lot WP13, T065 et T068 ; FR-027 ; A14, A16 ; NFR-008).
// Vraie base `cashless_wp13`, faux PSP signeur de WP07, fixtures de WP11 et WP12.
import { ProblemException } from '../../../src/errors/problem';
import { ChargebackWorld } from './chargeback-fixtures';

jest.setTimeout(120_000);

describe('contestation : écriture CHARGEBACK et blocage', () => {
  let c: ChargebackWorld;
  beforeAll(async () => {
    c = await ChargebackWorld.create();
  }, 240_000);
  afterAll(async () => {
    await c.close();
  });

  it('solde payé suffisant : CHARGEBACK seul, portefeuille actif, A-PSP-CARTE crédité', async () => {
    const t = await c.credited({ amount: 10_000 });
    const dispute = c.disputeId();
    const out = await c.handle(t.row, c.notification(t.row, dispute, 4_000));
    expect(out).toMatchObject({ disposition: 'PROCESSED', outcome: 'CHARGEBACK' });
    const txs = await c.chargebackTxs(t.row.configurationId, dispute);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.source).toBe('PSP_WEBHOOK');
    const lines = await c.lines(txs[0]!.id);
    expect(lines.WALLET_PAID).toBe(4_000);
    expect(lines['A-PSP-CARTE']).toBe(-4_000);
    expect(Object.keys(lines)).toHaveLength(2);
    expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
    const [cb] = await c.chargebacks(t.row.topupId);
    expect(cb).toMatchObject({
      amount: '4000',
      chargeback_tx_id: txs[0]!.id,
      wallet_blocked: false,
      late: false,
    });
    expect(await c.p.paidBalance(t.walletId)).toBe(Number(t.net) - 4_000);
    expect(
      await (
        await import('../../support/media-fixtures')
      ).ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'CHARGEBACK_RECORDED' AND object_id = $1`,
        [cb!.psp_chargeback_id],
      ),
    ).toHaveLength(1);
  });

  it('solde payé insuffisant : portefeuille BLOQUÉ, le reste aux pertes du payeur du contrat', async () => {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, 7_000);
    const dispute = c.disputeId();
    await c.handle(t.row, c.notification(t.row, dispute, 5_000));
    const [tx] = await c.chargebackTxs(t.row.configurationId, dispute);
    const lines = await c.lines(tx!.id);
    expect(lines.WALLET_PAID).toBe(Number(t.net) - 7_000);
    const losses = Object.entries(lines).filter(([code]) => /PERTES/.test(code));
    expect(losses).toHaveLength(1);
    expect(losses[0]![1]).toBe(5_000 - (Number(t.net) - 7_000));
    expect(lines['A-PSP-CARTE']).toBe(-5_000);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    const [cb] = await c.chargebacks(t.row.topupId);
    expect(cb).toMatchObject({ wallet_blocked: true, chargeback_tx_id: tx!.id });
  });

  it('limite exacte : solde payé égal au montant contesté, pas de blocage', async () => {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, Number(t.net) - 4_000);
    const dispute = c.disputeId();
    await c.handle(t.row, c.notification(t.row, dispute, 4_000));
    expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
    expect((await c.chargebacks(t.row.topupId))[0]!.wallet_blocked).toBe(false);
    // Un franc de plus que le solde : bloqué.
    const u = await c.credited({ amount: 10_000 });
    await c.spend(u.walletId, Number(u.net) - 3_999);
    await c.handle(u.row, c.notification(u.row, c.disputeId(), 4_000));
    expect(await c.walletStatus(u.walletId)).toBe('BLOCKED');
  });

  it('solde payé nul (déjà dépensé ou remboursé) : tout va aux pertes, portefeuille bloqué', async () => {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, Number(t.net));
    const dispute = c.disputeId();
    await c.handle(t.row, c.notification(t.row, dispute, 3_000));
    const [tx] = await c.chargebackTxs(t.row.configurationId, dispute);
    const lines = await c.lines(tx!.id);
    expect(lines.WALLET_PAID).toBeUndefined();
    expect(Object.entries(lines).filter(([code]) => /PERTES/.test(code))[0]![1]).toBe(3_000);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
  });

  it('portefeuille déjà BLOQUÉ : le blocage est idempotent, pas d’erreur ; portefeuille clos : pas de blocage', async () => {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, Number(t.net));
    await (
      await import('../../support/media-fixtures')
    ).ownerRows(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [t.walletId]);
    const out = await c.handle(t.row, c.notification(t.row, c.disputeId(), 1_000));
    expect(out.outcome).toBe('CHARGEBACK');
    expect((await c.chargebacks(t.row.topupId))[0]!.wallet_blocked).toBe(true);
    const u = await c.credited({ amount: 10_000 });
    await c.spend(u.walletId, Number(u.net));
    await (
      await import('../../support/media-fixtures')
    ).ownerRows(`UPDATE wallet SET status = 'CLOSED' WHERE id = $1`, [u.walletId]);
    const closed = await c.handle(u.row, c.notification(u.row, c.disputeId(), 1_000));
    expect(closed.outcome).toBe('CHARGEBACK');
    expect(await c.walletStatus(u.walletId)).toBe('CLOSED');
  });

  it('rejeu et second identifiant de notification pour la même contestation : une seule écriture', async () => {
    const t = await c.credited({ amount: 10_000 });
    const dispute = c.disputeId();
    await c.handle(t.row, c.notification(t.row, dispute, 2_000));
    const again = await c.handle(t.row, c.notification(t.row, dispute, 2_000));
    expect(again.outcome).toBe('NO_EFFECT');
    // Même contestation, montant différent : le second est ignoré, jamais appliqué.
    const other = await c.handle(t.row, c.notification(t.row, dispute, 9_000));
    expect(other.outcome).toBe('NO_EFFECT');
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
    const cbs = await c.chargebacks(t.row.topupId);
    expect(cbs).toHaveLength(1);
    expect(cbs[0]!.amount).toBe('2000');
  });

  it('notification signée complète : réception HTTPS, aiguillage, écriture, événement PROCESSED/CHARGEBACK', async () => {
    const t = await c.credited({ amount: 10_000 });
    const dispute = c.disputeId();
    const res = await c.postDispute(t.row, dispute, 1_500);
    expect(res.status).toBe(200);
    const events = await c.w.events(t.row.configurationId);
    expect(events.at(-1)).toMatchObject({
      kind: 'DISPUTE',
      status: 'PROCESSED',
      outcome: 'CHARGEBACK',
    });
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
    // Rejeu de la même notification ET nouvel identifiant de notification : toujours une écriture.
    await c.postDispute(t.row, dispute, 1_500);
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
    expect(await c.chargebacks(t.row.topupId)).toHaveLength(1);
  });

  describe('préconditions (A14) : aucune écriture, anomalie PSP_MISMATCH, événement PROCESSED/MISMATCH', () => {
    const noWrite = async (
      t: { row: Parameters<ChargebackWorld['notification']>[0] },
      dispute: string,
    ) => {
      expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
      expect(await c.chargebacks(t.row.topupId)).toHaveLength(0);
    };

    it('recharge non CARD (Wave créditée)', async () => {
      const t = await c.credited({ method: 'WAVE' });
      const dispute = c.disputeId();
      const before = (await c.mismatchAnomalies()).length;
      const out = await c.handle(t.row, c.notification(t.row, dispute, 1_000));
      expect(out).toMatchObject({ disposition: 'PROCESSED', outcome: 'MISMATCH' });
      await noWrite(t, dispute);
      expect((await c.mismatchAnomalies()).length).toBe(before + 1);
      // Rejeu : toujours une seule anomalie pour cette contestation.
      await c.handle(t.row, c.notification(t.row, dispute, 1_000));
      expect((await c.mismatchAnomalies()).length).toBe(before + 1);
    });

    it('recharge non créditée (PENDING)', async () => {
      const row = (await c.p.topup({ method: 'CARD' })).row;
      const dispute = c.disputeId();
      const out = await c.handle(row, c.notification(row, dispute, 1_000));
      expect(out).toMatchObject({ disposition: 'PROCESSED', outcome: 'MISMATCH' });
      await noWrite({ row }, dispute);
    });

    it('devise différente', async () => {
      const t = await c.credited();
      const dispute = c.disputeId();
      const out = await c.handle(t.row, c.notification(t.row, dispute, 1_000, { currency: 'EUR' }));
      expect(out.outcome).toBe('MISMATCH');
      await noWrite(t, dispute);
    });

    it('contestation sans montant exploitable', async () => {
      const t = await c.credited();
      const out = await c.handle(t.row, c.notification(t.row, c.disputeId(), 0));
      expect(out.outcome).toBe('MISMATCH');
      expect(await c.chargebacks(t.row.topupId)).toHaveLength(0);
    });

    it('recharge introuvable : UNMATCHED (jamais MISMATCH), rien d’écrit', async () => {
      const t = await c.credited();
      const before = await c.chargebackCount();
      const out = await c.handle(
        t.row,
        c.notification(t.row, c.disputeId(), 1_000, {
          merchantRef: '00000000-0000-4000-8000-000000000001',
          paymentRef: 'pay-inconnu',
        }),
      );
      expect(out).toMatchObject({ disposition: 'UNMATCHED', topupId: null });
      expect(await c.chargebackCount()).toBe(before);
    });

    it('au-delà du net restant : refus de la base traduit en MISMATCH, jamais en 500', async () => {
      const t = await c.credited({ amount: 10_000 });
      const first = c.disputeId();
      await c.handle(t.row, c.notification(t.row, first, 6_000));
      const second = c.disputeId();
      const out = await c.handle(t.row, c.notification(t.row, second, Number(t.net) - 5_999));
      expect(out).toMatchObject({ disposition: 'PROCESSED', outcome: 'MISMATCH' });
      expect(await c.chargebackTxs(t.row.configurationId, second)).toHaveLength(0);
      expect(await c.chargebacks(t.row.topupId)).toHaveLength(1);
      // Le brut ne sert pas de plafond : un montant au-dessus du net seul est refusé aussi.
      const u = await c.credited({ amount: 10_000 });
      const over = await c.handle(u.row, c.notification(u.row, c.disputeId(), Number(u.net) + 1));
      expect(over.outcome).toBe('MISMATCH');
      expect(await c.chargebacks(u.row.topupId)).toHaveLength(0);
    });

    it('même identifiant de contestation pour une autre recharge : MISMATCH, rien d’écrit', async () => {
      const t = await c.credited();
      const u = await c.credited();
      const dispute = c.disputeId();
      await c.handle(t.row, c.notification(t.row, dispute, 1_000));
      const out = await c.handle(u.row, c.notification(u.row, dispute, 1_000));
      expect(out.outcome).toBe('MISMATCH');
      expect(await c.chargebacks(u.row.topupId)).toHaveLength(0);
    });

    it('refus définitif du moteur : MISMATCH, aucune écriture ni ligne de contestation (point de sauvegarde)', async () => {
      const t = await c.credited();
      const dispute = c.disputeId();
      const spy = jest
        .spyOn(c.engine, 'execute')
        .mockRejectedValueOnce(new ProblemException('VALIDATION_FAILED', { status: 422 }));
      try {
        const out = await c.handle(t.row, c.notification(t.row, dispute, 1_000));
        expect(out.outcome).toBe('MISMATCH');
      } finally {
        spy.mockRestore();
      }
      await noWrite(t, dispute);
    });
  });

  describe('NFR-008 : tout ou rien', () => {
    it('erreur injectée au moteur : transaction annulée, aucune contestation, aucune écriture, portefeuille inchangé', async () => {
      const t = await c.credited({ amount: 10_000 });
      await c.spend(t.walletId, Number(t.net));
      const dispute = c.disputeId();
      const spy = jest.spyOn(c.engine, 'execute').mockRejectedValueOnce(new Error('boom'));
      try {
        await expect(c.handle(t.row, c.notification(t.row, dispute, 1_000))).rejects.toThrow(
          'boom',
        );
      } finally {
        spy.mockRestore();
      }
      expect(await c.chargebacks(t.row.topupId)).toHaveLength(0);
      expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
      expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
      // La notification peut être reprise ensuite : une écriture.
      await c.handle(t.row, c.notification(t.row, dispute, 1_000));
      expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
    });

    it('erreur après l’écriture et le blocage (audit) : écriture, rattachement ET blocage annulés ensemble', async () => {
      const t = await c.credited({ amount: 10_000 });
      await c.spend(t.walletId, Number(t.net));
      const dispute = c.disputeId();
      const spy = jest.spyOn(c.service, 'record').mockRejectedValueOnce(new Error('audit'));
      try {
        await expect(c.handle(t.row, c.notification(t.row, dispute, 1_000))).rejects.toThrow(
          'audit',
        );
      } finally {
        spy.mockRestore();
      }
      expect(await c.chargebacks(t.row.topupId)).toHaveLength(0);
      expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
      expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
    });
  });
});
