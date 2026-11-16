// Intégration : guichet de retour enchaîné (mission remboursements 9a, WP06 ; FR-015 à FR-017, SC-004 ; SPECIFICATION
// §7.9 ; contrat `releaseMedia`). `settle_balance` exécute dans UNE transaction : caution, expiration des crédits
// offerts, solde payé rendu en espèces depuis la caisse de la session, espèces dues, puis `release_media`. Tout ou rien.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ledgerIsSound,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const CASH = { method: 'CASH' };

describe('guichet de retour enchaîné', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let noSession: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let otherSession: { sessionId: string; accountId: string; code: string };
  let supervisorEvent: TestPerson;
  const batches = {} as Record<'plain' | 'separate' | 'fromBalance' | 'promo' | 'big', string>;
  let counter = 0;
  const next = () => (counter += 1);
  const pathOf = (m: SeededMedia) => `/v1/media/${m.id}/release`;
  const post = (
    m: SeededMedia,
    body: object,
    options: {
      key?: string;
      person?: TestPerson | null;
      device?: TestDevice;
      token?: string;
      language?: string;
    } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(pathOf(m))
      .set((options.device ?? device).headers)
      .set('Idempotency-Key', options.key ?? randomUUID());
    const person = options.person === undefined ? w.cashierA : options.person;
    if (person) req = req.set('X-Staff-Authorization', `Bearer ${person.token}`);
    if (options.token) req = req.set('X-Approval-Token', options.token);
    if (options.language) req = req.set('Accept-Language', options.language);
    return req.send(body);
  };
  const approval = (who: TestPerson, m: SeededMedia, body: object, act = 'releaseMedia') =>
    w.idp.approvalToken({ subject: who.subject, act, actHash: actHash('POST', pathOf(m), body) });
  const fresh = (batchId: string) =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: w.ops.a,
            batchId,
            kmsKeyRef: w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  /** Bracelet activé (caution payée à part en espèces si le lot en a une) avec `paid` crédités et `owed` dus. */
  const prepare = async (batch: string, paid: number, owed = 0) => {
    const m = await fresh(batch);
    const res = await request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({
        tap: tapBody(m, next()),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
        ...(batch === batches.separate || batch === batches.big ? { deposit_payment: CASH } : {}),
      });
    expect(res.status).toBe(201);
    const walletId = res.body.wallet.wallet_id as string;
    if (paid > 0)
      await withOwner((db) =>
        creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: paid }),
      );
    if (owed > 0) await owe(m, owed);
    return { m, walletId };
  };
  const owe = (m: SeededMedia, amount: number) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -$4::bigint)))`,
        [w.ids.ledgerA, `test-cash-over:${randomUUID()}`, session.code, amount],
      );
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, $4)`,
        [w.ops.a, w.ids.ledgerA, m.id, amount],
      );
    });
  const status = (m: SeededMedia) =>
    rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [m.id]).then(
      (r) => r[0]!.status,
    );
  const deposit = (m: SeededMedia) =>
    rows<{ deposit_status: string }>('SELECT deposit_status FROM media WHERE id = $1', [m.id]).then(
      (r) => r[0]!.deposit_status,
    );
  /** Écritures du grand livre rattachées au bracelet, dans l'ordre d'écriture. */
  const txs = (m: SeededMedia) =>
    rows<{ type: string; idempotency_key: string; id: string; approved_by: string | null }>(
      `SELECT id, type, idempotency_key, approved_by FROM journal_transaction
        WHERE media_id = $1 OR idempotency_key LIKE '%' || $1::text || '%' ORDER BY recorded_at, id`,
      [m.id],
    );
  const txCount = (m: SeededMedia) => txs(m).then((r) => r.length);
  const openDue = (m: SeededMedia) =>
    rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN'`,
      [m.id],
    ).then((r) => r[0]!.n);
  const deskBalance = () =>
    rows<{ b: string }>(
      `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p WHERE p.account_id = $1`,
      [session.accountId],
    ).then((r) => Number(r[0]!.b));
  const sessionTxCount = () =>
    rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM cash_session_tx WHERE cash_session_id = $1',
      [session.sessionId],
    ).then((r) => r[0]!.n);
  const sound = async () =>
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  /** Frais de remboursement de l'événement : une règle ne se modifie pas, on ferme l'ancienne et on pose la neuve. */
  let feeVersion = 1;
  const setRefundFee = (amount: number) =>
    withOwner(async (db) => {
      await db.query(
        `UPDATE fee_rule SET valid_to = now() - interval '2 seconds'
          WHERE scope_type = 'EVENT' AND scope_id = $1 AND basis = 'PER_REFUND' AND valid_to IS NULL`,
        [w.ids.eventA],
      );
      feeVersion += 1;
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           fixed_amount, trigger, valid_from, version)
         VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', $3, 'REALTIME', now() - interval '2 seconds', $4)`,
        [w.ops.a, w.ids.eventA, amount, feeVersion],
      );
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      // Contrat du prestataire et de l'organisateur : la configuration du moteur l'exige pour tout remboursement.
      const contract = await db.query<{ id: string }>(
        `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                               cash_diff_bearer, breakage_organizer_bps)
         VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
        [w.ops.a, w.ids.organizerA],
      );
      await db.query('UPDATE event SET contract_id = $2 WHERE id = $1', [
        w.ids.eventA,
        contract.rows[0]!.id,
      ]);
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      const other = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      noSession = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      session = await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: device.deviceId,
        userId: w.cashierA.userId,
      });
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      otherSession = await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: other.deviceId,
        userId: w.cashierA.userId,
      });
      const base = {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE' as const,
      };
      batches.plain = await createBatch(db, base);
      batches.separate = await createBatch(db, {
        ...base,
        depositAmount: 1000,
        depositMode: 'SEPARATE',
        preloadPromoAmount: 300,
      });
      batches.fromBalance = await createBatch(db, {
        ...base,
        depositAmount: 500,
        depositMode: 'FROM_BALANCE',
      });
      batches.promo = await createBatch(db, { ...base, preloadPromoAmount: 200 });
      batches.big = await createBatch(db, {
        ...base,
        depositAmount: 6000,
        depositMode: 'SEPARATE',
      });
      // Fonds de caisse : la caisse de la session ne rend que ce qu'elle détient (compte sans découvert).
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 500000::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -500000::bigint)))`,
        [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, session.accountId],
      );
      await db.query('UPDATE event SET cash_refund_single_max = 10000 WHERE id = $1', [
        w.ids.eventA,
      ]);
      // Frais de remboursement : règle d'événement, nulle par défaut (les cas à frais la modifient).
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           fixed_amount, trigger, valid_from, version)
         VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', 0, 'REALTIME', now() - interval '1 day', 1)`,
        [w.ops.a, w.ids.eventA],
      );
      supervisorEvent = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('SC-004 : caution, crédits offerts, solde payé et espèces dues rendus en un appel, dans l’ordre ; la caisse de la session sort la somme', async () => {
    const { m, walletId } = await prepare(batches.separate, 2500, 700);
    const sessionBefore = await sessionTxCount();
    const deskBefore = await deskBalance();
    const key = randomUUID();
    const body = {
      tap: tapBody(m, next()),
      settle_balance: CASH,
      cash_session_id: session.sessionId,
    };
    const res = await post(m, body, { key });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      media_id: m.id,
      media_status: 'RELEASED',
      deposit_refund_transaction_id: expect.any(String),
      promo_expiry_transaction_id: expect.any(String),
      balance_refund_transaction_id: expect.any(String),
      cash_to_hand_back: 1000 + 2500 + 700,
      cash_session_id: session.sessionId,
    });
    expect(await status(m)).toBe('RELEASED');
    expect(await deposit(m)).toBe('REFUNDED');
    const written = (await txs(m)).filter((t) =>
      ['DEPOSIT_REFUNDED', 'PROMO_EXPIRY', 'WALLET_REFUND'].includes(t.type),
    );
    expect(written.map((t) => t.type)).toEqual([
      'DEPOSIT_REFUNDED',
      'PROMO_EXPIRY',
      'WALLET_REFUND',
      'WALLET_REFUND',
    ]);
    expect(written.map((t) => t.id)).toEqual([
      res.body.deposit_refund_transaction_id,
      res.body.promo_expiry_transaction_id,
      res.body.balance_refund_transaction_id,
      written[3]!.id,
    ]);
    expect(written[2]!.idempotency_key).toMatch(new RegExp(`^release-refund:${m.id}:`));
    expect(written[3]!.idempotency_key).toMatch(new RegExp(`^release-cash-due:${m.id}:`));
    expect(await openDue(m)).toBe(0);
    expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([{ s: 0 }]);
    // Caisse : trois écritures rattachées à la session, 4 200 sortis (le solde de caisse baisse d'autant).
    expect(await sessionTxCount()).toBe(sessionBefore + 3);
    expect(Math.abs((await deskBalance()) - deskBefore)).toBe(4200);
    expect(
      await rows(`SELECT cash_session_id FROM cash_session_tx WHERE tx_id = $1`, [
        res.body.balance_refund_transaction_id,
      ]),
    ).toEqual([{ cash_session_id: session.sessionId }]);
    expect(
      await rows(
        `SELECT metadata->>'cash_session_id' AS s, device_id IS NOT NULL AS d, created_by FROM journal_transaction WHERE id = $1`,
        [res.body.balance_refund_transaction_id],
      ),
    ).toEqual([{ s: session.sessionId, d: true, created_by: w.cashierA.userId }]);
    expect(
      await rows(
        `SELECT after->>'cash_to_hand_back' AS c, after->>'balance_refund_transaction_id' AS b FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_RELEASED'`,
        [m.id],
      ),
    ).toEqual([{ c: '4200', b: res.body.balance_refund_transaction_id }]);

    // FR-017 : rejeu par la même clé, même réponse, aucune écriture ; autre clé, déjà rendu, aucune écriture.
    const count = await txCount(m);
    const replay = await post(m, body, { key });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(res.body);
    const again = await post(m, { settle_balance: CASH });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ media_status: 'RELEASED', cash_to_hand_back: 0 });
    expect(await txCount(m)).toBe(count);
    await sound();
  });

  it('caution FROM_BALANCE : le recrédit grossit le solde payé, remboursé une seule fois', async () => {
    const { m } = await prepare(batches.fromBalance, 2000);
    const taken = await request(app.getHttpServer())
      .post(`/v1/media/${m.id}/deposit`)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({ tap: tapBody(m, next()) });
    expect(taken.status).toBe(200);
    expect(taken.body.status).toBe('HELD');
    const spendable = await rows<{ s: number }>(
      `SELECT wallet_spendable(wallet_id)::int AS s FROM media WHERE id = $1`,
      [m.id],
    );
    expect(spendable[0]!.s).toBe(1500);
    const res = await post(m, { tap: tapBody(m, next()), settle_balance: CASH });
    expect(res.status).toBe(200);
    // 1 500 + 500 de caution recréditée = 2 000 rendus en espèces ; la caution elle-même ne sort pas de la caisse.
    expect(res.body).toMatchObject({
      media_status: 'RELEASED',
      deposit_refund_transaction_id: expect.any(String),
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: expect.any(String),
      cash_to_hand_back: 2000,
    });
    expect(await deposit(m)).toBe('REFUNDED');
    const refunds = (await txs(m)).filter((t) => t.type === 'WALLET_REFUND');
    expect(refunds).toHaveLength(1);
    await sound();
  });

  it('étapes sans objet : ni promo ni caution ni espèces dues (identifiants null, aucune écriture de montant nul) ; solde nul accepté', async () => {
    const { m } = await prepare(batches.plain, 1200);
    const res = await post(m, { tap: tapBody(m, next()), settle_balance: CASH });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      deposit_refund_transaction_id: null,
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: expect.any(String),
      cash_to_hand_back: 1200,
    });
    expect((await txs(m)).map((t) => t.type)).toEqual(['WALLET_REFUND']);

    const empty = await prepare(batches.plain, 0);
    const none = await post(empty.m, { settle_balance: CASH });
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({
      media_status: 'RELEASED',
      deposit_refund_transaction_id: null,
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: null,
      cash_to_hand_back: 0,
      cash_session_id: session.sessionId,
    });
    expect(await txCount(empty.m)).toBe(0);

    // Crédits offerts seuls (lot avec préchargement) : expirés, rien à rendre en espèces.
    const promo = await prepare(batches.promo, 0);
    const expired = await post(promo.m, { settle_balance: CASH });
    expect(expired.status).toBe(200);
    expect(expired.body).toMatchObject({
      promo_expiry_transaction_id: expect.any(String),
      balance_refund_transaction_id: null,
      cash_to_hand_back: 0,
    });
    expect((await txs(promo.m)).map((t) => t.type).filter((t) => t !== 'PROMO_CREDIT')).toEqual([
      'PROMO_EXPIRY',
    ]);
    await sound();
  });

  it('frais de remboursement : la caisse sort le net (cash_to_hand_back net) ; frais supérieurs ou égaux au solde : 422, tout annulé', async () => {
    await setRefundFee(100);
    try {
      const { m } = await prepare(batches.plain, 2500);
      const res = await post(m, { settle_balance: CASH });
      expect(res.status).toBe(200);
      expect(res.body.cash_to_hand_back).toBe(2400);

      const small = await prepare(batches.separate, 100);
      const before = await txCount(small.m);
      const refused = await post(small.m, { settle_balance: CASH });
      expect(refused.status).toBe(422);
      expect(await status(small.m)).toBe('ACTIVE');
      expect(await deposit(small.m)).toBe('HELD');
      expect(await txCount(small.m)).toBe(before);
    } finally {
      await setRefundFee(0);
    }
    await sound();
  });

  describe('FR-016 : seconde personne au-delà du maximum de l’événement', () => {
    it('sans jeton : 403 APPROVAL_REQUIRED, rien d’écrit (la caution n’est pas rendue) ; jetons invalides : 403 APPROVAL_INVALID ; jeton valide : valideur = sub, usage unique', async () => {
      const { m } = await prepare(batches.separate, 12000);
      const body = { settle_balance: CASH };
      const before = await txCount(m);
      const none = await post(m, body);
      expect(none.status).toBe(403);
      expect(none.body.code).toBe('APPROVAL_REQUIRED');
      expect(await txCount(m)).toBe(before);
      expect(await deposit(m)).toBe('HELD');
      expect(await status(m)).toBe('ACTIVE');

      for (const token of [
        await approval(w.cashierA, m, body), // l'appelant lui-même
        await approval(supervisorEvent, m, body, 'refundCashDue'), // autre action
        await approval(w.organizerAdminA, m, body), // sans le rôle
        await approval(supervisorEvent, m, { ...body, settle_balance: { method: 'CASH', x: 1 } }), // autre corps
        await approval(supervisorEvent, m, { ...body, cash_session_id: session.sessionId }), // autre corps
      ]) {
        const res = await post(m, body, { token });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('APPROVAL_INVALID');
      }
      expect(await txCount(m)).toBe(before);
      expect(await deposit(m)).toBe('HELD');

      const token = await approval(supervisorEvent, m, body);
      const ok = await post(m, body, { token });
      expect(ok.status).toBe(200);
      expect(ok.body.cash_to_hand_back).toBe(13000);
      const refund = (await txs(m)).find((t) => t.id === ok.body.balance_refund_transaction_id);
      expect(refund!.approved_by).toBe(supervisorEvent.userId);
      // Même jeton, autre clé d'idempotence : le bracelet est déjà rendu, rien n'est écrit ni consommé (l'usage unique
      // du jeton lui-même est prouvé par la suite de la garde ; ici aucune seconde écriture n'est possible).
      const reused = await post(m, body, { token });
      expect(reused.body).toMatchObject({ media_status: 'RELEASED', cash_to_hand_back: 0 });
      expect((await txs(m)).filter((t) => t.type === 'WALLET_REFUND')).toHaveLength(1);
      await sound();
    });

    it('au seuil exact : sans jeton ; un jeton présenté mais inutile n’est pas consommé', async () => {
      const exact = await prepare(batches.plain, 10000);
      const res = await post(exact.m, { settle_balance: CASH });
      expect(res.status).toBe(200);
      expect(res.body.cash_to_hand_back).toBe(10000);

      const small = await prepare(batches.plain, 800);
      const body = { settle_balance: CASH };
      const token = await approval(supervisorEvent, small.m, body);
      const ok = await post(small.m, body, { token });
      expect(ok.status).toBe(200);
      const refund = (await txs(small.m)).find((t) => t.type === 'WALLET_REFUND');
      expect(refund!.approved_by).toBeNull();
      // Jeton resté valide : il sert encore pour une opération identique (même corps, même chemin) sur ce bracelet,
      // refusée ici parce que le bracelet est rendu, mais sans « APPROVAL_INVALID » de réutilisation.
      const second = await post(small.m, body, { token });
      expect(second.status).toBe(200);
    });

    it('fractionnement (décision du porteur du 16/11) : le seuil porte sur le cumul caution + solde brut + espèces dues', async () => {
      // 3 x 6000 avec un maximum de 10000 : 18000 sortiraient. Sans jeton : 403, rien d'écrit, caution HELD.
      const { m } = await prepare(batches.big, 6000, 6000);
      const body = { settle_balance: CASH };
      const before = await txCount(m);
      const none = await post(m, body);
      expect(none.status).toBe(403);
      expect(none.body.code).toBe('APPROVAL_REQUIRED');
      expect(await deposit(m)).toBe('HELD');
      expect(await status(m)).toBe('ACTIVE');
      expect(await openDue(m)).toBe(1);
      expect(await txCount(m)).toBe(before);
      const ok = await post(m, body, { token: await approval(supervisorEvent, m, body) });
      expect(ok.status).toBe(200);
      expect(ok.body.cash_to_hand_back).toBe(18000);
      const refund = (await txs(m)).find((t) => t.id === ok.body.balance_refund_transaction_id);
      expect(refund!.approved_by).toBe(supervisorEvent.userId);

      // Cumul exactement égal au maximum (6000 + 2000 + 2000) : sans jeton.
      const exact = await prepare(batches.big, 2000, 2000);
      const passed = await post(exact.m, body);
      expect(passed.status).toBe(200);
      expect(passed.body.cash_to_hand_back).toBe(10000);
      // Un de plus (6000 + 2000 + 2001) : jeton exigé.
      const over = await prepare(batches.big, 2000, 2001);
      expect((await post(over.m, body)).status).toBe(403);
      // Caution seule au-dessus du seuil avec refund_deposit_by : le jeton est exigé aussi.
      await rows(`UPDATE event SET cash_refund_single_max = 5000 WHERE id = $1`, [w.ids.eventA]);
      try {
        const alone = await prepare(batches.big, 0);
        const refused = await post(alone.m, { refund_deposit_by: CASH });
        expect(refused.status).toBe(403);
        expect(await deposit(alone.m)).toBe('HELD');
      } finally {
        await rows(`UPDATE event SET cash_refund_single_max = 10000 WHERE id = $1`, [w.ids.eventA]);
      }
    });

    it('espèces dues au-dessus du seuil : le jeton sert aussi au rendu des espèces dues, consommé une fois', async () => {
      const { m } = await prepare(batches.plain, 1000, 11000);
      const body = { settle_balance: CASH };
      const none = await post(m, body);
      expect(none.status).toBe(403);
      expect(none.body.code).toBe('APPROVAL_REQUIRED');
      expect(await openDue(m)).toBe(1);
      expect((await txs(m)).filter((t) => t.type === 'WALLET_REFUND')).toHaveLength(0);
      const ok = await post(m, body, { token: await approval(supervisorEvent, m, body) });
      expect(ok.status).toBe(200);
      expect(ok.body.cash_to_hand_back).toBe(12000);
      const approved = (await txs(m)).filter((t) => t.approved_by === supervisorEvent.userId);
      // Le cumul dépasse le maximum : le valideur figure sur le solde payé et sur les espèces dues.
      expect(approved).toHaveLength(2);
    });
  });

  describe('FR-017 : un refus à chaque étape annule tout', () => {
    it('caisse du terminal fermée, session citée différente : 409 CONFLICT_STATE, rien d’écrit', async () => {
      const { m } = await prepare(batches.separate, 1500, 400);
      const before = await txCount(m);
      const closed = await post(m, { settle_balance: CASH }, { device: noSession });
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('CONFLICT_STATE');
      const other = await post(m, {
        settle_balance: CASH,
        cash_session_id: otherSession.sessionId,
      });
      expect(other.status).toBe(409);
      expect(other.body.rule).toBe('cash.session_mismatch');
      expect(await txCount(m)).toBe(before);
      expect(await deposit(m)).toBe('HELD');
      expect(await openDue(m)).toBe(1);
      expect(await status(m)).toBe('ACTIVE');
    });

    it('pendant EDGE : 409 DEBIT_AUTHORITY_EDGE avant toute écriture', async () => {
      const { m } = await prepare(batches.separate, 1500);
      const before = await txCount(m);
      await rows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [w.ids.ledgerA]);
      try {
        const res = await post(m, { settle_balance: CASH });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DEBIT_AUTHORITY_EDGE');
      } finally {
        await rows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [w.ids.ledgerA]);
      }
      expect(await txCount(m)).toBe(before);
      expect(await deposit(m)).toBe('HELD');
    });

    it('bracelet suspendu : aucun solde ne sort de la caisse ; autre prestataire : 404', async () => {
      const { m } = await prepare(batches.plain, 900);
      await rows(
        `SELECT set_config('app.operator_id', $1, false), suspend_media($2, 'perdu', $3)`,
        [w.ops.a, m.id, w.cashierA.userId],
      );
      const res = await post(m, { settle_balance: CASH });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MEDIA_STATE_INVALID');
      expect(await txCount(m)).toBe(0);
      expect(await status(m)).toBe('SUSPENDED');
      const foreign = await post(m, { settle_balance: CASH }, { person: w.cashierB });
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain(m.id);
    });

    it('solde d’une autre devise (autre grand livre) : release.balance, tout est annulé (caution HELD, aucune écriture)', async () => {
      const { m } = await prepare(batches.separate, 1500);
      await withOwner(async (db) => {
        const eventB = randomUUID();
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
           SELECT $1, operator_id, organizer_id, 'Événement EUR', 'EUR', timezone, jurisdiction_id, funds_holder FROM event WHERE id = $2`,
          [eventB, w.ids.eventA],
        );
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        const ledger = (
          await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
        ).rows[0]!.ledger;
        const walletId = randomUUID();
        await db.query(
          'INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES ($1, $2, $3, $4)',
          [walletId, w.ops.a, ledger, 'ACTIVE'],
        );
        for (const [suffix, purpose] of [
          ['P', 'WALLET_PAID'],
          ['X', 'WALLET_PROMO'],
        ] as const)
          await db.query(
            `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
             VALUES ($1, $2, $3, 'CLAIM', $4, $5, 'C')`,
            [w.ops.a, ledger, `L-WAL-${walletId}-${suffix}`, purpose, walletId],
          );
        await creditWallet(db, { operatorId: w.ops.a, ledgerId: ledger, walletId, amount: 700 });
        await db.query(
          `INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
           SELECT $1, id, $2, 'EUR', token_hash FROM media WHERE id = $3`,
          [w.ops.a, walletId, m.id],
        );
      });
      const before = await txCount(m);
      const res = await post(m, { settle_balance: CASH });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'BALANCE_OUTSTANDING', rule: 'release.balance' });
      expect(await deposit(m)).toBe('HELD');
      expect(await status(m)).toBe('ACTIVE');
      expect(await txCount(m)).toBe(before);
    });

    it('lecture d’un autre bracelet : refusée ; moyen autre que CASH : 400 ; rien d’écrit', async () => {
      const { m } = await prepare(batches.plain, 900);
      const other = await prepare(batches.plain, 0);
      const wrong = await post(m, { tap: tapBody(other.m, next()), settle_balance: CASH });
      expect(wrong.status).toBe(422);
      expect(wrong.body.rule).toBe('return.wrong_media');
      const wave = await post(m, { settle_balance: { method: 'WAVE' } });
      expect(wave.status).toBe(400);
      expect(await txCount(m)).toBe(0);
    });

    it('refund_deposit_by seul : la caution est rendue puis les contrôles actuels s’appliquent (solde non nul : 409 BALANCE_OUTSTANDING, caution non rendue car tout est annulé)', async () => {
      const withBalance = await prepare(batches.separate, 1500);
      const before = await txCount(withBalance.m);
      const refused = await post(withBalance.m, { refund_deposit_by: CASH });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('BALANCE_OUTSTANDING');
      expect(await deposit(withBalance.m)).toBe('HELD');
      expect(await txCount(withBalance.m)).toBe(before);

      const empty = await prepare(batches.big, 0);
      const ok = await post(empty.m, { refund_deposit_by: CASH });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        deposit_refund_transaction_id: expect.any(String),
        balance_refund_transaction_id: null,
        cash_to_hand_back: 6000,
      });
      expect(await deposit(empty.m)).toBe('REFUNDED');
    });

    it('appels simultanés (même clé, puis clés différentes) : une seule série d’écritures', async () => {
      const { m } = await prepare(batches.separate, 2000, 300);
      const key = randomUUID();
      const body = { settle_balance: CASH };
      const same = await Promise.all(Array.from({ length: 5 }, () => post(m, body, { key })));
      for (const res of same) expect([200, 409]).toContain(res.status);
      expect(same.filter((r) => r.status === 200).length).toBeGreaterThan(0);
      const other = await Promise.all(Array.from({ length: 5 }, () => post(m, body)));
      for (const res of other) expect(res.status).toBe(200);
      const written = await txs(m);
      expect(written.filter((t) => t.idempotency_key.startsWith('release-refund:'))).toHaveLength(
        1,
      );
      expect(written.filter((t) => t.idempotency_key.startsWith('release-cash-due:'))).toHaveLength(
        1,
      );
      expect(written.filter((t) => t.type === 'DEPOSIT_REFUNDED')).toHaveLength(1);
      await sound();
    });
  });
});
