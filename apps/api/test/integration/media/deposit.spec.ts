// Intégration : caution d'un bracelet (FR-022, FR-023 ; SPECIFICATION §7.9 ; contrat `takeDeposit`, `refundDeposit`).
// Prélevée sur le solde payé (due si le solde ne suffit pas) ou payée à part en espèces, au compte de caisse du
// terminal — que cette mission ne crée pas (décision du porteur n° 10) : sans caisse ouverte, refus.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DepositService } from '../../../src/media/lifecycle/deposit.service';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  createBatch, createMediaWorld, creditWallet, goLive, ledgerIsSound, openCashDesk, ownerRows as rows, seedPersonalizedMedia, tapBody, type MediaWorld, type SeededMedia,
} from '../../support/media-fixtures';

describe('caution d’un bracelet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice; // terminal avec une caisse ouverte
  let noDesk: TestDevice; // terminal sans caisse
  let fromBalance: string;
  let separate: string;
  let cashDesk: string;
  let counter = 0;
  const next = () => (counter += 1);
  const post = (who: { device: TestDevice; person: TestPerson | null }, path: string, body: object = {}, key: string = randomUUID(), language?: string) => {
    let req = request(app.getHttpServer()).post(path).set(who.device.headers).set('Idempotency-Key', key);
    if (who.person) req = req.set('Authorization', `Bearer ${who.person.token}`);
    if (language) req = req.set('Accept-Language', language);
    return req.send(body);
  };
  const desk = (d: TestDevice = device) => ({ device: d, person: w.cashierA });
  const fresh = (batchId: string) => withOwner(async (db) => (await seedPersonalizedMedia(db, { operatorId: w.ops.a, batchId, kmsKeyRef: w.keyRef.a, count: 1 }))[0]!);
  const activate = async (m: SeededMedia, overrides: Record<string, unknown> = {}, who = desk()) =>
    post(who, '/v1/media/activations', { tap: tapBody(m, next()), channel: 'DESK', occurred_at: new Date().toISOString(), ...overrides });
  const state = (m: SeededMedia) => rows<{ deposit_status: string; held: number }>('SELECT deposit_status, deposit_held::int AS held FROM media WHERE id = $1', [m.id]).then((r) => r[0]!);
  const balance = (code: string) =>
    rows<{ b: string }>(`SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id WHERE a.ledger_id = $1 AND a.code = $2`, [w.ids.ledgerA, code]).then((r) => Number(r[0]!.b));
  const sound = async () => expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      noDesk = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      cashDesk = await openCashDesk(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, organizerId: w.ids.organizerA, serial: device.serial });
      fromBalance = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, eventId: w.ids.eventA, status: 'ACTIVE', depositAmount: 2000, depositMode: 'FROM_BALANCE' });
      separate = await createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, eventId: w.ids.eventA, status: 'ACTIVE', depositAmount: 1000, depositMode: 'SEPARATE' });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('prélevée sur le solde (FROM_BALANCE)', () => {
    it('solde insuffisant à l’activation : la caution reste due ; elle est prise après un crédit payé, dans une transaction à part', async () => {
      const m = await fresh(fromBalance);
      const activated = await activate(m);
      expect(activated.status).toBe(201);
      expect(activated.body.deposit).toEqual({ status: 'DUE', amount: 2000, mode: 'FROM_BALANCE', transaction_id: null });
      expect(await state(m)).toEqual({ deposit_status: 'DUE', held: 0 });
      const walletId = activated.body.wallet.wallet_id as string;

      // Toujours due tant que le solde ne suffit pas.
      const still = await post(desk(), `/v1/media/${m.id}/deposit`);
      expect(still.status).toBe(200);
      expect(still.body).toEqual({ status: 'DUE', amount: 2000, mode: 'FROM_BALANCE', transaction_id: null });

      await withOwner((db) => creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: 5000 }));
      // Le service que les missions de recharge appelleront après chaque crédit payé.
      const deposits = app.get(DepositService, { strict: false });
      const taken = await deposits.takeDueDeposit(w.ops.a, m.id, { actorId: null, actorRole: null, origin: 'test', requestId: null });
      expect(taken).toEqual({ status: 'HELD', amount: 2000, mode: 'FROM_BALANCE', transaction_id: expect.any(String) });
      expect(await state(m)).toEqual({ deposit_status: 'HELD', held: 2000 });
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([{ s: 3000 }]);
      expect(await rows(`SELECT type, source FROM journal_transaction WHERE id = $1`, [taken.transaction_id])).toEqual([{ type: 'DEPOSIT_TAKEN', source: 'ONLINE' }]);
      // Rappelé une seconde fois : rien de plus.
      expect(await deposits.takeDueDeposit(w.ops.a, m.id, { actorId: null, actorRole: null, origin: 'test', requestId: null })).toMatchObject({ status: 'HELD', transaction_id: taken.transaction_id });
      expect(await rows(`SELECT count(*)::int AS n FROM journal_transaction WHERE type = 'DEPOSIT_TAKEN' AND idempotency_key LIKE $1`, [`deposit:${m.id}:%`])).toEqual([{ n: 1 }]);
      await sound();

      // Rendu : recréditée sur le portefeuille, une seule fois, sur présentation du bracelet.
      const refundKey = randomUUID();
      const body = { tap: tapBody(m, next()) };
      const refunded = await post(desk(), `/v1/media/${m.id}/deposit/refund`, body, refundKey);
      expect(refunded.status).toBe(200);
      expect(refunded.body).toEqual({ status: 'REFUNDED', amount: 2000, mode: 'FROM_BALANCE', transaction_id: expect.any(String) });
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([{ s: 5000 }]);
      const replay = await post(desk(), `/v1/media/${m.id}/deposit/refund`, body, refundKey);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(refunded.body);
      const again = await post(desk(), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next()) });
      expect(again.body).toMatchObject({ status: 'REFUNDED' });
      expect(await rows(`SELECT count(*)::int AS n FROM journal_transaction WHERE type = 'DEPOSIT_REFUNDED' AND idempotency_key LIKE $1`, [`deposit-refund:${m.id}:%`])).toEqual([{ n: 1 }]);
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([{ s: 5000 }]);
      // La lecture présentée a servi à cette écriture, et à elle seule.
      expect(await rows(`SELECT count(*)::int AS n FROM media_tap WHERE media_id = $1 AND transaction_id = $2`, [m.id, refunded.body.transaction_id])).toEqual([{ n: 1 }]);
      await sound();
    });

    it('solde suffisant : la caution est prise par la route du guichet, et la lecture citée est consommée', async () => {
      const m = await fresh(fromBalance);
      const activated = await activate(m);
      const walletId = activated.body.wallet.wallet_id as string;
      await withOwner((db) => creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: 2500 }));
      const tap = await request(app.getHttpServer()).post('/v1/taps').set(device.headers).send(tapBody(m, next()));
      expect(tap.body.result).toBe('OK');
      const key = randomUUID();
      const res = await post(desk(), `/v1/media/${m.id}/deposit`, { tap_id: tap.body.tap_id }, key);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'HELD', amount: 2000, mode: 'FROM_BALANCE', transaction_id: expect.any(String) });
      expect(await rows('SELECT transaction_id FROM media_tap WHERE id = $1', [tap.body.tap_id])).toEqual([{ transaction_id: res.body.transaction_id }]);
      expect((await post(desk(), `/v1/media/${m.id}/deposit`, { tap_id: tap.body.tap_id }, key)).body).toEqual(res.body);
      // Déjà détenue : l'état courant, sans seconde écriture.
      expect((await post(desk(), `/v1/media/${m.id}/deposit`)).body).toMatchObject({ status: 'HELD', amount: 2000, transaction_id: res.body.transaction_id });
      expect(await rows(`SELECT count(*)::int AS n FROM journal_transaction WHERE type = 'DEPOSIT_TAKEN' AND idempotency_key LIKE $1`, [`deposit:${m.id}:%`])).toEqual([{ n: 1 }]);
      expect(await rows(`SELECT actor_id, after->>'status' AS status FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_DEPOSIT_TAKEN' ORDER BY id DESC LIMIT 1`, [w.ops.a, m.id])).toEqual([
        { actor_id: w.cashierA.userId, status: 'HELD' },
      ]);
      await sound();
    });

    it('pendant que la passerelle a l’autorité : 409 DEBIT_AUTHORITY_EDGE, rien n’est pris', async () => {
      const m = await fresh(fromBalance);
      const activated = await activate(m);
      await withOwner((db) => creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId: activated.body.wallet.wallet_id, amount: 3000 }));
      await rows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [w.ids.ledgerA]);
      try {
        const res = await post(desk(), `/v1/media/${m.id}/deposit`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DEBIT_AUTHORITY_EDGE');
        const other = await fresh(fromBalance);
        expect((await activate(other)).body.code).toBe('DEBIT_AUTHORITY_EDGE');
        expect(await rows('SELECT status FROM media WHERE id = $1', [other.id])).toEqual([{ status: 'PERSONALIZED' }]);
      } finally {
        await rows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [w.ids.ledgerA]);
      }
      expect(await state(m)).toEqual({ deposit_status: 'DUE', held: 0 });
    });
  });

  describe('payée à part (SEPARATE)', () => {
    it('en espèces à l’activation : encaissée au compte de caisse du terminal, puis rendue en espèces', async () => {
      const m = await fresh(separate);
      const before = await balance(cashDesk);
      const activated = await activate(m, { deposit_payment: { method: 'CASH' } });
      expect(activated.status).toBe(201);
      expect(activated.body.deposit).toEqual({ status: 'HELD', amount: 1000, mode: 'SEPARATE', transaction_id: expect.any(String) });
      expect(activated.body.wallet).toMatchObject({ spendable: 0, paid: 0 });
      expect(await balance(cashDesk)).toBe(before + 1000);
      expect(await balance('L-ORG-CAUTION')).toBeLessThanOrEqual(-1000);
      await sound();

      // Rendu : en espèces, à la caisse du terminal ; jamais sans le bracelet.
      const noTap = await post(desk(), `/v1/media/${m.id}/deposit/refund`, { payment: { method: 'CASH' } });
      expect(noTap.status).toBe(422);
      expect(noTap.body.rule).toBe('deposit.tap_required');
      const noPayment = await post(desk(), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next()) });
      expect(noPayment.body.rule).toBe('deposit.payment_required');
      expect(await state(m)).toEqual({ deposit_status: 'HELD', held: 1000 });
      const refunded = await post(desk(), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next()), payment: { method: 'CASH' } });
      expect(refunded.body).toEqual({ status: 'REFUNDED', amount: 1000, mode: 'SEPARATE', transaction_id: expect.any(String) });
      expect(await balance(cashDesk)).toBe(before);
      expect(await state(m)).toEqual({ deposit_status: 'REFUNDED', held: 0 });
      await sound();
    });

    it('sans moyen de paiement, ou par un autre moyen que les espèces : 422, règle citée, rien n’est activé', async () => {
      const m = await fresh(separate);
      const missing = await activate(m);
      expect(missing.status).toBe(422);
      expect(missing.body.rule).toBe('deposit.payment_required');
      for (const method of ['WAVE', 'ORANGE_MONEY', 'CARD']) {
        const res = await activate(m, { deposit_payment: { method } });
        expect(res.status).toBe(422);
        expect(res.body.rule).toBe('deposit.cash_only');
      }
      const en = await post(desk(), '/v1/media/activations', { tap: tapBody(m, next()), channel: 'DESK', occurred_at: new Date().toISOString(), deposit_payment: { method: 'CARD' } }, randomUUID(), 'en');
      expect(en.body.detail).toMatch(/cash/i);
      expect(await rows('SELECT status, wallet_id FROM media WHERE id = $1', [m.id])).toEqual([{ status: 'PERSONALIZED', wallet_id: null }]);
    });

    it('terminal sans caisse ouverte : aucune espèce n’entre ni ne sort (409), et aucun compte de caisse n’est créé', async () => {
      const m = await fresh(separate);
      const accounts = () => rows<{ n: number }>(`SELECT count(*)::int AS n FROM account WHERE ledger_id = $1 AND purpose = 'CASH_DESK'`, [w.ids.ledgerA]).then((r) => r[0]!.n);
      const before = await accounts();
      const res = await activate(m, { deposit_payment: { method: 'CASH' } }, desk(noDesk));
      expect(res.status).toBe(409);
      expect(await rows('SELECT status FROM media WHERE id = $1', [m.id])).toEqual([{ status: 'PERSONALIZED' }]);
      // Activé à la caisse ouverte, il ne se rend pas non plus depuis un terminal sans caisse.
      expect((await activate(m, { deposit_payment: { method: 'CASH' } })).status).toBe(201);
      const refund = await post(desk(noDesk), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next()), payment: { method: 'CASH' } });
      expect(refund.status).toBe(409);
      expect(await state(m)).toEqual({ deposit_status: 'HELD', held: 1000 });
      expect(await accounts()).toBe(before);
    });
  });

  describe('contrôles communs', () => {
    it('lot sans caution : NONE ; lecture d’un autre bracelet : refusée ; bracelet inconnu : 404', async () => {
      const plain = await withOwner((db) => createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, eventId: w.ids.eventA, status: 'ACTIVE' }));
      const m = await fresh(plain);
      const other = await fresh(fromBalance);
      expect((await activate(m)).status).toBe(201);
      expect((await activate(other)).status).toBe(201);
      expect((await post(desk(), `/v1/media/${m.id}/deposit`)).body).toEqual({ status: 'NONE', amount: 0, mode: null, transaction_id: null });
      expect((await post(desk(), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next()) })).status).toBe(409);
      const wrong = await post(desk(), `/v1/media/${other.id}/deposit`, { tap: tapBody(m, next()) });
      expect(wrong.status).toBe(422);
      expect(wrong.body.rule).toBe('deposit.wrong_media');
      expect((await post(desk(), `/v1/media/${other.id}/deposit`, { tap_id: 999_999_999 })).body.code).toBe('TAP_UNUSABLE');
      expect((await post(desk(), `/v1/media/${randomUUID()}/deposit`)).status).toBe(404);
      expect((await post(desk(), `/v1/media/abc/deposit`)).status).toBe(404);
    });

    it('lecture suspecte présentée pour un rendu : refus, et le bracelet reste en liste noire', async () => {
      const m = await fresh(separate);
      expect((await activate(m, { deposit_payment: { method: 'CASH' } })).status).toBe(201);
      const res = await post(desk(), `/v1/media/${m.id}/deposit/refund`, { tap: tapBody(m, next(), { originality_signature: 'cd'.repeat(32) }), payment: { method: 'CASH' } });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MEDIA_SIGNATURE_MISMATCH');
      expect(await rows('SELECT status, deposit_status FROM media WHERE id = $1', [m.id])).toEqual([{ status: 'BLACKLISTED', deposit_status: 'HELD' }]);
      expect(await rows('SELECT kind FROM anomaly WHERE media_id = $1', [m.id])).toEqual([{ kind: 'SIGNATURE_MISMATCH' }]);
    });

    it('rôles et isolation', async () => {
      const m = await fresh(fromBalance);
      expect((await activate(m)).status).toBe(201);
      expect((await post({ device, person: null }, `/v1/media/${m.id}/deposit`)).status).toBe(401);
      for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA]) expect((await post({ device, person }, `/v1/media/${m.id}/deposit`)).status).toBe(403);
      const deviceB = await withOwner((db) => createTestDevice(db, { operatorId: w.ops.b }));
      expect((await post({ device: deviceB, person: w.cashierB }, `/v1/media/${m.id}/deposit`)).status).not.toBe(200);
      expect((await post({ device, person: w.cashierB }, `/v1/media/${m.id}/deposit`)).status).not.toBe(200);
      expect(await state(m)).toEqual({ deposit_status: 'DUE', held: 0 });
    });
  });
});
