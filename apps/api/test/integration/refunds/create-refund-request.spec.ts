// Intégration (mission 9a, WP04 ; FR-002, FR-004, FR-005, FR-014, FR-020, NFR-002) : `createMyRefundRequest`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows as rows } from '../../support/media-fixtures';
import { freshPhone } from '../../support/customer-auth';
import {
  attachMedia,
  codeFor,
  createRefundWorld,
  fundedCustomer,
  postRefund,
  setEvent,
  type RefundWorld,
} from './create-fixtures';

describe('création d’une demande de remboursement (POST /me/refund-requests)', () => {
  let r: RefundWorld;
  const body = (walletId: string, destination: Record<string, unknown> = { method: 'WAVE' }) => ({
    wallet_id: walletId,
    destination,
  });
  const lines = (walletId: string) =>
    rows<{ id: string }>('SELECT id FROM refund_request WHERE wallet_id = $1', [walletId]);
  const restoreWindow = () =>
    setEvent(r.w, "refund_deadline = now() + interval '10 days', ends_at = NULL");

  beforeAll(async () => {
    r = await createRefundWorld();
  });
  afterAll(async () => {
    await r.app.close();
  });
  afterEach(restoreWindow);

  it('FR-002, FR-005 : Wave vers le numéro vérifié, REQUESTED, montant = payé - frais, rejeu sans doublon', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    // Les crédits offerts n'entrent jamais dans le montant.
    const key = randomUUID();
    const res = await postRefund(r.app, c.customer, body(c.walletId, { method: 'WAVE' }), key);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      estimated_amount: 9_500,
      fee: 500,
      currency: 'XOF',
      new_number: false,
      extra_check_required: false,
      destination: { method: 'WAVE', msisdn: c.phone },
    });
    expect(contractViolations('RefundRequest', res.body)).toEqual([]);
    for (const secret of ['requested_by', 'confirmed_by', 'operator_id', 'iban'])
      expect(res.body).not.toHaveProperty(secret);
    const again = await postRefund(r.app, c.customer, body(c.walletId), key);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(res.body);
    expect(await lines(c.walletId)).toHaveLength(1);
  });

  it('FR-020 : une ligne d’audit par création, auteur = le festivalier', async () => {
    const c = await fundedCustomer(r.w);
    const res = await postRefund(r.app, c.customer, body(c.walletId));
    const audit = await rows<{ actor_id: string; actor_role: string; operator_id: string }>(
      `SELECT actor_id, actor_role, operator_id FROM audit_log
        WHERE action = 'REFUND_REQUEST_CREATED' AND object_id = $1`,
      [res.body.refund_request_id],
    );
    expect(audit).toEqual([
      { actor_id: c.customer.customerId, actor_role: 'CUSTOMER', operator_id: r.w.ops.a },
    ]);
  });

  it('FR-004 : fenêtre close (sans date limite ni fin ; fin + 29 j / + 31 j ; date passée)', async () => {
    const c = await fundedCustomer(r.w);
    await setEvent(r.w, 'refund_deadline = NULL, ends_at = NULL');
    let res = await postRefund(r.app, c.customer, body(c.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_WINDOW_CLOSED']);
    await setEvent(r.w, "refund_deadline = NULL, ends_at = now() - interval '31 days'");
    res = await postRefund(r.app, c.customer, body(c.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_WINDOW_CLOSED']);
    await setEvent(r.w, "refund_deadline = now() - interval '1 minute'");
    res = await postRefund(r.app, c.customer, body(c.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_WINDOW_CLOSED']);
    // Sans date limite, fin il y a 29 jours : la date limite effective est dans 1 jour.
    await setEvent(r.w, "refund_deadline = NULL, ends_at = now() - interval '29 days'");
    res = await postRefund(r.app, c.customer, body(c.walletId));
    expect(res.status).toBe(201);
    expect(await lines(c.walletId)).toHaveLength(1);
  });

  it('FR-004 : solde payé nul, portefeuille BLOCKED, CLOSED, bracelet BLACKLISTED : 422 REFUND_NOT_ALLOWED', async () => {
    const zero = await fundedCustomer(r.w, 0);
    const blocked = await fundedCustomer(r.w);
    const closed = await fundedCustomer(r.w);
    const black = await fundedCustomer(r.w);
    await withOwner(async (db) => {
      await db.query("UPDATE wallet SET status = 'BLOCKED' WHERE id = $1", [blocked.walletId]);
      await db.query("UPDATE wallet SET status = 'CLOSED' WHERE id = $1", [closed.walletId]);
    });
    await attachMedia(r.w, black.walletId, 'BLACKLISTED');
    for (const c of [zero, blocked, closed, black]) {
      const res = await postRefund(r.app, c.customer, body(c.walletId));
      expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
      expect(await lines(c.walletId)).toHaveLength(0);
    }
  });

  it('FR-004 : bracelet SUSPENDED (perdu) seul sur portefeuille actif : accepté ; avec portefeuille bloqué : refusé', async () => {
    const lost = await fundedCustomer(r.w);
    await attachMedia(r.w, lost.walletId, 'SUSPENDED');
    expect((await postRefund(r.app, lost.customer, body(lost.walletId))).status).toBe(201);
    const lostBlocked = await fundedCustomer(r.w);
    await attachMedia(r.w, lostBlocked.walletId, 'SUSPENDED');
    await withOwner((db) =>
      db.query("UPDATE wallet SET status = 'BLOCKED' WHERE id = $1", [lostBlocked.walletId]),
    );
    const res = await postRefund(r.app, lostBlocked.customer, body(lostBlocked.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
  });

  it('FR-004 : BANK_TRANSFER et autre numéro sans code : 422 REFUND_NOT_ALLOWED', async () => {
    const c = await fundedCustomer(r.w);
    for (const destination of [
      { method: 'BANK_TRANSFER', iban: 'SN08SN0100152000048500003035' },
      { method: 'WAVE', msisdn: freshPhone() },
    ]) {
      const res = await postRefund(r.app, c.customer, body(c.walletId, destination));
      expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    }
    expect(await lines(c.walletId)).toHaveLength(0);
  });

  it('FR-004 : règle de frais absente, ou frais >= solde : 422, jamais des frais nuls', async () => {
    const small = await fundedCustomer(r.w, 500);
    const res = await postRefund(r.app, small.customer, body(small.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    // Événement sans règle PER_REFUND : 422 du résolveur, rien d'inséré.
    const bare = await createRefundWorld({ feeRule: false });
    try {
      const c = await fundedCustomer(bare.w);
      const none = await postRefund(bare.app, c.customer, body(c.walletId));
      expect(none.status).toBe(422);
      expect(none.body.detail).toMatch(/frais/i);
      expect(await lines(c.walletId)).toHaveLength(0);
    } finally {
      await bare.app.close();
    }
  });

  it('NFR-002 : deuxième création 409 REFUND_ALREADY_OPEN ; nouvelle demande après REJECTED', async () => {
    const c = await fundedCustomer(r.w);
    const first = await postRefund(r.app, c.customer, body(c.walletId));
    expect(first.status).toBe(201);
    const second = await postRefund(r.app, c.customer, body(c.walletId));
    expect([second.status, second.body.code]).toEqual([409, 'REFUND_ALREADY_OPEN']);
    await withOwner((db) =>
      db.query(
        "UPDATE refund_request SET status = 'REJECTED', reject_reason = 'test' WHERE id = $1",
        [first.body.refund_request_id],
      ),
    );
    expect((await postRefund(r.app, c.customer, body(c.walletId))).status).toBe(201);
  });

  it('NFR-002 : 20 créations simultanées, une seule ligne ouverte, jamais 500', async () => {
    const c = await fundedCustomer(r.w);
    const all = await Promise.all(
      Array.from({ length: 20 }, () => postRefund(r.app, c.customer, body(c.walletId))),
    );
    expect(all.filter((x) => x.status === 201)).toHaveLength(1);
    expect(all.filter((x) => x.status === 409)).toHaveLength(19);
    expect(await lines(c.walletId)).toHaveLength(1);
  });

  it('FR-014 : autre numéro avec code : AWAITING_HOLDER, hold_until, code du titulaire envoyé ; code consommé', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    const phone = freshPhone();
    const otp = await codeFor(r, phone);
    const res = await postRefund(
      r.app,
      c.customer,
      body(c.walletId, { method: 'ORANGE_MONEY', msisdn: phone, new_number_otp: otp }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'AWAITING_HOLDER',
      new_number: true,
      extra_check_required: false,
    });
    expect(Date.parse(res.body.hold_until)).toBeGreaterThan(Date.now() + 47 * 3_600_000);
    expect(r.sender.count(c.phone)).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(r.sender.lastCode(c.phone));
    // Code déjà consommé : second essai refusé.
    const other = await fundedCustomer(r.w);
    const replay = await postRefund(
      r.app,
      other.customer,
      body(other.walletId, { method: 'WAVE', msisdn: phone, new_number_otp: otp }),
    );
    expect(replay.status).toBe(422);
    expect(replay.body.code).toBe('OTP_INVALID');
  });

  it('FR-014 : au-delà de refund_new_number_max : extra_check_required', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    await setEvent(r.w, 'refund_new_number_max = 5000');
    const phone = freshPhone();
    const res = await postRefund(
      r.app,
      c.customer,
      body(c.walletId, {
        method: 'WAVE',
        msisdn: phone,
        new_number_otp: await codeFor(r, phone),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.extra_check_required).toBe(true);
    await setEvent(r.w, 'refund_new_number_max = 50000');
  });

  it('compte sans numéro vérifié (aucune identité) : 422 REFUND_NOT_ALLOWED, rien d’inséré', async () => {
    const anon = await fundedCustomer(r.w, 10_000);
    await withOwner((db) =>
      db.query('DELETE FROM customer_identity WHERE customer_id = $1', [anon.customer.customerId]),
    );
    const res = await postRefund(r.app, anon.customer, body(anon.walletId));
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    expect(await lines(anon.walletId)).toHaveLength(0);
  });

  it('FR-004 : code d’un autre numéro refusé ; code consommé par un échec de création', async () => {
    const c = await fundedCustomer(r.w);
    const phone = freshPhone();
    const wrongNumber = await codeFor(r, freshPhone());
    const res = await postRefund(
      r.app,
      c.customer,
      body(c.walletId, { method: 'WAVE', msisdn: phone, new_number_otp: wrongNumber }),
    );
    expect([res.status, res.body.code]).toEqual([422, 'OTP_INVALID']);
    expect(await lines(c.walletId)).toHaveLength(0);
  });

  it('portefeuille d’un autre festivalier ou inconnu : même 422, aucune ligne', async () => {
    const a = await fundedCustomer(r.w);
    const b = await fundedCustomer(r.w);
    const foreign = await postRefund(r.app, b.customer, body(a.walletId));
    const unknown = await postRefund(r.app, b.customer, body(randomUUID()));
    for (const res of [foreign, unknown])
      expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    expect(await lines(a.walletId)).toHaveLength(0);
  });

  it('corps avec champ inconnu ou mal formé : 400 ; sans identité : 401', async () => {
    const c = await fundedCustomer(r.w);
    for (const extra of [
      { status: 'PAID' },
      { estimated_amount: 1 },
      { operator_id: randomUUID() },
    ]) {
      const res = await postRefund(r.app, c.customer, { ...body(c.walletId), ...extra });
      expect(res.status).toBe(400);
    }
    expect((await postRefund(r.app, c.customer, { wallet_id: c.walletId })).status).toBe(400);
    const none = await request(r.app.getHttpServer())
      .post('/v1/me/refund-requests')
      .set('Idempotency-Key', randomUUID())
      .send(body(c.walletId));
    expect(none.status).toBe(401);
    expect(await lines(c.walletId)).toHaveLength(0);
  });

  it('un crédit offert n’entre pas dans le montant estimé', async () => {
    const c = await fundedCustomer(r.w, 4_000);
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [r.w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'PROMO_CREDIT', $2, now(), 'BATCH', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PROMO'), 'amount', -3000),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'L-ORG-PROMO'), 'amount', 3000)))`,
        [r.w.ids.ledgerA, `test-promo:${randomUUID()}`, c.walletId],
      );
    });
    const res = await postRefund(r.app, c.customer, body(c.walletId));
    expect(res.status).toBe(201);
    expect(res.body.estimated_amount).toBe(3_500);
  });
});
