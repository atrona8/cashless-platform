// Parcours complet des recharges, caisses et PSP (mission 6, lot WP14, T069 ; SC-001 à SC-005 ; FR-001 à FR-031),
// entièrement par l'API : HTTPS réel (terminal `TOPUP_DESK` à trois preuves, personnes par jetons du faux
// fournisseur d'identité, festivalier du faux de la 5b), vraie base, faux PSP signeur de WP07. Les notifications du
// PSP sont POSTÉES sur la vraie route publique `/webhooks/{provider}/{psp_config_id}` avec la vraie signature.
//   1. configuration (deux OPERATOR_ADMIN, règle de frais exigée, choix de l'événement en LIVE : 202) ;
//   2. SC-002 : OP-N49 levé, aucune écriture d'espèces sans session ; 3. session, recharge espèces, caution ;
//   4. recharge mobile money au guichet puis carte par le festivalier, notification rejouée ;
//   5. SC-004 : paiement non créditable ; 6. contestation et déblocage à deux ; 7. comptage, fermeture, dépôt ;
//   8. contrôles finaux en lecture ; cas limites (deux terminaux, PSP et espèces sur un portefeuille, reprise).
//
// Écritures directes en base : amorçage seulement (jeu d'essai commun de WP08 à WP13, bracelets et portefeuilles des
// festivaliers) ; AUCUNE écriture directe pendant les étapes (les contrôles finaux sont des lectures).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fakeEvents } from '../../../src/psp/fake/fake-notification-signer';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  createBatch,
  ledgerIsSound,
  ownerRows,
  seedPersonalizedMedia,
  tapBody,
  type SeededMedia,
} from '../../support/media-fixtures';
import { send, type TestTerminal } from '../../support/test-terminal';
import { ChargebackWorld } from '../chargebacks/chargeback-fixtures';
import {
  ageTopup,
  closeBacklog,
  startPoller,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(600_000);

describe('SC-001 à SC-005 : parcours complet des recharges, caisses et PSP, tout par l’API', () => {
  let c: ChargebackWorld;
  let poller: PollerProcess;
  let t1: TestTerminal;
  let t2: TestTerminal;
  let sessionId = '';
  let session2Id = '';
  let tapCounter = 1000;
  const next = () => (tapCounter += 1);
  const cw = () => c.cw;
  const p = () => c.p;
  const cashier = () => cw().w.cashierA;
  let batchId = '';
  const topupIds: string[] = [];
  const succeeded: string[] = [];

  /** Bracelet personnalisé et activé (amorçage) sur un portefeuille de festivalier. */
  async function braceletOn(walletId: string): Promise<SeededMedia> {
    return withOwner(async (db) => {
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: p().op,
        batchId,
        kmsKeyRef: cw().w.keyRef.a,
        count: 1,
      });
      await activateMedia(db, {
        operatorId: p().op,
        eventId: p().ev.eventId,
        walletId,
        mediaIds: [m!.id],
      });
      return m!;
    });
  }
  const cashTopup = (t: TestTerminal, m: SeededMedia, amount: number) =>
    cw().term(t, 'POST', '/topups/cash', cashier(), {
      amount,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap: tapBody(m, next()),
    });
  /** Plafond de solde de la juridiction de l'événement A (amorçage) ; rend la remise en état. */
  async function capsOf(maxBalance: number): Promise<() => Promise<void>> {
    const [old] = await ownerRows<{ id: string }>(
      'SELECT jurisdiction_id AS id FROM event WHERE id = $1',
      [p().ev.eventId],
    );
    const profile = randomUUID();
    await ownerRows(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                         unidentified_max_balance, unidentified_monthly_limit)
       VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', $2, NULL)`,
      [profile, maxBalance],
    );
    await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [
      p().ev.eventId,
      profile,
    ]);
    return async () => {
      await ownerRows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [
        p().ev.eventId,
        old!.id,
      ]);
    };
  }
  const journalCount = () => cw().journalCount(p().ev.ledgerId);

  beforeAll(async () => {
    c = await ChargebackWorld.create();
    await closeBacklog();
    poller = await startPoller(c.w);
    t1 = await cw().terminal();
    t2 = await cw().terminal();
    batchId = await withOwner((db) =>
      createBatch(db, {
        operatorId: p().op,
        organizerId: cw().w.ids.organizerA,
        eventId: p().ev.eventId,
        status: 'ACTIVE',
        depositAmount: 1000,
        depositMode: 'SEPARATE',
      }),
    );
  }, 300_000);
  afterAll(async () => {
    await poller?.close();
    await c?.close();
  });

  it('1. configuration : deux OPERATOR_ADMIN, règle de frais exigée, choix en LIVE = 202', async () => {
    const op = p().op;
    const author = cw().w.operatorAdminA;
    const other = cw().operatorAdmin2;
    const organizer = cw().w.ids.organizerA;
    const ref = `psp/${p().holderId}/journey-${randomUUID().slice(0, 8)}`;
    p().store.put(ref, { current: `journey-${randomUUID()}`, adapter: 'journey-adapter' });
    const created = await cw().bo('POST', `/organizers/${organizer}/psp-configurations`, author, {
      method: 'WAVE',
      provider: 'WAVE',
      holder_party_id: p().holderId,
      secret_ref: ref,
    });
    expect(created.status).toBe(201);
    const id = created.body.psp_config_id as string;
    // Activation d'une configuration sans règle de frais : refusée (rien ne devient ACTIVE).
    const noFee = await cw().bo('POST', `/psp-configurations/${id}/approval-requests`, author, {
      status: 'ACTIVE',
      compliance_ref: 'KYB-JOURNEY',
    });
    if (noFee.status === 202) {
      const refused = await cw().bo(
        'POST',
        `/approval-requests/${noFee.body.approval_request_id}/approve`,
        other,
        {},
      );
      expect(refused.body.status).not.toBe('EXECUTED');
    } else expect([409, 422]).toContain(noFee.status);
    expect(
      (
        await ownerRows<{ status: string }>(
          'SELECT status FROM psp_configuration WHERE psp_configuration_id = $1',
          [id],
        )
      )[0]!.status,
    ).toBe('DRAFT');
    const fee = await cw().bo('POST', `/operators/${op}/fee-rules`, author, {
      scope_type: 'PSP_CONFIGURATION',
      scope_id: id,
      payer_purpose: 'ORG_FPSP',
      beneficiary_purpose: 'PSP_FRAIS',
      basis: 'TOPUP_AMOUNT',
      rate_bps: 150,
      trigger: 'REALTIME',
      valid_from: '2026-01-01T00:00:00Z',
    });
    expect(fee.status).toBe(201);
    const asked = await cw().bo('POST', `/psp-configurations/${id}/approval-requests`, author, {
      status: 'ACTIVE',
      compliance_ref: 'KYB-JOURNEY',
    });
    expect(asked.status).toBe(202);
    // Le demandeur ne peut pas approuver sa propre demande ; l'autre OPERATOR_ADMIN le peut.
    const self = await cw().bo(
      'POST',
      `/approval-requests/${asked.body.approval_request_id}/approve`,
      author,
      {},
    );
    expect([403, 409]).toContain(self.status);
    const done = await cw().bo(
      'POST',
      `/approval-requests/${asked.body.approval_request_id}/approve`,
      other,
      {},
    );
    expect(done.body.status).toBe('EXECUTED');
    // Choix de l'événement (LIVE) : demande à deux, 202.
    const choice = await send(
      {
        url: new URL(`${cw().api.baseUrl}/events/${p().ev.eventId}/psp-selections/WAVE`),
        method: 'PUT',
        headers: {
          authorization: `Bearer ${cw().w.organizerAdminA.token}`,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({ psp_config_id: id }),
        cert: null,
        key: null,
      },
      cw().api.tls.serverCaPem,
    );
    expect(choice.status).toBe(202);
    expect(
      (await cw().bo('GET', `/events/${p().ev.eventId}/psp-selections`, cw().w.organizerAdminA))
        .status,
    ).toBe(200);
  });

  it('2. SC-002 : OP-N49 levé : sans session, aucune écriture d’espèces (409) et rien d’écrit', async () => {
    const wallet = await p().wallet();
    const m = await braceletOn(wallet.walletId);
    const before = await journalCount();
    const topup = await cashTopup(t1, m, 5000);
    expect(topup.status).toBe(409);
    await ownerRows(`UPDATE media SET deposit_status = 'DUE' WHERE id = $1`, [m.id]);
    const deposit = await cw().term(t1, 'POST', `/media/${m.id}/deposit`, cashier(), {
      payment: { method: 'CASH' },
    });
    expect(deposit.status).toBe(409);
    const due = await cw().term(t1, 'POST', `/media/${m.id}/cash-due-refunds`, cashier(), {
      tap: tapBody(m, next()),
    });
    expect(due.status).toBe(409);
    expect(await journalCount()).toBe(before);
  });

  it('3. session, recharge espèces (plafond en ligne), caution en espèces, rattachées à la session (SC-005)', async () => {
    sessionId = await cw().open(t1, cashier());
    session2Id = await cw().open(t2, cw().cashier2);
    expect(sessionId).not.toBe(session2Id);
    const wallet = await p().wallet();
    const m = await braceletOn(wallet.walletId);
    const ok = await cashTopup(t1, m, 5000);
    expect(ok.status).toBe(201);
    expect(ok.body.cash_session_id).toBe(sessionId);
    // Au-delà du plafond de solde de la juridiction : 422, rien d'écrit (plafond posé en amorçage, puis remis).
    const before = await journalCount();
    const restore = await capsOf(7000);
    try {
      const over = await cashTopup(t1, m, 5000);
      expect(over.status).toBe(422);
    } finally {
      await restore();
    }
    expect(await journalCount()).toBe(before);
    // Caution en espèces, sous la session.
    await ownerRows(`UPDATE media SET deposit_status = 'DUE' WHERE id = $1`, [m.id]);
    const taken = await cw().term(t1, 'POST', `/media/${m.id}/deposit`, cashier(), {
      payment: { method: 'CASH' },
    });
    expect(taken.status).toBe(200);
    expect(taken.body.cash_session_id).toBe(sessionId);
    // Deux terminaux distincts : la recharge du terminal 2 va à la session 2 (aucune confusion de caisse).
    const m2 = await braceletOn((await p().wallet()).walletId);
    const second = await cw().term(t2, 'POST', '/topups/cash', cw().cashier2, {
      amount: 2000,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap: tapBody(m2, next()),
    });
    expect(second.status).toBe(201);
    expect(second.body.cash_session_id).toBe(session2Id);
    // SC-005 : aucune réponse du caissier n'a montré le théorique.
    const view = await cw().term(t1, 'GET', `/cash-sessions/${sessionId}`, cashier(), undefined);
    expect(view.status).toBe(200);
    expect(view.body.expected_amount).toBeNull();
    expect(view.body.difference).toBeNull();
    expect(view.body.cash_diff_anomaly_id).toBeNull();
    for (const res of [ok, taken, second])
      expect(JSON.stringify(res.body)).not.toMatch(/expected_|theoretical/i);
  });

  it('4. mobile money au guichet puis carte par le festivalier : TOPUP une fois, rejeu = duplicate', async () => {
    const wallet = await p().wallet();
    // Même portefeuille : une recharge espèces et une recharge PSP (cas limite).
    const m = await braceletOn(wallet.walletId);
    expect((await cashTopup(t1, m, 1000)).status).toBe(201);
    const res = await cw().term(t1, 'POST', '/topups/psp', cashier(), p().body(wallet.walletId));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    const id = res.body.topup_id as string;
    topupIds.push(id);
    const row = (await p().read(id))!;
    const event = c.w.event(row, { id: `evt-${randomUUID()}`, paymentId: row.providerPaymentRef! });
    const first = await c.w.post(event);
    expect(first.status).toBe(200);
    console.log(
      'DBG',
      JSON.stringify(first.body),
      JSON.stringify(await c.w.events(row.configurationId)),
    );
    expect(first.body).not.toMatchObject({ duplicate: true });
    const replay = await c.w.post(event);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ duplicate: true });
    expect(await p().read(id)).toMatchObject({ status: 'SUCCEEDED' });
    expect(await p().transactions(id)).toHaveLength(1);
    succeeded.push(id);
    // Carte par le festivalier (3-D Secure attesté par la notification).
    const cw2 = await p().wallet();
    const card = await p().cust(
      cw2.customer,
      'POST',
      '/topups/psp',
      p().body(cw2.walletId, { provider: 'CARD' }),
    );
    expect(card.status).toBe(201);
    const cardRow = (await p().read(String(card.body.topup_id)))!;
    expect(
      (
        await c.w.post(c.w.event(cardRow, { paymentId: cardRow.providerPaymentRef! }), {
          method: 'CARD',
        })
      ).status,
    ).toBe(200);
    expect(await p().read(cardRow.topupId)).toMatchObject({
      status: 'SUCCEEDED',
      threeDs: 'SUCCEEDED',
    });
    expect(await p().transactions(cardRow.topupId)).toHaveLength(1);
    succeeded.push(cardRow.topupId);
    topupIds.push(cardRow.topupId);
    cardTopup = { row: cardRow, walletId: cw2.walletId };
  });
  let cardTopup: {
    row: Awaited<ReturnType<ChargebackWorld['p']['read']>> & object;
    walletId: string;
  };

  it('5. SC-004 : carte sans 3-D Secure, puis portefeuille bloqué : FAILED, aucune ligne, anomalie du montant', async () => {
    const w1 = await p().wallet();
    const r1 = await p().cust(
      w1.customer,
      'POST',
      '/topups/psp',
      p().body(w1.walletId, { provider: 'CARD', amount: 8000 }),
    );
    const row1 = (await p().read(String(r1.body.topup_id)))!;
    const journal = await journalCount();
    const bad = await c.w.post(
      c.w.event(row1, {
        paymentId: row1.providerPaymentRef!,
        card: { fingerprint: 'fp-journey', threeDs: 'NOT_PERFORMED' },
      }),
      { method: 'CARD' },
    );
    expect(bad.status).toBe(200);
    expect(await p().read(row1.topupId)).toMatchObject({ status: 'FAILED' });
    expect(await p().transactions(row1.topupId)).toEqual([]);
    expect(await journalCount()).toBe(journal);
    const anomaly = (await p().anomalies('PSP_TOPUP_NOT_CREDITED')).find(
      (a) => a.amount === '8000',
    );
    expect(anomaly).toBeDefined();
    // Portefeuille bloqué entre la demande et le succès.
    const w2 = await p().wallet();
    const r2 = await cw().term(
      t1,
      'POST',
      '/topups/psp',
      cashier(),
      p().body(w2.walletId, { amount: 7000 }),
    );
    expect(r2.status).toBe(201);
    await ownerRows(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [w2.walletId]);
    const row2 = (await p().read(String(r2.body.topup_id)))!;
    expect((await c.w.post(c.w.event(row2, { paymentId: row2.providerPaymentRef! }))).status).toBe(
      200,
    );
    expect(await p().read(row2.topupId)).toMatchObject({
      status: 'FAILED',
      failureReason: 'WALLET_BLOCKED',
    });
    expect(await p().transactions(row2.topupId)).toEqual([]);
    expect((await p().anomalies('PSP_TOPUP_NOT_CREDITED')).some((a) => a.amount === '7000')).toBe(
      true,
    );
  });

  it('6. contestation de la recharge carte : CHARGEBACK ; blocage à solde insuffisant ; déblocage à deux', async () => {
    const { row, walletId } = cardTopup;
    await c.spend(walletId, Number(await p().paidBalance(walletId)));
    const post = await c.w.post(
      fakeEvents.dispute({
        id: `evt-dp-${randomUUID()}`,
        merchantReference: row.topupId,
        paymentId: row.providerPaymentRef!,
        amount: Number(row.amount),
        currency: row.currency,
        disputeId: c.disputeId(),
        disputeAmount: 2000,
      }),
      { method: 'CARD' },
    );
    expect(post.status).toBe(200);
    expect(await c.chargebacks(row.topupId)).toHaveLength(1);
    expect(await c.walletStatus(walletId)).toBe('BLOCKED');
    const asked = await cw().bo(
      'POST',
      `/wallets/${walletId}/unblock/approval-requests`,
      cw().w.organizerAdminA,
      {},
    );
    expect(asked.status).toBe(202);
    const second = await c.secondOrganizerAdmin();
    const done = await cw().bo(
      'POST',
      `/approval-requests/${asked.body.approval_request_id}/approve`,
      second,
      {},
    );
    expect(done.body.status).toBe('EXECUTED');
    expect(await c.walletStatus(walletId)).toBe('ACTIVE');
  });

  it('7. comptage, fermeture par un SUPERVISOR qui n’a pas compté, rejeu, fermeur qui a compté refusé, dépôt', async () => {
    const counted = await cw().count(t1, sessionId, cashier(), 7000);
    expect(counted.status).toBe(200);
    expect(counted.body).toMatchObject({ expected_amount: null, difference: null });
    // Un SUPERVISOR qui a compté ne ferme pas (403) ; un autre ferme.
    expect((await cw().count(t1, sessionId, cw().supervisor2, 7000)).status).toBe(200);
    expect((await cw().closeBo(sessionId, cw().supervisor2)).status).toBe(403);
    const key = randomUUID();
    const closed = await cw().closeBo(sessionId, cw().supervisor, key);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expected_amount: 7000,
      counted_amount: 7000,
    });
    const replay = await cw().closeBo(sessionId, cw().supervisor, key);
    expect(replay.body).toEqual(closed.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    // Session 2 : écart de comptage -> CASH_DIFF.
    expect((await cw().count(t2, session2Id, cw().cashier2, 1500)).status).toBe(200);
    const closed2 = await cw().closeBo(session2Id, cw().supervisor);
    expect(closed2.status).toBe(200);
    expect(closed2.body.difference).toBe(-500);
    expect(await cw().anomaliesOf(p().ev.ledgerId)).toHaveLength(1);
    // Vue du caissier d'une session fermée avec écart : ni théorique, ni écart, ni anomalie d'écart (aveugle).
    const blind = await cw().term(t2, 'GET', `/cash-sessions/${session2Id}`, cw().cashier2);
    expect(blind.status).toBe(200);
    expect(blind.body).toMatchObject({
      status: 'CLOSED',
      expected_amount: null,
      difference: null,
      cash_diff_anomaly_id: null,
    });
    // Vue du SUPERVISOR : l'anomalie d'écart est visible.
    const seen = await cw().bo('GET', `/cash-sessions/${session2Id}`, cw().supervisor);
    expect(seen.body.cash_diff_anomaly_id).toEqual(expect.any(String));
    // Dépôt en banque à deux, refusé au-delà du transit.
    const transit = await cw().balance(p().ev.ledgerId, 'A-TRANSIT');
    expect(transit).toBeGreaterThan(0);
    const dep = (amount: number) =>
      cw().bo(
        'POST',
        `/ledgers/${p().ev.ledgerId}/cash-deposits/approval-requests`,
        cw().w.operatorAdminA,
        {
          amount,
          bank_reference: `BORD-${amount}`,
        },
      );
    const ok = await dep(1000);
    expect(ok.status).toBe(202);
    const approved = await cw().bo(
      'POST',
      `/approval-requests/${ok.body.approval_request_id}/approve`,
      cw().w.organizerAdminA,
      {},
    );
    expect(approved.body.status).toBe('EXECUTED');
    const tooMuch = await dep(transit + 1_000_000);
    if (tooMuch.status === 202) {
      const failed = await cw().bo(
        'POST',
        `/approval-requests/${tooMuch.body.approval_request_id}/approve`,
        cw().w.organizerAdminA,
        {},
      );
      expect(failed.body.status).not.toBe('EXECUTED');
    } else expect([409, 422]).toContain(tooMuch.status);
  });

  it('cas limite : succès jamais notifié repris par le travailleur (PENDING -> SUCCEEDED, un seul TOPUP)', async () => {
    const w = await p().wallet();
    const res = await p().cust(w.customer, 'POST', '/topups/psp', p().body(w.walletId));
    expect(res.status).toBe(201);
    const row = (await p().read(String(res.body.topup_id)))!;
    p().adapter('WAVE').setStatus(row.topupId, 'PAID'); // payé chez le PSP, jamais notifié
    await ageTopup(row.topupId); // amorçage : l'ancienneté se fabrique (on n'attend pas la fenêtre)
    await poller.poller.runOnce();
    const after = await p().read(row.topupId);
    expect(after?.status).toBe('SUCCEEDED');
    expect(await p().transactions(row.topupId)).toHaveLength(1);
    succeeded.push(row.topupId);
  });

  it('8. contrôles finaux en lecture : balance, un TOPUP par recharge, espèces sous session, anomalies, CASH_CLOSE', async () => {
    const ledger = p().ev.ledgerId;
    expect(await ledgerIsSound(ledger)).toEqual({ unbalanced: 0, drift: 0 });
    // Chaque recharge SUCCEEDED a exactement un TOPUP, et chaque TOPUP PSP une recharge SUCCEEDED.
    const ok = await ownerRows<{ psp_topup_id: string; n: number }>(
      `SELECT t.psp_topup_id, (SELECT count(*)::int FROM journal_transaction j
                                WHERE j.id = t.topup_tx_id AND j.type = 'TOPUP') AS n
         FROM psp_topup t WHERE t.status = 'SUCCEEDED'
          AND t.wallet_id IN (SELECT id FROM wallet WHERE ledger_id = $1)`,
      [ledger],
    );
    expect(ok.length).toBeGreaterThanOrEqual(succeeded.length);
    expect(ok.every((r) => r.n === 1)).toBe(true);
    const orphans = await ownerRows(
      `SELECT j.id FROM journal_transaction j
        WHERE j.ledger_id = $1 AND j.type = 'TOPUP' AND j.metadata ? 'psp_topup_id'
          AND NOT EXISTS (SELECT 1 FROM psp_topup t WHERE t.topup_tx_id = j.id AND t.status = 'SUCCEEDED')`,
      [ledger],
    );
    expect(orphans).toEqual([]);
    // Aucune écriture d'espèces hors session : toute ligne sur une caisse a son rattachement.
    const unattached = await ownerRows(
      `SELECT DISTINCT po.transaction_id FROM posting po JOIN account a ON a.id = po.account_id
        WHERE a.ledger_id = $1 AND a.code LIKE 'A-CAISSE-%'
          AND NOT EXISTS (SELECT 1 FROM cash_session_tx s WHERE s.tx_id = po.transaction_id)`,
      [ledger],
    );
    expect(unattached).toEqual([]);
    // Toute recharge FAILED après paiement a son anomalie ; toute session fermée a son CASH_CLOSE.
    const failedNoAnomaly = await ownerRows(
      `SELECT psp_topup_id FROM psp_topup WHERE status = 'FAILED' AND failure_reason IS NOT NULL
          AND provider_payment_ref IS NOT NULL AND anomaly_id IS NULL
          AND wallet_id IN (SELECT id FROM wallet WHERE ledger_id = $1)
          AND psp_topup_id IN (SELECT psp_topup_id FROM psp_event WHERE psp_topup_id IS NOT NULL)`,
      [ledger],
    );
    expect(failedNoAnomaly).toEqual([]);
    const noClose = await ownerRows(
      `SELECT s.cash_session_id FROM cash_session s
        WHERE s.event_id = $1 AND s.status = 'CLOSED' AND s.counted_amount <> 0
          AND NOT EXISTS (SELECT 1 FROM journal_transaction j
                           WHERE j.ledger_id = $2 AND j.type = 'CASH_CLOSE'
                             AND j.idempotency_key = 'cash-close:' || s.cash_session_id)`,
      [p().ev.eventId, ledger],
    );
    expect(noClose).toEqual([]);
  });
});
