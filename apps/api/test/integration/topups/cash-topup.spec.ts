// Intégration : recharge en espèces au guichet (`createCashTopup`, FR-004, FR-005, FR-007, FR-008 ; contrat
// `POST /topups/cash`). Écrite en source `ONLINE` par le serveur, rattachée à la session ouverte du terminal,
// jamais découpée ; la caution due est prise ensuite, dans une transaction distincte.
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { CashTopupService } from '../../../src/topups/cash/cash-topup.service';
import { createCashWorld, type CashWorld } from '../../support/cash-fixtures';
import { ledgerIsSound, ownerRows as rows } from '../../support/media-fixtures';

describe('recharge en espèces au guichet', () => {
  let c: CashWorld;

  beforeAll(async () => {
    c = await createCashWorld();
  });
  afterAll(async () => {
    await c.close();
  });
  afterEach(async () => {
    expect(await ledgerIsSound(c.w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  });

  it('recharge réussie : TOPUP_CASH en source ONLINE, lignes caisse/portefeuille, rattachée à la session, heure de la base', async () => {
    const m = await c.fresh(c.batches.plain);
    const { walletId } = await c.activate(m);
    const cashBefore = await c.balance(c.session.code);
    const body = c.topupBody(m, 5000, { cash_tendered: 10000 });
    const before = await c.counts();
    const res = await c.topup(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      transaction_id: expect.any(String),
      idempotency_key: expect.stringMatching(/^TEST-.+:0001$/),
      type: 'TOPUP_CASH',
      status: 'SUCCEEDED',
      amount: 5000,
      currency: 'XOF',
      wallet_id: walletId,
      balance_after: { spendable: 5000, paid: 5000, promo: 0 },
      deposit: null,
      cash_session_id: c.session.sessionId,
    });
    const tx = res.body.transaction_id as string;
    const [journal] = await rows<{
      type: string;
      source: string;
      device_id: string;
      delta: number;
      meta: { cash_session_id: string; device_occurred_at: string };
    }>(
      `SELECT type, source, device_id, abs(extract(epoch FROM (clock_timestamp() - occurred_at)))::int AS delta,
              metadata AS meta
         FROM journal_transaction WHERE id = $1`,
      [tx],
    );
    expect(journal).toMatchObject({
      type: 'TOPUP_CASH',
      source: 'ONLINE',
      device_id: c.device.deviceId,
    });
    // L'heure écrite est celle de la base, pas l'heure du terminal (une heure plus tôt).
    expect(journal!.delta).toBeLessThan(60);
    expect(journal!.meta.cash_session_id).toBe(c.session.sessionId);
    expect(journal!.meta.device_occurred_at).toBe((body as { occurred_at: string }).occurred_at);
    // Deux lignes : caisse de la session (+) et portefeuille payé (-), rien vers L-ESP-A-RENDRE.
    const lines = await rows<{ code: string; purpose: string; amount: string }>(
      `SELECT a.code, a.purpose, p.amount::text FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 ORDER BY p.amount`,
      [tx],
    );
    expect(lines.map((l) => [l.purpose, l.amount])).toEqual([
      ['WALLET_PAID', '-5000'],
      ['CASH_DESK', '5000'],
    ]);
    expect(lines[1]!.code).toBe(c.session.code);
    expect(await c.balance(c.session.code)).toBe(cashBefore + 5000);
    expect(
      await rows(`SELECT 1 FROM anomaly WHERE ledger_id = $1 AND media_id = $2`, [
        c.w.ids.ledgerA,
        m.id,
      ]),
    ).toEqual([]);
    // Rattachement à la session (preuve par l'API, pas seulement par la base) et lecture consommée.
    expect(
      await rows('SELECT cash_session_id FROM cash_session_tx WHERE tx_id = $1', [tx]),
    ).toEqual([{ cash_session_id: c.session.sessionId }]);
    const after = await c.counts();
    expect(after).toMatchObject({
      journal: before.journal + 1,
      sessionTx: before.sessionTx + 1,
      consumedTaps: before.consumedTaps + 1,
    });
    // Numéro rangé au registre, dans la même transaction.
    expect(
      await rows(
        `SELECT outcome::text AS o, transaction_id FROM device_seq_registry WHERE device_id = $1 AND seq = 1`,
        [c.device.deviceId],
      ),
    ).toEqual([{ o: 'ACCEPTED', transaction_id: tx }]);
    expect(
      await rows(
        `SELECT actor_id, after->>'cash_session_id' AS s FROM audit_log
          WHERE action = 'CASH_TOPUP' AND object_id = $1`,
        [tx],
      ),
    ).toEqual([{ actor_id: c.w.cashierA.userId, s: c.session.sessionId }]);
    // Aucune réponse ne porte le solde ou le théorique de la caisse (A27).
    expect(JSON.stringify(res.body)).not.toMatch(/expected|theoretical|cash_balance/i);
  });

  it('rejeu de la même clé : même réponse, Idempotency-Replayed, une seule écriture', async () => {
    const m = await c.fresh(c.batches.plain);
    await c.activate(m);
    const key = c.seqKey(c.device);
    const body = c.topupBody(m, 3000);
    const first = await c.topup(body, { key });
    expect(first.status).toBe(201);
    const before = await c.counts();
    const replay = await c.topup(body, { key });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await c.counts()).toEqual(before);
    expect(
      await rows(`SELECT count(*)::int AS n FROM journal_transaction WHERE idempotency_key = $1`, [
        key,
      ]),
    ).toEqual([{ n: 1 }]);
  });

  it('caution FROM_BALANCE due : lue dans le crédit, prise APRÈS le COMMIT dans une transaction distincte (HELD)', async () => {
    const m = await c.fresh(c.batches.fromBalance);
    const { walletId } = await c.activate(m);
    expect(await rows('SELECT deposit_status FROM media WHERE id = $1', [m.id])).toEqual([
      { deposit_status: 'DUE' },
    ]);
    // Sonde sur le moteur : au moment de la prise, le crédit doit déjà être visible d'une AUTRE connexion.
    const engine = c.app.get(LedgerEngineService);
    const original = engine.execute.bind(engine);
    const seen: number[] = [];
    const spy = jest.spyOn(engine, 'execute').mockImplementation(async (client, command) => {
      if (command.type === 'DEPOSIT_TAKEN') {
        const n = await rows<{ n: number }>(
          `SELECT count(*)::int AS n FROM journal_transaction WHERE type = 'TOPUP_CASH'
              AND ledger_id = $1 AND (metadata->>'cash_session_id') = $2
              AND id IN (SELECT transaction_id FROM posting p JOIN account a ON a.id = p.account_id
                          WHERE a.wallet_id = $3)`,
          [c.w.ids.ledgerA, c.session.sessionId, walletId],
        );
        seen.push(n[0]!.n);
      }
      return original(client, command);
    });
    try {
      const res = await c.topup(c.topupBody(m, 5000));
      expect(res.status).toBe(201);
      // État lu DANS la transaction du crédit (avant la prise).
      expect(res.body.deposit).toEqual({
        status: 'DUE',
        amount: 2000,
        mode: 'FROM_BALANCE',
        transaction_id: null,
      });
      expect(res.body.balance_after).toEqual({ spendable: 5000, paid: 5000, promo: 0 });
      expect(seen).toEqual([1]);
    } finally {
      spy.mockRestore();
    }
    expect(
      await rows('SELECT deposit_status, deposit_held::int AS held FROM media WHERE id = $1', [
        m.id,
      ]),
    ).toEqual([{ deposit_status: 'HELD', held: 2000 }]);
    const txs = await rows<{ type: string }>(
      `SELECT DISTINCT t.type FROM posting p JOIN account a ON a.id = p.account_id
         JOIN journal_transaction t ON t.id = p.transaction_id WHERE a.wallet_id = $1 ORDER BY t.type`,
      [walletId],
    );
    expect(txs.map((t) => t.type)).toEqual(['DEPOSIT_TAKEN', 'TOPUP_CASH']);
  });

  it('échec de la prise de caution : le crédit et la réponse 201 sont inchangés, la caution reste due', async () => {
    const m = await c.fresh(c.batches.fromBalance);
    const { walletId } = await c.activate(m);
    const engine = c.app.get(LedgerEngineService);
    const original = engine.execute.bind(engine);
    const spy = jest.spyOn(engine, 'execute').mockImplementation(async (client, command) => {
      if (command.type === 'DEPOSIT_TAKEN') throw new Error('panne simulée du moteur');
      return original(client, command);
    });
    try {
      const res = await c.topup(c.topupBody(m, 5000));
      expect(res.status).toBe(201);
      expect(res.body.deposit).toMatchObject({ status: 'DUE', amount: 2000 });
    } finally {
      spy.mockRestore();
    }
    expect(
      await rows('SELECT deposit_status, deposit_held::int AS held FROM media WHERE id = $1', [
        m.id,
      ]),
    ).toEqual([{ deposit_status: 'DUE', held: 0 }]);
    expect(await rows<{ s: string }>(`SELECT wallet_spendable($1)::text AS s`, [walletId])).toEqual(
      [{ s: '5000' }],
    );
  });

  it('crédit partiel qui ne couvre pas la caution : elle reste due, rien n’est pris', async () => {
    const m = await c.fresh(c.batches.fromBalance);
    await c.activate(m);
    const res = await c.topup(c.topupBody(m, 1500));
    expect(res.status).toBe(201);
    expect(res.body.deposit).toMatchObject({ status: 'DUE', amount: 2000 });
    expect(await rows('SELECT deposit_status FROM media WHERE id = $1', [m.id])).toEqual([
      { deposit_status: 'DUE' },
    ]);
  });

  it('grand livre EDGE : la recharge (un crédit) reste permise', async () => {
    const m = await c.fresh(c.batches.plain);
    await c.activate(m);
    await rows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [c.w.ids.ledgerA]);
    try {
      const res = await c.topup(c.topupBody(m, 2000));
      expect(res.status).toBe(201);
    } finally {
      await rows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [c.w.ids.ledgerA]);
    }
  });

  it('source et marge ne viennent jamais du corps : champ inconnu refusé, aucun découpage, rien d’écrit', async () => {
    const m = await c.fresh(c.batches.plain);
    await c.activate(m);
    const restore = await c.setCaps({ maxBalance: 1000, monthly: null });
    try {
      const before = await c.counts();
      for (const extra of [{ source: 'OFFLINE_SYNC' }, { headroom: 1000 }, { wallet_id: 'x' }]) {
        const res = await c.topup(c.topupBody(m, 5000, extra));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      expect(await c.counts()).toEqual(before);
      // Le plafond s'applique en ligne : refus de la base, pas de découpage vers L-ESP-A-RENDRE.
      const over = await c.topup(c.topupBody(m, 5000));
      expect(over.status).toBe(422);
      expect(over.body.code).toBe('WALLET_LIMIT_EXCEEDED');
      expect(await c.counts()).toEqual(before);
      expect(
        await rows(
          `SELECT 1 FROM posting p JOIN account a ON a.id = p.account_id
                     WHERE a.ledger_id = $1 AND a.purpose = 'CUSTOMER_CASH_DUE' AND p.amount <> 0`,
          [c.w.ids.ledgerA],
        ),
      ).toEqual([]);
    } finally {
      await restore();
    }
  });

  it('portefeuille déduit du bracelet : un wallet_id d’un autre portefeuille du même grand livre est refusé avant écriture', async () => {
    const m = await c.fresh(c.batches.plain);
    const { walletId } = await c.activate(m);
    const before = await c.counts();
    const res = await c.topup(c.topupBody(m, 2000, { wallet_id: c.w.ids.walletA }));
    expect(res.status).toBe(400);
    expect(await c.counts()).toEqual(before);
    const ok = await c.topup(c.topupBody(m, 2000));
    expect(ok.status).toBe(201);
    expect(ok.body.wallet_id).toBe(walletId);
    expect(
      await rows<{ s: string }>(`SELECT wallet_spendable($1)::text AS s`, [c.w.ids.walletA]),
    ).toEqual([{ s: '0' }]);
  });

  it('deux recharges simultanées du même portefeuille : une seule passe quand la marge ne suffit pas à deux', async () => {
    const m = await c.fresh(c.batches.plain);
    const { walletId } = await c.activate(m);
    const restore = await c.setCaps({ maxBalance: 6000, monthly: null });
    try {
      const results = await Promise.all([
        c.topup(c.topupBody(m, 5000)),
        c.topup(c.topupBody(m, 5000)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      expect(
        await rows<{ s: string }>(`SELECT wallet_spendable($1)::text AS s`, [walletId]),
      ).toEqual([{ s: '5000' }]);
    } finally {
      await restore();
    }
  });

  // Mesure côté serveur, autour de `CashTopupService.create` (verrous, grand livre, rattachement, registre,
  // enregistrement de la réponse idempotente), jamais autour du client. Écartée sous `SKIP_LATENCY`.
  const latency = process.env.SKIP_LATENCY ? it.skip : it;
  latency(
    'latence (NFR-009) : 200 recharges en série, p95 ≤ 200 ms',
    async () => {
      const m = await c.fresh(c.batches.plain);
      await c.activate(m);
      const service = c.app.get(CashTopupService);
      const original = service.create.bind(service);
      const durations: number[] = [];
      const spy = jest.spyOn(service, 'create').mockImplementation(async (args, tx) => {
        const started = process.hrtime.bigint();
        try {
          return await original(args, tx);
        } finally {
          durations.push(Number(process.hrtime.bigint() - started) / 1e6);
        }
      });
      try {
        for (let i = 0; i < 200; i += 1) {
          const res = await c.topup(c.topupBody(m, 100));
          expect(res.status).toBe(201);
        }
      } finally {
        spy.mockRestore();
      }
      const sorted = [...durations].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
      expect(durations).toHaveLength(200);
      expect(p95).toBeLessThanOrEqual(200);
    },
    300_000,
  );
});
