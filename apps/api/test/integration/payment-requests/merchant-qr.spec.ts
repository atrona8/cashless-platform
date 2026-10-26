// QR commerçant (mission 5b, lot WP13, T061, T062, T064 ; FR-018, FR-020, NFR-005, NFR-008, NFR-009, C-001,
// C-003 ; contracts/qr-payments.md « QR commerçant »). HTTPS réel (trois preuves du terminal), festivalier par le
// faux fournisseur d'identité, vraie base. Les écritures du propriétaire sont de l'amorçage (recul d'`expires_at`,
// blocage d'un portefeuille) ; toute demande, tout paiement et toute annulation passent par la route.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { commitWhileWaiting, connect, OWNER_URL, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import type { PayTerminal } from '../payments/payments-fixtures';
import { QrWorld, stable, type QrCustomer } from './qr-fixtures';

jest.setTimeout(240_000);

const sha256 = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

describe('QR commerçant (WP13)', () => {
  let qw: QrWorld;
  let term: PayTerminal;
  let bar: PayTerminal;

  beforeAll(async () => {
    qw = await QrWorld.create();
    term = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
    bar = await qw.pw.terminal({ mode: 'CATALOG_POS' });
  });
  afterAll(async () => {
    await qw?.close();
  });

  /** Demande neuve, créée par la route. */
  const request = async (t: PayTerminal = term, amount = 4000, ttl?: number) => {
    const created = await qw.create(t, qw.keypad(t, amount, ttl ? { ttl_seconds: ttl } : {}));
    expect(created.status).toBe(201);
    return created;
  };

  describe('création (terminal)', () => {
    it('FR-018, NFR-008 : 201, jeton rendu une fois, base sans le jeton, nonce_hash = SHA-256, vente non écrite', async () => {
      const key = term.t.seqKey();
      const created = await qw.create(term, qw.keypad(term, 4000), key);
      expect(created.status).toBe(201);
      expect(contractViolations('PaymentRequestObject', created.body)).toEqual([]);
      expect(created.body).toMatchObject({
        direction: 'MERCHANT_QR',
        status: 'PENDING',
        amount: 4000,
        currency: 'XOF',
        transaction_id: null,
      });
      expect(typeof created.body.merchant_name).toBe('string');
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // Contrat : le jeton n'est rendu que dans `qr_payload` (aucun champ `token` à part).
      expect(created.body).not.toHaveProperty('token');
      expect(created.body.qr_payload).toContain(created.id);
      expect(created.body.qr_payload).toContain(created.token);
      const row = await qw.row(created.id);
      expect(row).toMatchObject({ status: 'PENDING', direction: 'MERCHANT_QR', wallet_id: null });
      expect(row.nonce_hash).toEqual(sha256(created.token));
      expect(row.device_id).toBe(term.t.deviceId);
      // La clé de la vente est celle de la création (`<serial>:<seq>`) ; aucune vente n'est écrite.
      expect(
        await ownerRows<{ idempotency_key: string; vendor_session_id: string }>(
          'SELECT idempotency_key, vendor_session_id FROM payment_request_detail WHERE payment_request_id = $1',
          [created.id],
        ),
      ).toEqual([{ idempotency_key: key, vendor_session_id: term.sessionId }]);
      expect(await qw.pw.salesOf(term.t.deviceId)).toBe(0);
      // Numéro rangé ACCEPTED, sans vente.
      const seq = key.split(':')[1]!;
      expect(
        (await qw.pw.registry(term.t.deviceId)).find((r) => Number(r.seq) === Number(seq)),
      ).toMatchObject({ outcome: 'ACCEPTED', transaction_id: null, channel: 'ONLINE' });
    });

    it('A3, NFR-008 : route transient — aucune réponse dans api_idempotency, renvoi de la même clé → 409, aucun jeton nulle part', async () => {
      const key = term.t.seqKey();
      const first = await qw.create(term, qw.keypad(term, 1200), key);
      expect(first.status).toBe(201);
      const again = await qw.create(term, qw.keypad(term, 1200), key);
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.body)).not.toContain(first.token);
      const stored = await ownerRows<{ response_body: unknown; response_status: number }>(
        `SELECT response_body, response_status FROM api_idempotency WHERE scope = $1 AND idempotency_key = $2`,
        [`device:${term.t.deviceId}:`, key],
      );
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored[0]!.response_body ?? null)).not.toContain(first.token);
      expect(JSON.stringify(stored[0]!.response_body ?? null)).not.toContain(first.id);
      await expectNoToken(first.token);
      expect(await qw.row(first.id)).toMatchObject({ status: 'PENDING' });
    });

    it('lignes d’une caisse catalogue contrôlées comme une vente, sans écriture de vente ; recopiées à la vente', async () => {
      const lines = [
        { product_id: qw.pw.items[0]!.id, quantity: 2, unit_price: qw.pw.items[0]!.price },
        { product_id: qw.pw.items[1]!.id, quantity: 1, unit_price: qw.pw.items[1]!.price },
      ];
      const created = await qw.create(bar, {
        amount: 7500,
        currency: 'XOF',
        vendor_session_id: bar.sessionId,
        lines,
      });
      expect(created.status).toBe(201);
      expect(await qw.pw.salesOf(bar.t.deviceId)).toBe(0);
      const customer = await qw.customer();
      const paid = await qw.pay(customer, created.id, created.token);
      expect(paid.status).toBe(200);
      expect(contractViolations('PaymentResult', paid.body)).toEqual([]);
      expect(paid.body.lines).toEqual([
        expect.objectContaining({
          product_id: lines[0]!.product_id,
          quantity: 2,
          line_total: 6000,
        }),
        expect.objectContaining({
          product_id: lines[1]!.product_id,
          quantity: 1,
          line_total: 1500,
        }),
      ]);
      // Lignes fausses (prix différent du catalogue) : 422 SALE_LINES_INVALID, aucune demande écrite.
      const before = await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM payment_request WHERE device_id = $1',
        [bar.t.deviceId],
      );
      const wrong = await qw.create(bar, {
        amount: 100,
        currency: 'XOF',
        vendor_session_id: bar.sessionId,
        lines: [{ product_id: qw.pw.items[0]!.id, quantity: 1, unit_price: 100 }],
      });
      expect([wrong.status, wrong.body.code]).toEqual([422, 'SALE_LINES_INVALID']);
      expect(
        await ownerRows<{ n: number }>(
          'SELECT count(*)::int AS n FROM payment_request WHERE device_id = $1',
          [bar.t.deviceId],
        ),
      ).toEqual(before);
    });

    it('C-003 : <serial> d’un autre terminal → 422, rien d’écrit (ni demande ni numéro) ; session absente ou autre → 409, refus rangé au registre', async () => {
      const other = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const wrongSerial = await qw.create(term, qw.keypad(term), other.t.seqKey());
      expect([wrongSerial.status, wrongSerial.body.code]).toEqual([422, 'VALIDATION_FAILED']);
      const noSession = await qw.create(term, { amount: 1000, currency: 'XOF' }, term.t.seqKey());
      expect([noSession.status, noSession.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
      const foreign = await qw.create(
        term,
        qw.keypad(term, 1000, { vendor_session_id: other.sessionId }),
        term.t.seqKey(),
      );
      expect([foreign.status, foreign.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
      const registry = await qw.pw.registry(term.t.deviceId);
      expect(registry.slice(-2).map((r) => [r.outcome, r.reason])).toEqual([
        ['REJECTED', 'VENDOR_SESSION_INVALID'],
        ['REJECTED', 'VENDOR_SESSION_INVALID'],
      ]);
    });

    it('numéro déjà rangé avec un autre contenu (CL002) : refus tel quel, rien de créé, aucun refus de plus rangé', async () => {
      const t = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const key = t.t.seqKey();
      const seq = Number(key.split(':')[1]);
      await withOwner((db) =>
        db
          .query(`SELECT set_config('app.operator_id', $1, false)`, [qw.pw.w.ops.a])
          .then(() =>
            db.query(`SELECT record_device_seq($1, $2, $3, 'ACCEPTED', 'ONLINE')`, [
              t.t.deviceId,
              seq,
              Buffer.alloc(32, 7),
            ]),
          ),
      );
      const before = (await qw.pw.registry(t.t.deviceId)).length;
      const res = await qw.create(t, qw.keypad(t), key);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(
        await ownerRows('SELECT 1 FROM payment_request WHERE device_id = $1', [t.t.deviceId]),
      ).toEqual([]);
      expect((await qw.pw.registry(t.t.deviceId)).length).toBe(before);
    });

    it('ttl_seconds hors de 15 à 300, montant nul, devise fausse → 4xx, rien d’écrit', async () => {
      for (const [extra, status] of [
        [{ ttl_seconds: 10 }, 422],
        [{ ttl_seconds: 301 }, 422],
        [{ ttl_seconds: 1.5 }, 400],
      ] as const) {
        const res = await qw.create(term, qw.keypad(term, 1000, extra));
        expect([res.status, res.body.code]).toEqual([status, 'VALIDATION_FAILED']);
      }
      expect((await qw.create(term, qw.keypad(term, 0))).status).toBeGreaterThanOrEqual(400);
      expect(
        (await qw.create(term, { ...qw.keypad(term), currency: 'EUR' })).body.code,
      ).toBeDefined();
    });
  });

  describe('paiement (festivalier)', () => {
    it('FR-018, SC-002 : PURCHASE écrite, demande CONFIRMED, transaction_id posé, vente attribuée au vendeur de la session, canal MERCHANT_QR', async () => {
      const customer = await qw.customer(20_000);
      const created = await request(term, 4000);
      const paid = await qw.pay(customer, created.id, created.token);
      expect(paid.status).toBe(200);
      expect(contractViolations('PaymentResult', paid.body)).toEqual([]);
      expect(paid.body).toMatchObject({
        type: 'PURCHASE',
        status: 'SUCCEEDED',
        amount: 4000,
        currency: 'XOF',
        wallet_id: customer.walletId,
        channel: 'MERCHANT_QR',
        vendor: { vendor_id: qw.pw.vendorId, display_name: qw.pw.vendorName },
        balance_after: { spendable: 16_000, paid: 16_000, promo: 0 },
      });
      expect(JSON.stringify(paid.body)).not.toContain(created.token);
      expect(await qw.row(created.id)).toMatchObject({
        status: 'CONFIRMED',
        transaction_id: paid.body.transaction_id,
        wallet_id: customer.walletId,
      });
      expect(await qw.pw.spendable(customer.walletId)).toBe(16_000);
      const sale = await ownerRows<{ idempotency_key: string; source: string; device_id: string }>(
        'SELECT idempotency_key, source, device_id FROM journal_transaction WHERE id = $1',
        [paid.body.transaction_id],
      );
      const detail = await ownerRows<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM payment_request_detail WHERE payment_request_id = $1',
        [created.id],
      );
      expect(sale).toEqual([
        {
          idempotency_key: detail[0]!.idempotency_key,
          source: 'ONLINE',
          device_id: term.t.deviceId,
        },
      ]);
      expect(
        await ownerRows(
          'SELECT vendor_id, channel, vendor_session_id FROM sale_attribution WHERE transaction_id = $1',
          [paid.body.transaction_id],
        ),
      ).toEqual([
        { vendor_id: qw.pw.vendorId, channel: 'MERCHANT_QR', vendor_session_id: term.sessionId },
      ]);
      // Le terminal suit la demande jusqu'à CONFIRMED.
      const seen = await qw.byTerminal(term, 'GET', created.id);
      expect(seen.status).toBe(200);
      expect(seen.body).toMatchObject({
        status: 'CONFIRMED',
        transaction_id: paid.body.transaction_id,
      });
      expect(seen.body.qr_payload).toBeNull();
    });

    it('FR-020, NFR-008 : rejeu du jeton, expirée, annulée, inconnue, mauvais jeton → le MÊME 409 PAYMENT_REQUEST_NOT_PENDING, même corps, rien d’écrit', async () => {
      const customer = await qw.customer(20_000);
      const paidOnce = await request();
      expect((await qw.pay(customer, paidOnce.id, paidOnce.token)).status).toBe(200);
      const expired = await request();
      await qw.expire(expired.id);
      const cancelled = await request();
      expect((await qw.byTerminal(term, 'POST', cancelled.id, '/cancel')).status).toBe(200);
      const wrongToken = await request();
      const other = await request();
      const salesBefore = await qw.sales(customer.walletId);
      const outcomes: Array<[string, Awaited<ReturnType<QrWorld['pay']>>]> = [
        ['payée', await qw.pay(customer, paidOnce.id, paidOnce.token)],
        ['expirée', await qw.pay(customer, expired.id, expired.token)],
        ['annulée', await qw.pay(customer, cancelled.id, cancelled.token)],
        ['inconnue', await qw.pay(customer, randomUUID(), wrongToken.token)],
        ['mauvais jeton', await qw.pay(customer, wrongToken.id, other.token)],
        [
          'jeton d’une autre demande, bien formé mais faux',
          await qw.pay(customer, wrongToken.id, 'A'.repeat(22)),
        ],
        ['identifiant mal formé', await qw.pay(customer, 'pas-un-uuid', wrongToken.token)],
      ];
      for (const [name, res] of outcomes)
        expect([name, res.status, res.body.code]).toEqual([
          name,
          409,
          'PAYMENT_REQUEST_NOT_PENDING',
        ]);
      expect(new Set(outcomes.map(([, res]) => stable(res.body))).size).toBe(1);
      for (const [, res] of outcomes) expect(res.text).not.toContain(wrongToken.token);
      expect(await qw.sales(customer.walletId)).toBe(salesBefore);
      expect(await qw.row(wrongToken.id)).toMatchObject({ status: 'PENDING', wallet_id: null });
    });

    it('un contrat sans 404 pour payPaymentRequest : aucune réponse 404 d’une demande inconnue', async () => {
      const customer = await qw.customer();
      const res = await qw.pay(customer, randomUUID(), 'Z'.repeat(22));
      expect(res.status).not.toBe(404);
    });

    it('terminal suspendu ou session close entre la création et le paiement → refus, demande intacte', async () => {
      const customer = await qw.customer();
      const suspended = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const created = await request(suspended);
      await withOwner((db) =>
        db.query(`UPDATE device SET status = 'SUSPENDED' WHERE id = $1`, [suspended.t.deviceId]),
      );
      const a = await qw.pay(customer, created.id, created.token);
      expect([a.status, a.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect(await qw.row(created.id)).toMatchObject({ status: 'PENDING', wallet_id: null });

      const closing = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const second = await request(closing);
      await withOwner((db) =>
        db.query(
          `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
          [closing.sessionId],
        ),
      );
      const b = await qw.pay(customer, second.id, second.token);
      expect([b.status, b.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect(await qw.row(second.id)).toMatchObject({ status: 'PENDING', wallet_id: null });
      expect(await qw.sales(customer.walletId)).toBe(0);
    });

    it('portefeuille bloqué, d’un autre festivalier ou d’un autre événement → même refus, rien d’écrit', async () => {
      const created = await request();
      const blocked = await qw.customer(20_000, 'BLOCKED');
      const stranger = await qw.customer(20_000);
      const mine = await qw.customer(20_000);
      const refusals = [
        await qw.pay(blocked, created.id, created.token),
        // Portefeuille d'un autre festivalier, présenté par `mine`.
        await qw.asCustomer(mine, 'POST', `/payment-requests/${created.id}/pay`, {
          body: { token: created.token, wallet_id: stranger.walletId },
        }),
      ];
      for (const res of refusals)
        expect([res.status, res.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect(new Set(refusals.map((r) => stable(r.body))).size).toBe(1);
      expect(await qw.row(created.id)).toMatchObject({ status: 'PENDING', wallet_id: null });
      expect(await qw.sales(blocked.walletId)).toBe(0);
      expect(await qw.sales(stranger.walletId)).toBe(0);
      expect(await qw.pw.spendable(stranger.walletId)).toBe(20_000);
    });

    it('report WP05 : refus du moteur (fonds insuffisants) → transaction annulée, demande toujours PENDING, aucun wallet_id posé, aucune vente', async () => {
      const poor = await qw.customer(1000);
      const created = await request(term, 4000);
      const res = await qw.pay(poor, created.id, created.token);
      expect([res.status, res.body.code]).toEqual([422, 'INSUFFICIENT_FUNDS']);
      expect(await qw.row(created.id)).toMatchObject({
        status: 'PENDING',
        wallet_id: null,
        transaction_id: null,
      });
      expect(await qw.sales(poor.walletId)).toBe(0);
      expect(await qw.pw.spendable(poor.walletId)).toBe(1000);
      // La demande reste payable par un portefeuille suffisant.
      const rich = await qw.customer(20_000);
      expect((await qw.pay(rich, created.id, created.token)).status).toBe(200);
    });

    it('idempotence du paiement : même clé, même corps → même réponse rejouée, une seule vente', async () => {
      const customer = await qw.customer();
      const created = await request();
      const key = randomUUID();
      const first = await qw.pay(customer, created.id, created.token, key);
      const replay = await qw.pay(customer, created.id, created.token, key);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(await qw.sales(customer.walletId)).toBe(1);
      // La réponse enregistrée ne contient aucun jeton.
      const stored = await ownerRows<{ response_body: unknown }>(
        'SELECT response_body FROM api_idempotency WHERE idempotency_key = $1',
        [key],
      );
      expect(JSON.stringify(stored)).not.toContain(created.token);
    });

    it('report WP13 : la clé de la demande a déjà servi au grand livre (vente rejouée par le moteur) → le même 409, demande intacte', async () => {
      const customer = await qw.customer();
      const created = await request();
      const [detail] = await ownerRows<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM payment_request_detail WHERE payment_request_id = $1',
        [created.id],
      );
      const ledgerKey = detail!.idempotency_key;
      // Vente de même clé et sans empreinte de commande déjà au grand livre : le moteur la rejoue
      // (`replayed`), la garde du service refuse de confirmer la demande sur une vente qu'il n'a pas écrite.
      await withOwner((db) =>
        db.query(
          `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key,
                                            request_hash, occurred_at, source)
           VALUES ($1, $2, $3, 'PURCHASE', $4, 'empreinte de test', now(), 'ONLINE')`,
          [randomUUID(), qw.pw.w.ops.a, qw.pw.w.ids.ledgerA, ledgerKey],
        ),
      );
      const res = await qw.pay(customer, created.id, created.token);
      expect([res.status, res.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect(await qw.row(created.id)).toMatchObject({
        status: 'PENDING',
        wallet_id: null,
        transaction_id: null,
      });
      expect(await qw.sales(customer.walletId)).toBe(0);
    });

    it('festivalier absent ou inconnu → 401, rien d’écrit', async () => {
      const created = await request();
      const none = await qw.asCustomer(null, 'POST', `/payment-requests/${created.id}/pay`, {
        body: { token: created.token, wallet_id: randomUUID() },
      });
      expect(none.status).toBe(401);
      expect(await qw.row(created.id)).toMatchObject({ status: 'PENDING', wallet_id: null });
    });
  });

  describe('consultation et annulation', () => {
    it('terminal d’origine : GET 200 ; autre terminal, demande inconnue ou mal formée → 404, le même corps', async () => {
      const created = await request();
      const other = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const own = await qw.byTerminal(term, 'GET', created.id);
      expect(own.status).toBe(200);
      expect(contractViolations('PaymentRequestObject', own.body)).toEqual([]);
      expect(own.body).toMatchObject({ status: 'PENDING', amount: 4000, qr_payload: null });
      const refusals = [
        await qw.byTerminal(other, 'GET', created.id),
        await qw.byTerminal(term, 'GET', randomUUID()),
        await qw.byTerminal(term, 'GET', 'pas-un-uuid'),
      ];
      for (const res of refusals) expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
      expect(new Set(refusals.map((r) => stable(r.body))).size).toBe(1);
      // Annulation par un autre terminal : 404, la demande reste PENDING.
      const foreign = await qw.byTerminal(other, 'POST', created.id, '/cancel');
      expect([foreign.status, foreign.body.code]).toEqual([404, 'NOT_FOUND']);
      expect(stable(foreign.body)).toBe(stable(refusals[0]!.body));
      expect(await qw.row(created.id)).toMatchObject({ status: 'PENDING' });
      // Refus de l'autre terminal rangé au registre de CE terminal.
      expect((await qw.pw.registry(other.t.deviceId)).at(-1)).toMatchObject({
        outcome: 'REJECTED',
        reason: 'NOT_FOUND',
      });
    });

    it('?wait : attend sans transaction ouverte, rend dès la confirmation ; expirée rendue EXPIRED', async () => {
      const customer = await qw.customer();
      const created = await request();
      const waiting = qw.byTerminal(term, 'GET', created.id, '?wait=20');
      // Le paiement arrive pendant l'attente.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await qw.pay(customer, created.id, created.token)).status).toBe(200);
      const seen = await waiting;
      expect(seen.status).toBe(200);
      expect(seen.body.status).toBe('CONFIRMED');
      const expiring = await request();
      await qw.expire(expiring.id);
      const expired = await qw.byTerminal(term, 'GET', expiring.id, '?wait=2');
      expect(expired.body.status).toBe('EXPIRED');
      expect((await qw.byTerminal(term, 'GET', expiring.id, '?wait=26')).status).toBe(422);
      expect((await qw.byTerminal(term, 'GET', expiring.id, '?wait=abc')).status).toBe(422);
    });

    it('annulation par le terminal : CANCELLED ; deuxième annulation → 409 PAYMENT_REQUEST_NOT_PENDING ; payer ensuite → 409', async () => {
      const customer = await qw.customer();
      const created = await request();
      const cancelled = await qw.byTerminal(term, 'POST', created.id, '/cancel');
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(contractViolations('PaymentRequestObject', cancelled.body)).toEqual([]);
      const again = await qw.byTerminal(term, 'POST', created.id, '/cancel');
      expect([again.status, again.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect((await qw.pay(customer, created.id, created.token)).status).toBe(409);
      // Le 409 d'une annulation est lui aussi rangé au registre du terminal.
      expect((await qw.pw.registry(term.t.deviceId)).at(-1)).toMatchObject({
        outcome: 'REJECTED',
        reason: 'PAYMENT_REQUEST_NOT_PENDING',
      });
    });

    it('A10, A24 : le festivalier sans jeton (ou avec un faux) ne lit ni n’annule → 404, le même corps ; avec le jeton : montant et commerçant visibles', async () => {
      const customer = await qw.customer();
      const created = await request(term, 2500);
      const tokenHeader = { 'x-payment-request-token': created.token };
      const unknown = await qw.asCustomer(customer, 'GET', `/payment-requests/${randomUUID()}`, {
        headers: tokenHeader,
      });
      const refusals = [
        await qw.asCustomer(customer, 'GET', `/payment-requests/${created.id}`),
        await qw.asCustomer(customer, 'GET', `/payment-requests/${created.id}`, {
          headers: { 'x-payment-request-token': 'B'.repeat(22) },
        }),
        await qw.asCustomer(customer, 'GET', `/payment-requests/${created.id}`, {
          headers: { 'x-payment-request-token': 'court' },
        }),
        unknown,
        await qw.asCustomer(customer, 'POST', `/payment-requests/${created.id}/cancel`, {
          body: {},
        }),
        await qw.asCustomer(customer, 'POST', `/payment-requests/${created.id}/cancel`, {
          body: {},
          headers: { 'x-payment-request-token': 'B'.repeat(22) },
        }),
      ];
      for (const res of refusals) expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
      expect(new Set(refusals.map((r) => stable(r.body))).size).toBe(1);
      expect(await qw.row(created.id)).toMatchObject({ status: 'PENDING' });
      // Le jeton en chaîne de requête n'est PAS lu (il finirait dans les journaux d'accès).
      const query = await qw.asCustomer(
        customer,
        'GET',
        `/payment-requests/${created.id}?token=${created.token}`,
      );
      expect(query.status).toBe(404);
      const seen = await qw.asCustomer(customer, 'GET', `/payment-requests/${created.id}`, {
        headers: tokenHeader,
      });
      expect(seen.status).toBe(200);
      expect(contractViolations('PaymentRequestObject', seen.body)).toEqual([]);
      expect(seen.body).toMatchObject({
        direction: 'MERCHANT_QR',
        status: 'PENDING',
        amount: 2500,
        currency: 'XOF',
        qr_payload: null,
        transaction_id: null,
      });
      expect(typeof seen.body.merchant_name).toBe('string');
      expect(JSON.stringify(seen.body)).not.toContain(created.token);
      // Annulation avec le jeton.
      const cancelled = await qw.asCustomer(
        customer,
        'POST',
        `/payment-requests/${created.id}/cancel`,
        { body: {}, headers: tokenHeader },
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      const second = await qw.asCustomer(
        customer,
        'POST',
        `/payment-requests/${created.id}/cancel`,
        {
          body: {},
          headers: tokenHeader,
        },
      );
      expect([second.status, second.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      const afterExpiry = await request();
      await qw.expire(afterExpiry.id);
      const read = await qw.asCustomer(customer, 'GET', `/payment-requests/${afterExpiry.id}`, {
        headers: { 'x-payment-request-token': afterExpiry.token },
      });
      expect(read.body.status).toBe('EXPIRED');
    });

    it('garde exclusive : preuves de terminal fausses + jeton du festivalier → refus du terminal, sans repli', async () => {
      const customer = await qw.customer();
      const created = await request();
      const res = await term.t.request(
        qw.pw.api.baseUrl,
        qw.pw.api.tls.serverCaPem,
        { method: 'GET', path: `/payment-requests/${created.id}` },
        {
          token: null,
          headers: { ...customer.customer.headers, 'x-payment-request-token': created.token },
        },
      );
      expect(res.status).toBe(401);
    });
  });

  describe('concurrence et verrous', () => {
    it('NFR-005 : 20 paiements simultanés du même jeton → exactement une vente', async () => {
      const customers: QrCustomer[] = await Promise.all(
        Array.from({ length: 20 }, () => qw.customer(20_000)),
      );
      const created = await request(term, 3000);
      const results = await Promise.all(customers.map((c) => qw.pay(c, created.id, created.token)));
      const wins = results.filter((r) => r.status === 200);
      expect(wins).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200))
        expect([r.status, r.body.code]).toEqual([409, 'PAYMENT_REQUEST_NOT_PENDING']);
      expect(
        (
          await ownerRows<{ n: number }>(
            `SELECT count(*)::int AS n FROM journal_transaction WHERE device_id = $1 AND type = 'PURCHASE'`,
            [term.t.deviceId],
          )
        )[0]!.n,
      ).toBeGreaterThanOrEqual(1);
      const row = await qw.row(created.id);
      expect(row.status).toBe('CONFIRMED');
      let debited = 0;
      for (const c of customers) debited += 20_000 - (await qw.pw.spendable(c.walletId));
      expect(debited).toBe(3000);
      expect(await qw.pw.salesOf(term.t.deviceId)).toBe(
        (await qw.pw.footprint(term.t.deviceId)).confirmed,
      );
    });

    it('annulation par le terminal et paiement simultanés : une seule issue, jamais une demande annulée avec une vente', async () => {
      const customer = await qw.customer(20_000);
      const created = await request(term, 2000);
      const [cancel, pay] = await Promise.all([
        qw.byTerminal(term, 'POST', created.id, '/cancel'),
        qw.pay(customer, created.id, created.token),
      ]);
      const row = await qw.row(created.id);
      if (cancel.status === 200) {
        expect([pay.status, row.status, row.transaction_id]).toEqual([409, 'CANCELLED', null]);
        expect(await qw.sales(customer.walletId)).toBe(0);
      } else {
        expect([cancel.status, pay.status, row.status]).toEqual([409, 200, 'CONFIRMED']);
        expect(await qw.sales(customer.walletId)).toBe(1);
      }
    });

    it('20 paiements simultanés du même jeton par le MÊME portefeuille (clés différentes) → une vente, un seul débit', async () => {
      const customer = await qw.customer(20_000);
      const created = await request(term, 3000);
      const results = await Promise.all(
        Array.from({ length: 20 }, () => qw.pay(customer, created.id, created.token)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await qw.sales(customer.walletId)).toBe(1);
      expect(await qw.pw.spendable(customer.walletId)).toBe(17_000);
    });

    it('garde de session : une fermeture concurrente attend la création, puis la création suivante est refusée (409)', async () => {
      const t = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const res = await commitWhileWaiting(
        {
          sql: `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
          params: [t.sessionId],
        },
        { role: 'cashless_app', statement: 'assert_vendor_session' },
        () => qw.create(t),
      );
      expect([res.status, res.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
      expect(
        await ownerRows('SELECT 1 FROM payment_request WHERE device_id = $1', [t.t.deviceId]),
      ).toEqual([]);
    });

    it('ordre terminal → session : la création attend le terminal sans rien tenir ; une fermeture qui prend le terminal puis la session passe sans interblocage', async () => {
      const t = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
      const holder = await connect(OWNER_URL);
      try {
        // FOR NO KEY UPDATE comme un UPDATE de `set_device_status` : n'arrête pas la garde d'identité,
        // arrête la prise du terminal par `record_device_seq` (FOR UPDATE).
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM device WHERE id = $1 FOR NO KEY UPDATE', [t.t.deviceId]);
        const pending = Promise.resolve(qw.create(t));
        pending.catch(() => undefined);
        await waitBlocked('record_device_seq');
        // Si la garde de session prenait la session avant le terminal, cette mise à jour attendrait la création
        // qui attend le terminal : interblocage (lock_timeout).
        await holder.query('SET LOCAL lock_timeout = 5000');
        await holder.query(
          `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
          [t.sessionId],
        );
        await holder.query('COMMIT');
        const res = await pending;
        expect([res.status, res.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
      expect(
        await ownerRows('SELECT 1 FROM payment_request WHERE device_id = $1', [t.t.deviceId]),
      ).toEqual([]);
    });
  });

  /** Attend (sans délai fixe) qu'une session `cashless_app` soit bloquée sur un verrou de cette instruction. */
  async function waitBlocked(statement: string): Promise<void> {
    for (let waited = 0; ; waited += 20) {
      const rows = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE usename = 'cashless_app' AND wait_event_type = 'Lock' AND position($1 in query) > 0`,
        [statement],
      );
      if (rows[0]!.n > 0) return;
      if (waited >= 10_000)
        throw new Error(`aucune session n'attend le verrou de « ${statement} »`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async function expectNoToken(token: string): Promise<void> {
    for (const table of [
      'payment_request',
      'payment_request_detail',
      'api_idempotency',
      'audit_log',
    ]) {
      const rows = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text LIKE '%' || $1 || '%'`,
        [token],
      );
      expect([table, rows[0]!.n]).toEqual([table, 0]);
    }
  }
});
