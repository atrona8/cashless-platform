// Intégration : traitement d'un paiement PSP (`PspPaymentProcessor`, lot WP11, T056 ; FR-012, FR-013, FR-017,
// FR-018 ; C-009, C-010 ; A2, A3, A4, A13, A20, A31). Appels directs du service dans `TenantTx.run`,
// notifications construites à la main, `receivedAt` fixé. Chaque ligne du tableau des états est un test.
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { classifyRefusal, FeesExceedAmount } from '../../../src/topups/psp/psp-refusals';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

describe('traitement d’un paiement PSP', () => {
  let p: PspWorld;

  beforeAll(async () => {
    p = await PspWorld.create();
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });

  const only = (rows: unknown[]) => {
    expect(rows).toHaveLength(1);
    return rows[0] as { id: string; idempotency_key: string; type: string };
  };

  it('succès sur PENDING : un TOPUP clé qualifiée par la configuration, recharge SUCCEEDED, frais figés', async () => {
    const t = await p.topup({ amount: 20000 });
    const out = await p.pay(t.row, { paymentRef: 'pay-ok-1' });
    expect(out).toMatchObject({
      disposition: 'PROCESSED',
      outcome: 'CREDITED',
      topupId: t.row.topupId,
      walletId: t.walletId,
      depositDue: true,
    });
    const tx = only(await p.transactions(t.row.topupId));
    expect(tx).toMatchObject({
      type: 'TOPUP',
      idempotency_key: `wave:${t.row.configurationId}:pay-ok-1`,
    });
    const [meta] = await ownerRows<{ m: Record<string, string>; source: string }>(
      'SELECT metadata AS m, source FROM journal_transaction WHERE id = $1',
      [tx.id],
    );
    expect(meta!.source).toBe('PSP_WEBHOOK');
    expect(meta!.m).toMatchObject({
      psp_topup_id: t.row.topupId,
      psp_configuration_id: t.row.configurationId,
    });
    const row = (await p.read(t.row.topupId))!;
    expect(row).toMatchObject({ status: 'SUCCEEDED', topupTxId: tx.id });
    // Frais = brut moins le net crédité au portefeuille, selon la règle figée de la configuration.
    expect(Number(row.amount - row.feeAmount!)).toBe(await p.paidBalance(t.walletId));
    expect(
      (
        await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log WHERE action = 'PSP_TOPUP_CREDITED' AND object_id = $1`,
          [t.row.topupId],
        )
      )[0]!.n,
    ).toBe(1);
  });

  it('clé d’écriture : jamais la même pour deux configurations (Orange Money, carte)', async () => {
    const om = await p.topup({ method: 'ORANGE_MONEY' });
    await p.pay(om.row, { paymentRef: 'same-ref' });
    const card = await p.topup({ method: 'CARD' });
    await p.pay(card.row, { paymentRef: 'same-ref' });
    expect(only(await p.transactions(om.row.topupId)).idempotency_key).toBe(
      `om:${om.row.configurationId}:same-ref`,
    );
    expect(only(await p.transactions(card.row.topupId)).idempotency_key).toBe(
      `psp:${card.row.configurationId}:same-ref`,
    );
  });

  it('même paiement par notification puis interrogation : un seul crédit, doublon sans écriture', async () => {
    const t = await p.topup();
    await p.pay(t.row, { paymentRef: 'pay-dup' });
    const before = await p.paidBalance(t.walletId);
    const again = await p.pay(t.row, { paymentRef: 'pay-dup' }, { origin: 'POLL' });
    expect(again).toMatchObject({ outcome: 'DUPLICATE_PAYMENT', depositDue: true });
    expect(await p.transactions(t.row.topupId)).toHaveLength(1);
    expect(await p.paidBalance(t.walletId)).toBe(before);
  });

  describe('tableau des états : notification × état', () => {
    it('PAYMENT_FAILED : aucun effet, la recharge reste PENDING', async () => {
      const t = await p.topup();
      const out = await p.pay(t.row, { kind: 'PAYMENT_FAILED' });
      expect(out).toMatchObject({ outcome: 'NO_EFFECT', depositDue: false });
      expect((await p.read(t.row.topupId))!.status).toBe('PENDING');
      expect(await p.transactions(t.row.topupId)).toEqual([]);
    });

    it('PAYMENT_FAILED sur SUCCEEDED : aucun effet', async () => {
      const t = await p.topup();
      await p.pay(t.row, { paymentRef: 'pay-f1' });
      const out = await p.pay(t.row, { kind: 'PAYMENT_FAILED', paymentRef: 'pay-f1' });
      expect(out.outcome).toBe('NO_EFFECT');
      expect((await p.read(t.row.topupId))!.status).toBe('SUCCEEDED');
    });

    it('PAYMENT_CANCELLED sur PENDING : CANCELLED (annulation confirmée par le PSP)', async () => {
      const t = await p.topup();
      const out = await p.pay(t.row, { kind: 'PAYMENT_CANCELLED' });
      expect(out.outcome).toBe('NO_EFFECT');
      expect(await p.read(t.row.topupId)).toMatchObject({
        status: 'CANCELLED',
        failureReason: 'CANCELLED',
      });
    });

    it('PAYMENT_CANCELLED sur SUCCEEDED : aucun effet', async () => {
      const t = await p.topup();
      await p.pay(t.row, { paymentRef: 'pay-c1' });
      await p.pay(t.row, { kind: 'PAYMENT_CANCELLED', paymentRef: 'pay-c1' });
      expect((await p.read(t.row.topupId))!.status).toBe('SUCCEEDED');
    });

    it.each(['UNKNOWN', 'DISPUTE'] as const)(
      '%s : aucun effet (la contestation est à WP13)',
      async (kind) => {
        const t = await p.topup();
        const out = await p.pay(t.row, { kind });
        expect(out.outcome).toBe('NO_EFFECT');
        expect((await p.read(t.row.topupId))!.status).toBe('PENDING');
      },
    );

    it('succès tardif sur FAILED, EXPIRED, CANCELLED : crédité s’il est recevable (R-20)', async () => {
      const failed = await p.topup();
      await p.tx.run(p.op, (c) =>
        p.processor.settleUnpaid(c, {
          configurationId: failed.row.configurationId,
          topupId: failed.row.topupId,
          verdict: 'FAILED',
          observedAt: new Date(),
        }),
      );
      const cancelled = await p.topup();
      await p.pay(cancelled.row, { kind: 'PAYMENT_CANCELLED' });
      const expired = await p.topup();
      await ownerRows(
        "UPDATE psp_topup SET expires_at = created_at + interval '1 millisecond' WHERE psp_topup_id = $1",
        [expired.row.topupId],
      );
      await p.tx.run(p.op, (c) =>
        p.processor.settleUnpaid(c, {
          configurationId: expired.row.configurationId,
          topupId: expired.row.topupId,
          verdict: 'EXPIRED',
          observedAt: new Date(),
        }),
      );
      for (const [t, status] of [
        [failed, 'FAILED'],
        [cancelled, 'CANCELLED'],
        [expired, 'EXPIRED'],
      ] as const) {
        expect((await p.read(t.row.topupId))!.status).toBe(status);
        const out = await p.pay(t.row, { paymentRef: `late-${status}` });
        expect(out.outcome).toBe('CREDITED');
        expect(await p.read(t.row.topupId)).toMatchObject({ status: 'SUCCEEDED' });
        expect(await p.transactions(t.row.topupId)).toHaveLength(1);
      }
    });
  });

  describe('contrôles (a) : le paiement doit se rapprocher exactement', () => {
    it.each([
      ['montant différent', { amount: 9999n }],
      ['devise différente', { currency: 'EUR' }],
      ['autre référence marchande', { merchantRef: '0aaaaaaa-0000-4000-8000-000000000001' }],
    ] as const)(
      '%s : MISMATCH, rien au grand livre, une anomalie par paiement',
      async (name, over) => {
        const ref = `pay-mm-${name.replace(/ /g, '-')}`;
        const t = await p.topup({ amount: 10000 });
        const before = (await p.anomalies('PSP_MISMATCH')).length;
        // Une référence marchande étrangère n'est retrouvée que par la référence du PSP.
        if ('merchantRef' in over)
          await p.tx.run(p.op, (c) =>
            c.query('SELECT mark_psp_topup_initiated($1, $2)', [t.row.topupId, ref]),
          );
        const input = p.input(t.row, p.notification(t.row, { paymentRef: ref, ...over }));
        expect(await p.run(input)).toMatchObject({ outcome: 'MISMATCH', depositDue: false });
        // Même paiement rejoué : pas de seconde anomalie.
        expect(await p.run(input)).toMatchObject({ outcome: 'MISMATCH' });
        expect(await p.transactions(t.row.topupId)).toEqual([]);
        expect((await p.read(t.row.topupId))!.status).toBe('PENDING');
        expect((await p.anomalies('PSP_MISMATCH')).length).toBe(before + 1);
      },
    );

    it('second paiement distinct pour une recharge déjà créditée : MISMATCH, jamais deux crédits', async () => {
      const t = await p.topup();
      await p.pay(t.row, { paymentRef: 'first' });
      const out = await p.pay(t.row, { paymentRef: 'second' });
      expect(out.outcome).toBe('MISMATCH');
      expect(await p.transactions(t.row.topupId)).toHaveLength(1);
    });
  });

  it('recharge introuvable, ou d’une autre configuration : UNMATCHED, rien d’écrit', async () => {
    const t = await p.topup({ method: 'WAVE' });
    const unknown = p.input(t.row, p.notification(t.row, { merchantRef: crypto.randomUUID() }));
    expect(await p.run(unknown)).toMatchObject({ disposition: 'UNMATCHED', outcome: null });
    // Isolation entre configurations : la référence marchande d'une recharge Wave n'existe pas chez Orange.
    const foreign = p.input(t.row, p.notification(t.row), {
      configurationId: p.configs.ORANGE_MONEY,
    });
    const out = await p.run(foreign);
    expect(out).toMatchObject({ disposition: 'UNMATCHED', topupId: null, operatorId: p.op });
    expect((await p.read(t.row.topupId))!.status).toBe('PENDING');
    expect(await p.transactions(t.row.topupId)).toEqual([]);
  });

  it('recharge retrouvée par la référence du PSP quand la notification n’a pas de référence marchande', async () => {
    const t = await p.topup();
    await p.tx.run(p.op, (c) =>
      c.query('SELECT mark_psp_topup_initiated($1, $2)', [t.row.topupId, 'by-psp-ref']),
    );
    const out = await p.pay(t.row, { merchantRef: null, paymentRef: 'by-psp-ref' });
    expect(out).toMatchObject({ outcome: 'CREDITED', topupId: t.row.topupId });
  });

  describe('refus définitifs : jamais de 500, anomalie portant l’argent à rendre', () => {
    it('portefeuille bloqué : FAILED WALLET_BLOCKED, anomalie du montant, une par paiement', async () => {
      const w = await p.wallet();
      const t = await p.topup({ wallet: w, amount: 7000 });
      await ownerRows(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [w.walletId]);
      const before = (await p.anomalies('PSP_TOPUP_NOT_CREDITED')).length;
      const first = await p.pay(t.row, { paymentRef: 'blocked-1' });
      expect(first).toMatchObject({ outcome: 'NOT_CREDITED', depositDue: false });
      await p.pay(t.row, { paymentRef: 'blocked-1', notificationId: 'other-id' });
      const row = (await p.read(t.row.topupId))!;
      expect(row).toMatchObject({ status: 'FAILED', failureReason: 'WALLET_BLOCKED' });
      const anomalies = await p.anomalies('PSP_TOPUP_NOT_CREDITED');
      expect(anomalies).toHaveLength(before + 1);
      expect(anomalies.at(-1)!.amount).toBe('7000');
      expect(row.anomalyId).toBe(anomalies.at(-1)!.id);
      expect(await p.transactions(t.row.topupId)).toEqual([]);
    });

    it('événement qui n’accepte plus les recharges PSP (brouillon) : LEDGER_STATUS', async () => {
      const draft = await p.sw.draftEvent();
      const t = await p.topup({ wallet: await p.wallet({ ledgerId: draft.ledgerId }) });
      expect((await p.pay(t.row)).outcome).toBe('NOT_CREDITED');
      expect(await p.read(t.row.topupId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'LEDGER_STATUS',
      });
      expect(await p.transactions(t.row.topupId)).toEqual([]);
    });

    it('plafond de solde dépassé (refus du moteur) : FAILED WALLET_LIMIT, anomalie PSP_TOPUP_OVER_LIMIT, grand livre intact', async () => {
      const w = await p.wallet({ funds: 4000 });
      const t = await p.topup({ wallet: w, amount: 9000 });
      const restore = await capsOf(p, 10000);
      try {
        const journal = await p.count('SELECT 1 FROM journal_transaction WHERE ledger_id = $1', [
          p.ev.ledgerId,
        ]);
        expect((await p.pay(t.row)).outcome).toBe('NOT_CREDITED');
        expect(
          await p.count('SELECT 1 FROM journal_transaction WHERE ledger_id = $1', [p.ev.ledgerId]),
        ).toBe(journal);
      } finally {
        await restore();
      }
      const row = (await p.read(t.row.topupId))!;
      expect(row).toMatchObject({ status: 'FAILED', failureReason: 'WALLET_LIMIT' });
      const over = (await p.anomalies('PSP_TOPUP_OVER_LIMIT')).find((a) => a.id === row.anomalyId);
      expect(over?.amount).toBe('9000');
    });

    it('classifyRefusal : codes connus traduits, tout le reste est inattendu', () => {
      expect(classifyRefusal(new Error('x'), 'PERIOD_CLOSED')?.reason).toBe('PERIOD_CLOSED');
      expect(classifyRefusal(new Error('x'), 'DEBIT_AUTHORITY_EDGE')?.reason).toBe(
        'DEBIT_AUTHORITY_EDGE',
      );
      expect(classifyRefusal(new Error('x'), 'WALLET_BLOCKED')?.reason).toBe('WALLET_BLOCKED');
      expect(classifyRefusal(new Error('x'), 'WALLET_LIMIT_EXCEEDED')).toMatchObject({
        reason: 'WALLET_LIMIT',
        anomalyKind: 'PSP_TOPUP_OVER_LIMIT',
      });
      expect(classifyRefusal(new Error('x'), 'MONTHLY_TOPUP_LIMIT_EXCEEDED')?.reason).toBe(
        'MONTHLY_LIMIT',
      );
      expect(classifyRefusal(new Error('x'), 'IDEMPOTENCY_KEY_REUSED')?.reason).toBe('PSP_FAILED');
      expect(classifyRefusal(new FeesExceedAmount(), 'INTERNAL_ERROR')?.reason).toBe(
        'FEES_EXCEED_AMOUNT',
      );
      expect(classifyRefusal(new Error('x'), 'INTERNAL_ERROR')).toBeNull();
      expect(classifyRefusal(new Error('x'), 'NOT_FOUND')).toBeNull();
    });

    it('erreur inattendue du moteur : remonte intacte, rien d’écrit, recharge toujours PENDING', async () => {
      const t = await p.topup();
      const engine = p.sw.api.app.get(LedgerEngineService, { strict: false });
      const spy = jest.spyOn(engine, 'execute').mockRejectedValueOnce(new Error('panne du moteur'));
      await expect(p.pay(t.row)).rejects.toThrow('panne du moteur');
      spy.mockRestore();
      expect((await p.read(t.row.topupId))!.status).toBe('PENDING');
      expect(await p.transactions(t.row.topupId)).toEqual([]);
      // Le travailleur reprend : le même paiement crédite ensuite.
      expect((await p.pay(t.row)).outcome).toBe('CREDITED');
    });
  });

  describe('settleUnpaid', () => {
    const settle = (
      t: { row: { configurationId: string; topupId: string } },
      verdict: 'FAILED' | 'EXPIRED',
    ) =>
      p.tx.run(p.op, (c) =>
        p.processor.settleUnpaid(c, {
          configurationId: t.row.configurationId,
          topupId: t.row.topupId,
          verdict,
          observedAt: new Date(),
        }),
      );

    it('échec confirmé : FAILED sans anomalie d’argent (rien n’a été payé)', async () => {
      const t = await p.topup();
      const before = (await p.anomalies('PSP_TOPUP_NOT_CREDITED')).length;
      expect((await settle(t, 'FAILED')).outcome).toBe('NOT_CREDITED');
      expect(await p.read(t.row.topupId)).toMatchObject({ status: 'FAILED', anomalyId: null });
      expect((await p.anomalies('PSP_TOPUP_NOT_CREDITED')).length).toBe(before);
    });

    it('recharge déjà créditée : aucun effet ; non échue : aucun effet', async () => {
      const paid = await p.topup();
      await p.pay(paid.row);
      expect((await settle(paid, 'FAILED')).outcome).toBe('NO_EFFECT');
      expect((await p.read(paid.row.topupId))!.status).toBe('SUCCEEDED');
      const fresh = await p.topup();
      expect((await settle(fresh, 'EXPIRED')).outcome).toBe('NO_EFFECT');
      expect((await p.read(fresh.row.topupId))!.status).toBe('PENDING');
    });
  });
});

/** Plafond de solde de la juridiction de l'événement A (anonyme) ; rend la remise en état. */
async function capsOf(p: PspWorld, maxBalance: number): Promise<() => Promise<void>> {
  const [old] = await ownerRows<{ id: string }>(
    'SELECT jurisdiction_id AS id FROM event WHERE id = $1',
    [p.ev.eventId],
  );
  const profile = crypto.randomUUID();
  await ownerRows(
    `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                       unidentified_max_balance, unidentified_monthly_limit)
     VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', $2, NULL)`,
    [profile, maxBalance],
  );
  await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [p.ev.eventId, profile]);
  return async () => {
    await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [p.ev.eventId, old!.id]);
  };
}
