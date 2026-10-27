// QR client (mission 5b, lot WP13, T063, T064 ; FR-019, FR-020, NFR-005, NFR-008, NFR-009 ; contracts/qr-payments.md
// « QR client », ADR-123). Le festivalier crée son jeton (`POST /me/customer-qr-tokens`) ; le terminal l'encaisse par
// `POST /payments` (route de WP11, `customer_qr_token`). HTTPS réel, festivalier par le faux, vraie base.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import type { PayTerminal } from '../payments/payments-fixtures';
import { QrWorld, stable, type QrCustomer } from './qr-fixtures';

jest.setTimeout(240_000);

const sha256 = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

describe('QR client (WP13)', () => {
  let qw: QrWorld;
  let term: PayTerminal;

  beforeAll(async () => {
    qw = await QrWorld.create();
    term = await qw.pw.terminal({ mode: 'KEYPAD_TPE' });
  });
  afterAll(async () => {
    await qw?.close();
  });

  const createToken = (who: QrCustomer, walletId = who.walletId, key?: string) =>
    qw.asCustomer(who, 'POST', '/me/customer-qr-tokens', { body: { wallet_id: walletId }, key });

  it('FR-019, NFR-008 : 201, 12 caractères base32, montant nul, événement du grand livre, base sans le jeton', async () => {
    const customer = await qw.customer();
    const res = await createToken(customer);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'expires_at',
      'payment_request_id',
      'qr_payload',
      'token',
    ]);
    const token = String(res.body.token);
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(res.body.qr_payload).toBe(`CSHL1:${token}`);
    const row = await qw.row(String(res.body.payment_request_id));
    expect(row).toMatchObject({
      status: 'PENDING',
      direction: 'CUSTOMER_QR',
      wallet_id: customer.walletId,
      amount: null,
      device_id: null,
    });
    expect(row.nonce_hash).toEqual(sha256(token));
    // A25 : l'événement est celui du grand livre du portefeuille.
    expect(
      await ownerRows(
        `SELECT pr.event_id = l.scope_id AS same_event, l.scope_type FROM payment_request pr
           JOIN wallet w ON w.id = pr.wallet_id JOIN ledger l ON l.id = w.ledger_id WHERE pr.id = $1`,
        [res.body.payment_request_id],
      ),
    ).toEqual([{ same_event: true, scope_type: 'EVENT' }]);
    const expires = new Date(String(res.body.expires_at)).getTime();
    expect(Number.isFinite(expires)).toBe(true);
  });

  it('A3 : transient — renvoi de la même clé → 409, aucune réponse (ni jeton) dans api_idempotency, ni dans payment_request, audit_log', async () => {
    const customer = await qw.customer();
    const key = randomUUID();
    const first = await createToken(customer, customer.walletId, key);
    expect(first.status).toBe(201);
    const token = String(first.body.token);
    const again = await createToken(customer, customer.walletId, key);
    expect(again.status).toBe(409);
    expect(again.text).not.toContain(token);
    const stored = await ownerRows<{ response_body: unknown }>(
      'SELECT response_body FROM api_idempotency WHERE idempotency_key = $1',
      [key],
    );
    expect(stored).toHaveLength(1);
    for (const table of ['payment_request', 'api_idempotency', 'audit_log']) {
      const rows = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text LIKE '%' || $1 || '%'`,
        [token],
      );
      expect([table, rows[0]!.n]).toEqual([table, 0]);
    }
  });

  it('portefeuille d’un autre festivalier, bloqué ou inconnu → le même 404, sans dire lequel, rien d’écrit', async () => {
    const mine = await qw.customer();
    const other = await qw.customer();
    const blocked = await qw.customer(20_000, 'BLOCKED');
    const before = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM payment_request WHERE direction = 'CUSTOMER_QR'`,
    );
    const refusals = [
      await createToken(mine, other.walletId),
      await createToken(blocked),
      await createToken(mine, randomUUID()),
    ];
    for (const res of refusals) expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(new Set(refusals.map((r) => stable(r.body))).size).toBe(1);
    expect(
      await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM payment_request WHERE direction = 'CUSTOMER_QR'`,
      ),
    ).toEqual(before);
    // Corps sans portefeuille ou sans festivalier.
    expect((await qw.asCustomer(mine, 'POST', '/me/customer-qr-tokens', { body: {} })).status).toBe(
      422,
    );
    expect(
      (
        await qw.asCustomer(null, 'POST', '/me/customer-qr-tokens', {
          body: { wallet_id: mine.walletId },
        })
      ).status,
    ).toBe(401);
  });

  it('FR-019, ADR-123 : encaissement par POST /payments (route de WP11), puis rejeu → 422 QR_TOKEN_INVALID, rien d’écrit', async () => {
    const customer = await qw.customer(20_000);
    const token = String((await createToken(customer)).body.token);
    const first = await qw.pw.pay(term, qw.pw.keypadBody(term, { customer_qr_token: token }, 3000));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ channel: 'CUSTOMER_QR', wallet_id: customer.walletId });
    expect(await qw.pw.spendable(customer.walletId)).toBe(17_000);
    const replay = await qw.pw.pay(
      term,
      qw.pw.keypadBody(term, { customer_qr_token: token }, 3000),
    );
    expect([replay.status, replay.body.code]).toEqual([422, 'QR_TOKEN_INVALID']);
    expect(await qw.pw.spendable(customer.walletId)).toBe(17_000);
    expect(await qw.sales(customer.walletId)).toBe(1);
    // La demande est CONFIRMED et liée à la vente.
    expect(
      await ownerRows(`SELECT status, transaction_id FROM payment_request WHERE nonce_hash = $1`, [
        sha256(token),
      ]),
    ).toEqual([{ status: 'CONFIRMED', transaction_id: first.body.transaction_id }]);
  });

  it('jeton expiré, inconnu ou d’un autre événement → 422 QR_TOKEN_INVALID, le même corps, rien d’écrit', async () => {
    const customer = await qw.customer(20_000);
    const expired = await createToken(customer);
    await qw.expire(String(expired.body.payment_request_id));
    // Autre événement du prestataire : copie de l'événement du jeu d'essai (propriétaire, amorçage).
    const foreign = await createToken(customer);
    await withOwner(async (db) => {
      await db.query('CREATE TEMP TABLE other_event AS SELECT * FROM event WHERE id = $1', [
        qw.pw.w.ids.eventA,
      ]);
      await db.query(
        `UPDATE other_event SET id = gen_random_uuid(), name = name || ' (autre)', status = 'DRAFT'`,
      );
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO event SELECT * FROM other_event RETURNING id',
      );
      await db.query('UPDATE payment_request SET event_id = $2 WHERE id = $1', [
        foreign.body.payment_request_id,
        rows[0]!.id,
      ]);
    });
    const refusals = [
      await qw.pw.pay(
        term,
        qw.pw.keypadBody(term, { customer_qr_token: String(expired.body.token) }, 1000),
      ),
      await qw.pw.pay(
        term,
        qw.pw.keypadBody(term, { customer_qr_token: String(foreign.body.token) }, 1000),
      ),
      await qw.pw.pay(term, qw.pw.keypadBody(term, { customer_qr_token: 'Q'.repeat(12) }, 1000)),
    ];
    for (const res of refusals)
      expect([res.status, res.body.code]).toEqual([422, 'QR_TOKEN_INVALID']);
    expect(new Set(refusals.map((r) => stable(r.body))).size).toBe(1);
    expect(await qw.pw.spendable(customer.walletId)).toBe(20_000);
    expect(await qw.sales(customer.walletId)).toBe(0);
  });

  it('20 encaissements simultanés du même QR client → exactement une vente', async () => {
    const customer = await qw.customer(20_000);
    const token = String((await createToken(customer)).body.token);
    // Sessions ouvertes l'une après l'autre : le même vendeur, la limite d'essais de PIN joue sinon.
    const terminals: PayTerminal[] = [];
    for (let i = 0; i < 5; i += 1) terminals.push(await qw.pw.terminal({ mode: 'KEYPAD_TPE' }));
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const t = terminals[i % terminals.length]!;
        return qw.pw.pay(t, qw.pw.keypadBody(t, { customer_qr_token: token }, 1000));
      }),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201))
      expect([r.status, r.body.code]).toEqual([422, 'QR_TOKEN_INVALID']);
    expect(await qw.sales(customer.walletId)).toBe(1);
    expect(await qw.pw.spendable(customer.walletId)).toBe(19_000);
  });
});
