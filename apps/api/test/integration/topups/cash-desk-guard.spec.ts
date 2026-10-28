// Intégration : la session décide de la caisse (FR-004, FR-008 ; A8, A27), prouvée par l'API. Pour chaque route
// d'espèces (`createCashTopup`, `takeDeposit`, `refundDeposit`, `refundCashDue`) : sans session ouverte du
// terminal, 409 et rien d'écrit ; avec session, réussite, rattachement à la session et `cash_session_id` renvoyé.
// Aucune réponse de ces routes, ni de la lecture des sessions par un `CASHIER`, ne porte de solde de la caisse.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createCashWorld, type CashWorld } from '../../support/cash-fixtures';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  ownerRows as rows,
  tapBody,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('garde de caisse : la session ouverte du terminal, par l’API', () => {
  let c: CashWorld;
  const responses: unknown[] = [];

  beforeAll(async () => {
    c = await createCashWorld();
    await rows('UPDATE event SET cash_refund_single_max = 10000 WHERE id = $1', [c.w.ids.eventA]);
  });
  afterAll(async () => {
    await c.close();
  });

  const post = (path: string, body: object, device = c.device) =>
    request(c.app.getHttpServer())
      .post(path)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${c.w.cashierA.token}`)
      .send(body);
  const attached = (tx: string) =>
    rows<{ cash_session_id: string }>(
      'SELECT cash_session_id FROM cash_session_tx WHERE tx_id = $1',
      [tx],
    );
  /** Bracelet d'un lot `SEPARATE` activé hors API : caution due, aucune espèce encore versée. */
  const dueSeparate = async (): Promise<SeededMedia> => {
    const m = await c.fresh(c.batches.separate);
    const walletId = randomUUID();
    await withOwner(async (db) => {
      await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
        walletId,
        c.w.ops.a,
        c.w.ids.ledgerA,
      ]);
      await activateMedia(db, {
        operatorId: c.w.ops.a,
        eventId: c.w.ids.eventA,
        walletId,
        mediaIds: [m.id],
      });
      // Une caution payée à part est due tant qu'aucune espèce n'est versée.
      await db.query(`UPDATE media SET deposit_status = 'DUE' WHERE id = $1`, [m.id]);
    });
    expect(await rows('SELECT deposit_status FROM media WHERE id = $1', [m.id])).toEqual([
      { deposit_status: 'DUE' },
    ]);
    return m;
  };

  it('createCashTopup : sans session 409, rien d’écrit ; avec session 201, rattachée, cash_session_id renvoyé', async () => {
    const m = await c.fresh(c.batches.plain);
    expect((await c.activate(m)).status).toBe(201);
    const before = await c.counts();
    const refused = await c.topup(c.topupBody(m, 4321), { device: c.noSession });
    expect(refused.status).toBe(409);
    responses.push(refused.body);
    expect(await c.counts()).toEqual(before);
    const ok = await c.topup(c.topupBody(m, 4321));
    expect(ok.status).toBe(201);
    responses.push(ok.body);
    expect(ok.body.cash_session_id).toBe(c.session.sessionId);
    expect(await attached(ok.body.transaction_id)).toEqual([
      { cash_session_id: c.session.sessionId },
    ]);
    // Seconde recharge (autre bracelet) : le solde de la caisse (5432) n'égale aucun montant des réponses.
    const m2 = await c.fresh(c.batches.plain);
    expect((await c.activate(m2)).status).toBe(201);
    const second = await c.topup(c.topupBody(m2, 1111));
    expect(second.status).toBe(201);
    responses.push(second.body);
  });

  it('takeDeposit puis refundDeposit (espèces) : sans session 409, bracelet inchangé ; avec session 200, rattachés', async () => {
    const m = await dueSeparate();
    const take = (device = c.device) =>
      post(`/v1/media/${m.id}/deposit`, { payment: { method: 'CASH' } }, device);
    const refused = await take(c.noSession);
    expect(refused.status).toBe(409);
    responses.push(refused.body);
    expect(await rows('SELECT deposit_status FROM media WHERE id = $1', [m.id])).toEqual([
      { deposit_status: 'DUE' },
    ]);
    const taken = await take();
    expect(taken.status).toBe(200);
    responses.push(taken.body);
    expect(taken.body).toMatchObject({
      status: 'HELD',
      amount: 1000,
      cash_session_id: c.session.sessionId,
    });
    expect(await attached(taken.body.transaction_id)).toEqual([
      { cash_session_id: c.session.sessionId },
    ]);

    const refund = (device = c.device) =>
      post(
        `/v1/media/${m.id}/deposit/refund`,
        { tap: tapBody(m, c.next()), payment: { method: 'CASH' } },
        device,
      );
    const refundRefused = await refund(c.noSession);
    expect(refundRefused.status).toBe(409);
    responses.push(refundRefused.body);
    expect(await rows('SELECT deposit_status FROM media WHERE id = $1', [m.id])).toEqual([
      { deposit_status: 'HELD' },
    ]);
    const refunded = await refund();
    expect(refunded.status).toBe(200);
    responses.push(refunded.body);
    expect(refunded.body).toMatchObject({
      status: 'REFUNDED',
      cash_session_id: c.session.sessionId,
    });
    expect(await attached(refunded.body.transaction_id)).toEqual([
      { cash_session_id: c.session.sessionId },
    ]);
  });

  it('refundCashDue : sans session 409, anomalie ouverte ; avec session 201, rattaché, cash_session_id renvoyé', async () => {
    const m = await c.fresh(c.batches.plain);
    expect((await c.activate(m)).status).toBe(201);
    // Espèces dues : recharge hors ligne découpée (écriture de jeu d'essai) puis anomalie, sous la session.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [c.w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', 2500::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -2500::bigint)))`,
        [c.w.ids.ledgerA, `test-cash-over:${randomUUID()}`, c.session.code],
      );
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount)
         VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, 2500)`,
        [c.w.ops.a, c.w.ids.ledgerA, m.id],
      );
    });
    const open = () =>
      rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND status = 'OPEN'`,
        [m.id],
      ).then((r) => r[0]!.n);
    const refund = (device = c.device) =>
      post(`/v1/media/${m.id}/cash-due-refunds`, { tap: tapBody(m, c.next()) }, device);
    const refused = await refund(c.noSession);
    expect(refused.status).toBe(409);
    responses.push(refused.body);
    expect(await open()).toBe(1);
    const done = await refund();
    expect(done.status).toBe(201);
    responses.push(done.body);
    expect(done.body.cash_session_id).toBe(c.session.sessionId);
    expect(await attached(done.body.transaction_id)).toEqual([
      { cash_session_id: c.session.sessionId },
    ]);
    expect(await open()).toBe(0);
  });

  it('aucune réponse ne porte de solde de la caisse (A27), y compris la lecture des sessions par un CASHIER', async () => {
    const list = await request(c.app.getHttpServer())
      .get(`/v1/events/${c.w.ids.eventA}/cash-sessions`)
      .set('Authorization', `Bearer ${c.w.cashierA.token}`);
    expect(list.status).toBe(403);
    responses.push(list.body);
    const one = await request(c.app.getHttpServer())
      .get(`/v1/cash-sessions/${c.session.sessionId}`)
      .set('Authorization', `Bearer ${c.w.cashierA.token}`);
    responses.push(one.body);
    // Le solde courant de la caisse est une valeur que le balayage ne doit retrouver nulle part.
    const balances = [await c.balance(c.session.code), await c.balance(c.otherSession.code)];
    expect(balances[0]).toBeGreaterThan(0);
    const text = JSON.stringify(responses);
    expect(responses.length).toBeGreaterThanOrEqual(10);
    // Aucun champ de solde ou de théorique de la caisse porte une valeur (la session ouverte les rend à `null`).
    const leaks: string[] = [];
    const walk = (value: unknown, key = ''): void => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (typeof value === 'object' && value !== null)
        Object.entries(value).forEach(([k, v]) => walk(v, k));
      else if (value !== null && /expected|theoretical|cash_balance|difference/i.test(key))
        leaks.push(key);
    };
    walk(responses);
    expect(leaks).toEqual([]);
    for (const b of balances.filter((v) => v > 0))
      expect(text).not.toMatch(new RegExp(`(?<![0-9])${b}(?![0-9])`));
  });
});
