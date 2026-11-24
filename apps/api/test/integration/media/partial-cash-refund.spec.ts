// Intégration : rendu partiel en espèces au guichet (mission 9c, WP05 ; FR-001 à FR-013, SC-004 ; contrat
// `refundPartialCash`). Un montant choisi du solde payé sort de la caisse de la session, le bracelet reste actif, les
// crédits offerts et la caution ne bougent pas. Permis seulement si le prestataire l'autorise ET si l'événement
// l'active (les deux lus à chaque rendu) ; seconde personne au-delà du maximum de l'événement, sur le cumul du jour
// du portefeuille (tous ses bracelets).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
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

jest.setTimeout(240_000);

const DEFAULT_POLICY = { open: true, fee_amount: 0, minimum_amount: 0, channels: ['CASH'] };

describe('rendu partiel en espèces au guichet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let noSession: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let supervisorEvent: TestPerson;
  const batches = {} as Record<'plain' | 'rich', string>;
  let counter = 0;
  const next = () => (counter += 1);
  const pathOf = (m: SeededMedia) => `/v1/media/${m.id}/partial-cash-refunds`;
  const body = (m: SeededMedia, amount: number) => ({ tap: tapBody(m, next()), amount });
  const post = (
    m: SeededMedia,
    payload: object,
    options: {
      key?: string;
      person?: TestPerson | null;
      device?: TestDevice;
      token?: string;
    } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(pathOf(m))
      .set((options.device ?? device).headers)
      .set('Idempotency-Key', options.key ?? randomUUID());
    const person = options.person === undefined ? w.cashierA : options.person;
    if (person) req = req.set('X-Staff-Authorization', `Bearer ${person.token}`);
    if (options.token) req = req.set('X-Approval-Token', options.token);
    return req.send(payload);
  };
  const approval = (who: TestPerson, m: SeededMedia, payload: object) =>
    w.idp.approvalToken({
      subject: who.subject,
      act: 'refundPartialCash',
      actHash: actHash('POST', pathOf(m), payload),
    });
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
  /** Bracelet activé (caution payée à part en espèces si le lot en a une) avec `paid` crédités. */
  const prepare = async (batch: string, paid: number) => {
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
        ...(batch === batches.rich ? { deposit_payment: { method: 'CASH' } } : {}),
      });
    expect(res.status).toBe(201);
    const walletId = res.body.wallet.wallet_id as string;
    if (paid > 0)
      await withOwner((db) =>
        creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: paid }),
      );
    return { m, walletId };
  };
  const status = (m: SeededMedia) =>
    rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [m.id]).then(
      (r) => r[0]!.status,
    );
  const txs = (walletId: string, type = 'WALLET_REFUND') =>
    rows<{ id: string; approved_by: string | null; metadata: Record<string, unknown> }>(
      `SELECT DISTINCT t.id, t.approved_by, t.metadata, t.recorded_at FROM journal_transaction t
         JOIN posting p ON p.transaction_id = t.id AND p.ledger_id = t.ledger_id
         JOIN account a ON a.id = p.account_id
        WHERE a.wallet_id = $1 AND t.type = $2 ORDER BY t.recorded_at, t.id`,
      [walletId, type],
    );
  const balanceOf = (walletId: string, purpose: 'WALLET_PAID' | 'WALLET_PROMO') =>
    rows<{ b: string }>(
      `SELECT coalesce(-sum(ab.balance), 0)::text AS b FROM account a
         JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = $1 AND a.purpose = $2`,
      [walletId, purpose],
    ).then((r) => Number(r[0]!.b));
  const deskBalance = () =>
    rows<{ b: string }>(
      `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p WHERE p.account_id = $1`,
      [session.accountId],
    ).then((r) => Number(r[0]!.b));
  const sound = async () =>
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });

  /** Frais de remboursement de l'événement : on ferme l'ancienne règle et on pose la neuve. */
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
  /** Réglages en cascade : nouvelle version du niveau (la dernière dont la date d'effet est passée fait foi). */
  const versions = { OPERATOR: 0, ORGANIZER: 0 };
  const setSettings = (
    level: 'OPERATOR' | 'ORGANIZER',
    settings: Record<string, unknown>,
  ): Promise<void> =>
    withOwner(async (db) => {
      versions[level] += 1;
      await db.query(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, $2, $3, $4, clock_timestamp() - interval '1 second', $5)`,
        [
          w.ops.a,
          level,
          level === 'OPERATOR' ? w.ops.a : w.ids.organizerA,
          versions[level],
          JSON.stringify(settings),
        ],
      );
      await db.query('SELECT pg_sleep(0.01)');
    });
  const setAllowed = (value: boolean) =>
    setSettings('OPERATOR', { cash_partial_refund_allowed: value });
  const setEnabled = (value: boolean) =>
    rows('UPDATE event SET cash_partial_refund_enabled = $2 WHERE id = $1', [w.ids.eventA, value]);
  const setPolicy = (policy: object) => setSettings('ORGANIZER', { refund_policy: policy });
  const setSingleMax = (value: number) =>
    rows('UPDATE event SET cash_refund_single_max = $2 WHERE id = $1', [w.ids.eventA, value]);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
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
      const base = {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE' as const,
      };
      batches.plain = await createBatch(db, base);
      batches.rich = await createBatch(db, {
        ...base,
        depositAmount: 1000,
        depositMode: 'SEPARATE',
        preloadPromoAmount: 300,
      });
      // Fonds de caisse : la caisse de la session ne rend que ce qu'elle détient.
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 5000000::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -5000000::bigint)))`,
        [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, session.accountId],
      );
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
    await setAllowed(true);
    await setEnabled(true);
    await setSingleMax(50000);
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('US1 : rendre une partie du solde, bracelet gardé', () => {
    it('anonyme, solde 20 000, rendu de 5 000 avec 200 de frais : débit brut, espèces nettes, bracelet actif, crédits offerts et caution intacts', async () => {
      await setRefundFee(200);
      try {
        const { m, walletId } = await prepare(batches.rich, 20000);
        const promoBefore = await balanceOf(walletId, 'WALLET_PROMO');
        const depositBefore = await rows(
          'SELECT deposit_status, deposit_held FROM media WHERE id = $1',
          [m.id],
        );
        expect(promoBefore).toBe(300);
        const deskBefore = await deskBalance();
        const res = await post(m, body(m, 5000));
        expect(res.status).toBe(201);
        expect(contractViolations('PartialCashRefund', res.body)).toEqual([]);
        expect(res.body).toMatchObject({
          media_id: m.id,
          wallet_id: walletId,
          amount_debited: 5000,
          fee: 200,
          cash_handed: 4800,
          paid_balance_after: 15000,
          day_cumulative: 5000,
          approved_by: null,
          cash_session_id: session.sessionId,
        });
        expect(await status(m)).toBe('ACTIVE');
        expect(
          await rows('SELECT 1 FROM media_assignment WHERE media_id = $1 AND released_at IS NULL', [
            m.id,
          ]),
        ).toHaveLength(1);
        expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(15000);
        expect(await balanceOf(walletId, 'WALLET_PROMO')).toBe(promoBefore);
        expect(
          await rows('SELECT deposit_status, deposit_held FROM media WHERE id = $1', [m.id]),
        ).toEqual(depositBefore);
        // Espèces : 4 800 sortent de la caisse de la session, l'écriture lui est rattachée et porte la marque.
        expect(await deskBalance()).toBe(deskBefore - 4800);
        const [tx] = await txs(walletId);
        expect(tx!.id).toBe(res.body.transaction_id);
        expect(tx!.metadata).toMatchObject({
          cash_session_id: session.sessionId,
          partial_cash_refund: 'true',
          media_id: m.id,
        });
        expect(
          await rows('SELECT cash_session_id FROM cash_session_tx WHERE tx_id = $1', [tx!.id]),
        ).toEqual([{ cash_session_id: session.sessionId }]);
        const audit = await rows<{ actor_id: string; after: Record<string, unknown> }>(
          `SELECT actor_id, after FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_PARTIAL_CASH_REFUNDED'`,
          [m.id],
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]!.actor_id).toBe(w.cashierA.userId);
        expect(audit[0]!.after).toMatchObject({
          amount_debited: 5000,
          fee: 200,
          cash_handed: 4800,
          cash_session_id: session.sessionId,
        });
        await sound();
      } finally {
        await setRefundFee(0);
      }
    });

    it('tout le solde payé peut être rendu ; le bracelet reste actif, solde nul', async () => {
      const { m, walletId } = await prepare(batches.plain, 3000);
      const res = await post(m, body(m, 3000));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ cash_handed: 3000, paid_balance_after: 0, fee: 0 });
      expect(await status(m)).toBe('ACTIVE');
      expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(0);
      // Plus rien à rendre : le solde payé est nul.
      expect((await post(m, body(m, 1))).body.code).toBe('INSUFFICIENT_FUNDS');
      await sound();
    });

    it('passage par tap_id : accepté ; tap_id ET tap, ni l’un ni l’autre, ou champ inconnu : 400, rien d’écrit', async () => {
      const { m, walletId } = await prepare(batches.plain, 4000);
      const tap = await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()));
      expect((await post(m, { tap_id: tap.body.tap_id, amount: 1000 })).status).toBe(201);
      for (const bad of [
        { amount: 1000 },
        { tap_id: 1, tap: tapBody(m, next()), amount: 1000 },
        { tap: tapBody(m, next()), amount: 1000, cash_session_id: session.sessionId },
        { tap: tapBody(m, next()) },
        { tap: tapBody(m, next()), amount: 10.5 },
        { tap: tapBody(m, next()), amount: '1000' },
      ]) {
        const res = await post(m, bad);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      expect(await txs(walletId)).toHaveLength(1);
    });

    it('rejeu de la même clé : même réponse, une seule sortie d’espèces (FR-011)', async () => {
      const { m, walletId } = await prepare(batches.plain, 9000);
      const payload = body(m, 2000);
      const key = randomUUID();
      const deskBefore = await deskBalance();
      const first = await post(m, payload, { key });
      const again = await post(m, payload, { key });
      expect(first.status).toBe(201);
      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await txs(walletId)).toHaveLength(1);
      expect(await deskBalance()).toBe(deskBefore - 2000);
      expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(7000);
      await sound();
    });
  });

  describe('US2 : le prestataire autorise, l’organisateur active (lus à chaque rendu)', () => {
    const expectDisabled = async (m: SeededMedia, walletId: string) => {
      const before = await txs(walletId);
      const res = await post(m, body(m, 1000));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('REFUND_NOT_ALLOWED');
      expect(res.body.reason).toBe('PARTIAL_CASH_REFUND_DISABLED');
      expect(await txs(walletId)).toHaveLength(before.length);
      expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(6000);
    };

    it('prestataire n’autorise pas ; événement non activé ; autorisation retirée après l’activation : 422 REFUND_NOT_ALLOWED + raison', async () => {
      const { m, walletId } = await prepare(batches.plain, 6000);
      try {
        await setAllowed(false);
        await expectDisabled(m, walletId);
        await setAllowed(true);
        await setEnabled(false);
        await expectDisabled(m, walletId);
        // Activé, puis l'autorisation est retirée : l'événement reste activé, le rendu est refusé.
        await setEnabled(true);
        expect((await post(m, body(m, 1000))).status).toBe(201);
        await setAllowed(false);
        expect(
          await rows<{ v: boolean }>(
            'SELECT cash_partial_refund_enabled AS v FROM event WHERE id = $1',
            [w.ids.eventA],
          ),
        ).toEqual([{ v: true }]);
        const before = (await txs(walletId)).length;
        const res = await post(m, body(m, 1000));
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({
          code: 'REFUND_NOT_ALLOWED',
          reason: 'PARTIAL_CASH_REFUND_DISABLED',
        });
        expect(await txs(walletId)).toHaveLength(before);
      } finally {
        await setAllowed(true);
        await setEnabled(true);
      }
      expect((await post(m, body(m, 1000))).status).toBe(201);
    });

    it('politique de remboursement fermée ou sans canal CASH : même refus ; montant sous le minimum : 422 AMOUNT_OUT_OF_RANGE', async () => {
      const { m, walletId } = await prepare(batches.plain, 6000);
      try {
        for (const policy of [
          { ...DEFAULT_POLICY, open: false },
          { ...DEFAULT_POLICY, channels: ['MOBILE_MONEY'] },
        ]) {
          await setPolicy(policy);
          const res = await post(m, body(m, 1000));
          expect(res.status).toBe(422);
          expect(res.body).toMatchObject({
            code: 'REFUND_NOT_ALLOWED',
            reason: 'PARTIAL_CASH_REFUND_DISABLED',
          });
        }
        await setPolicy({ ...DEFAULT_POLICY, minimum_amount: 1000 });
        const low = await post(m, body(m, 999));
        expect(low.status).toBe(422);
        expect(low.body.code).toBe('AMOUNT_OUT_OF_RANGE');
        expect((await post(m, body(m, 1000))).status).toBe(201);
      } finally {
        await setPolicy(DEFAULT_POLICY);
      }
      expect(await txs(walletId)).toHaveLength(1);
    });
  });

  describe('refus', () => {
    it('montant nul, négatif ou inférieur ou égal aux frais : 422 AMOUNT_OUT_OF_RANGE ; au-dessus du solde : 422 INSUFFICIENT_FUNDS', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      await setRefundFee(300);
      try {
        for (const amount of [0, -5, 300, 299]) {
          const res = await post(m, body(m, amount));
          expect(res.status).toBe(422);
          expect(res.body.code).toBe('AMOUNT_OUT_OF_RANGE');
        }
        const over = await post(m, body(m, 2001));
        expect(over.status).toBe(422);
        expect(over.body.code).toBe('INSUFFICIENT_FUNDS');
        // Au-dessus du solde ET du maximum : le refus de solde passe avant la seconde personne.
        const huge = await post(m, body(m, 60000));
        expect(huge.status).toBe(422);
        expect(huge.body.code).toBe('INSUFFICIENT_FUNDS');
        expect((await post(m, body(m, 301))).status).toBe(201);
      } finally {
        await setRefundFee(0);
      }
      expect(await txs(walletId)).toHaveLength(1);
    });

    it('terminal sans session de caisse ouverte : 409 CONFLICT_STATE, aucune écriture', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      const res = await post(m, body(m, 500), { device: noSession });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT_STATE');
      expect(await txs(walletId)).toHaveLength(0);
    });

    it('lecture d’un autre bracelet : 422 return.wrong_media ; bracelet suspendu (lecture citée) : 409 MEDIA_STATE_INVALID', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      const other = await prepare(batches.plain, 0);
      const wrong = await post(m, { tap: tapBody(other.m, next()), amount: 500 });
      expect(wrong.status).toBe(422);
      expect(wrong.body.rule).toBe('return.wrong_media');
      const tap = await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()));
      await rows(
        `SELECT set_config('app.operator_id', $1, false), suspend_media($2, 'perdu', $3)`,
        [w.ops.a, m.id, w.cashierA.userId],
      );
      const res = await post(m, { tap_id: tap.body.tap_id, amount: 500 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MEDIA_STATE_INVALID');
      expect(await txs(walletId)).toHaveLength(0);
      expect(await status(m)).toBe('SUSPENDED');
    });

    it('portefeuille bloqué : 422 WALLET_BLOCKED ; pendant EDGE : 409 DEBIT_AUTHORITY_EDGE ; rien d’écrit', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      await rows(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [walletId]);
      try {
        const blocked = await post(m, body(m, 500));
        expect(blocked.status).toBe(422);
        expect(blocked.body.code).toBe('WALLET_BLOCKED');
      } finally {
        await rows(`UPDATE wallet SET status = 'ACTIVE' WHERE id = $1`, [walletId]);
      }
      await rows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [w.ids.ledgerA]);
      try {
        const edge = await post(m, body(m, 500));
        expect(edge.status).toBe(409);
        expect(edge.body.code).toBe('DEBIT_AUTHORITY_EDGE');
        // Avant la session de caisse : sans session, le refus reste celui de la passerelle.
        const edgeNoSession = await post(m, body(m, 500), { device: noSession });
        expect(edgeNoSession.status).toBe(409);
        expect(edgeNoSession.body.code).toBe('DEBIT_AUTHORITY_EDGE');
      } finally {
        await rows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [w.ids.ledgerA]);
      }
      expect(await txs(walletId)).toHaveLength(0);
      expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(2000);
    });

    it('rôle sans droit de guichet (organisateur) : 403 ; personne d’un autre prestataire : 404 sans fuite ; sans personne : 401', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      const noRole = await post(m, body(m, 500), { person: w.organizerAdminA });
      expect(noRole.status).toBe(403);
      const foreign = await post(m, body(m, 500), { person: w.cashierB });
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain(m.id);
      expect((await post(m, body(m, 500), { person: null })).status).toBe(401);
      expect(await txs(walletId)).toHaveLength(0);
    });

    it('phase de l’événement refusée (comme le guichet de retour) : 422, rien d’écrit ; phase permise (clôture) : accepté', async () => {
      const { m, walletId } = await prepare(batches.plain, 2000);
      // `set_event_status` ne revient pas en arrière : le trigger est neutralisé pour la seule connexion du test.
      const setPhase = (phase: string) =>
        withOwner(async (db) => {
          await db.query(`SET session_replication_role = replica`);
          await db.query('UPDATE event SET status = $2 WHERE id = $1', [w.ids.eventA, phase]);
        });
      try {
        await setPhase('DRAFT');
        const res = await post(m, body(m, 500));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(await txs(walletId)).toHaveLength(0);
        await setPhase('CLOSING');
        expect((await post(m, body(m, 500))).status).toBe(201);
      } finally {
        await setPhase('LIVE');
      }
    });
  });

  describe('US3 : seconde personne au-delà du maximum, sur le cumul du jour du portefeuille', () => {
    it('deux rendus successifs : le second dépasse le maximum et exige le jeton (la marque est lue par le cumul) ; au seuil exact : sans jeton', async () => {
      const { m, walletId } = await prepare(batches.plain, 120000);
      const first = await post(m, body(m, 30000));
      expect(first.status).toBe(201);
      expect(first.body.day_cumulative).toBe(30000);
      const payload = body(m, 25000);
      const none = await post(m, payload);
      expect(none.status).toBe(403);
      expect(none.body.code).toBe('APPROVAL_REQUIRED');
      // Jeton de l'auteur lui-même : refusé.
      const self = await post(m, payload, { token: await approval(w.cashierA, m, payload) });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('APPROVAL_INVALID');
      expect(await txs(walletId)).toHaveLength(1);
      const ok = await post(m, payload, { token: await approval(supervisorEvent, m, payload) });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ approved_by: supervisorEvent.userId, day_cumulative: 55000 });
      const written = await txs(walletId);
      expect(written).toHaveLength(2);
      expect(written[1]!.approved_by).toBe(supervisorEvent.userId);
      // Le cumul est à 55 000 : un rendu de 1 dépasse encore.
      expect((await post(m, body(m, 1))).body.code).toBe('APPROVAL_REQUIRED');
      expect(await balanceOf(walletId, 'WALLET_PAID')).toBe(65000);
      await sound();
    });

    it('au seuil exact (cumul = maximum) : sans jeton ; un cent de plus : jeton exigé', async () => {
      const { m } = await prepare(batches.plain, 80000);
      expect((await post(m, body(m, 50000))).status).toBe(201);
      expect((await post(m, body(m, 1))).status).toBe(403);
    });

    it('fractionnement entre deux bracelets du même portefeuille : le cumul est celui du portefeuille', async () => {
      const a = await prepare(batches.plain, 100000);
      // Second bracelet actif sur le même portefeuille : l'affectation du neuf est déplacée vers celui de `a`.
      const b = await prepare(batches.plain, 0);
      await rows(
        'UPDATE media_assignment SET wallet_id = $2 WHERE media_id = $1 AND released_at IS NULL',
        [b.m.id, a.walletId],
      );
      expect((await post(a.m, body(a.m, 30000))).status).toBe(201);
      const payload = body(b.m, 25000);
      const split = await post(b.m, payload);
      expect(split.status).toBe(403);
      expect(split.body.code).toBe('APPROVAL_REQUIRED');
      const ok = await post(b.m, payload, { token: await approval(supervisorEvent, b.m, payload) });
      expect(ok.status).toBe(201);
      expect(ok.body.day_cumulative).toBe(55000);
      expect(ok.body.approved_by).toBe(supervisorEvent.userId);
      // Un autre portefeuille a son propre cumul : 30 000 passent sans jeton.
      const c = await prepare(batches.plain, 40000);
      expect((await post(c.m, body(c.m, 30000))).status).toBe(201);
    });
  });

  describe('SC-004 : la caisse de la session reste juste', () => {
    it('après des rendus partiels, un comptage juste ferme sans écart (théorique = fonds - espèces rendues)', async () => {
      const desk = await withOwner((db) =>
        createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA, kind: 'TOPUP' }),
      );
      const own = await withOwner((db) =>
        openCashSession(db, {
          operatorId: w.ops.a,
          deviceId: desk.deviceId,
          userId: w.cashierA.userId,
        }),
      );
      await withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        await db.query(
          `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
             jsonb_build_object('account_id', $3::uuid, 'amount', 100000::bigint),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -100000::bigint)))`,
          [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, own.accountId],
        );
      });
      await setRefundFee(100);
      let handed = 0;
      try {
        const { m } = await prepare(batches.plain, 20000);
        for (const amount of [4000, 2500]) {
          const res = await post(m, body(m, amount), { device: desk });
          expect(res.status).toBe(201);
          handed += res.body.cash_handed as number;
        }
      } finally {
        await setRefundFee(0);
      }
      expect(handed).toBe(6300);
      const counted = 100000 - handed;
      const closing = await withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        await db.query('SELECT count_cash_session($1, $2, $3, $4)', [
          own.sessionId,
          counted,
          w.cashierA.userId,
          desk.deviceId,
        ]);
        return (
          await db.query<{ counted_amount: string; expected_amount: string }>(
            'SELECT counted_amount::text, expected_amount::text FROM begin_cash_close($1, $2)',
            [own.sessionId, w.supervisorA.userId],
          )
        ).rows[0]!;
      });
      expect(Number(closing.expected_amount)).toBe(counted);
      expect(Number(closing.counted_amount)).toBe(Number(closing.expected_amount));
    });
  });
});
