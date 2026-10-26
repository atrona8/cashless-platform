// Annulation par le vendeur de la vente depuis son terminal (mission 5b, lot WP12, T055 et T059 ; FR-016, NFR-005 ;
// ADR-123 ; A5, A8, A9, A19). HTTPS réel, trois preuves, vraie base. La fenêtre se teste en reculant `recorded_at`
// (propriétaire), jamais en attendant ni en comparant l'horloge de Node à celle de la base.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { reversalContent } from '../../../src/reversals/reversal.dto';
import { contractViolations } from '../../support/contract-schema';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { ReversalWorld } from './reversal-fixtures';

jest.setTimeout(240_000);

describe('reversePayment : le vendeur de la vente (WP12)', () => {
  let rw: ReversalWorld;
  beforeAll(async () => {
    rw = await ReversalWorld.create();
  });
  afterAll(async () => {
    await rw?.close();
  });
  const terminal = () => rw.pw.terminal({ mode: 'KEYPAD_TPE' });
  const problem = (res: { status: number; body: Record<string, unknown> }) => [
    res.status,
    res.body.code,
  ];

  it('FR-016 : dans la fenêtre → 201 REVERSAL lié, solde rendu, attribué au vendeur, numéro accepté', async () => {
    const term = await terminal();
    const sale = await rw.sell(term, 4000);
    expect(await rw.pw.spendable(sale.media.walletId)).toBe(16_000);
    const key = term.t.seqKey();
    const occurredAt = new Date().toISOString();
    const res = await rw.reverse(term, sale.id, { key, body: { occurred_at: occurredAt } });
    expect(res.status).toBe(201);
    expect(contractViolations('PaymentResult', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      type: 'REVERSAL',
      status: 'SUCCEEDED',
      reverses_id: sale.id,
      amount: 4000,
      currency: 'XOF',
      idempotency_key: key,
      vendor: { vendor_id: rw.pw.vendorId },
      balance_after: { spendable: 20_000, paid: 20_000, promo: 0 },
    });
    expect(await rw.pw.spendable(sale.media.walletId)).toBe(20_000);
    const reversalId = String(res.body.transaction_id);
    expect(await rw.reversalsOf(sale.id)).toEqual([
      { id: reversalId, source: 'ONLINE', type: 'REVERSAL', approved_by: null },
    ]);
    expect(
      await ownerRows(
        'SELECT vendor_id, vendor_session_id, device_id FROM sale_attribution WHERE transaction_id = $1',
        [reversalId],
      ),
    ).toEqual([
      { vendor_id: rw.pw.vendorId, vendor_session_id: term.sessionId, device_id: term.t.deviceId },
    ]);
    const seq = BigInt(key.split(':')[1]!);
    const registry = (await rw.pw.registry(term.t.deviceId)).find((r) => r.seq === String(seq));
    expect(registry).toMatchObject({ outcome: 'ACCEPTED', transaction_id: reversalId });
    // Contenu du registre : champs chaînés seulement (seq, type, occurred_at, reverses_transaction_id).
    expect(
      registry!.content_sha256.equals(reversalContent(seq, sale.id, { occurred_at: occurredAt })!),
    ).toBe(true);
  });

  it('rejeu de la clé : même réponse, aucune seconde annulation', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const key = term.t.seqKey();
    const body = { occurred_at: new Date().toISOString() };
    const first = await rw.reverse(term, sale.id, { key, body });
    const again = await rw.reverse(term, sale.id, { key, body });
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body).toEqual(first.body);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
  });

  it('seconde annulation → 409 ALREADY_REVERSED (par la base, jamais un 23505 générique), numéro rangé', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    expect((await rw.reverse(term, sale.id)).status).toBe(201);
    const key = term.t.seqKey();
    const second = await rw.reverse(term, sale.id, { key });
    expect(problem(second)).toEqual([409, 'ALREADY_REVERSED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
    const seq = key.split(':')[1]!.replace(/^0+/, '');
    expect((await rw.pw.registry(term.t.deviceId)).find((r) => r.seq === seq)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'ALREADY_REVERSED',
    });
  });

  it('autre vendeur, même terminal → 422 REVERSAL_NOT_ALLOWED, rien d’écrit', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const otherVendor = await rw.otherVendor();
    await withOwner((db) =>
      db.query(
        `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
        [term.sessionId],
      ),
    );
    await rw.pw.openSession(term, otherVendor);
    const res = await rw.reverse(term, sale.id);
    expect(problem(res)).toEqual([422, 'REVERSAL_NOT_ALLOWED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
    expect(await rw.pw.spendable(sale.media.walletId)).toBe(16_000);
  });

  it('autre terminal (même vendeur) → 422 REVERSAL_NOT_ALLOWED', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const other = await terminal();
    const res = await rw.reverse(other, sale.id);
    expect(problem(res)).toEqual([422, 'REVERSAL_NOT_ALLOWED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('ADR-123 : bon vendeur hors fenêtre → 409 REVERSAL_WINDOW_EXPIRED ; autre vendeur hors fenêtre → 422 (l’âge de la vente ne fuit pas)', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    await rw.ageSale(sale.id, 16);
    expect(problem(await rw.reverse(term, sale.id))).toEqual([409, 'REVERSAL_WINDOW_EXPIRED']);
    const other = await terminal();
    expect(problem(await rw.reverse(other, sale.id))).toEqual([422, 'REVERSAL_NOT_ALLOWED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('A5 : occurred_at du terminal dans la fenêtre mais recorded_at hors fenêtre → refus', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    await rw.ageSale(sale.id, 30);
    const res = await rw.reverse(term, sale.id, {
      body: { occurred_at: new Date().toISOString() },
    });
    expect(problem(res)).toEqual([409, 'REVERSAL_WINDOW_EXPIRED']);
  });

  it('terminal suspendu avec session ouverte → refus, rien d’écrit', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    await withOwner((db) => term.t.setStatus(db, 'SUSPENDED'));
    const res = await rw.reverse(term, sale.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('A8 : supervisor_pin_proof → 422 VALIDATION_FAILED, rien d’écrit', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const res = await rw.reverse(term, sale.id, { body: { supervisor_pin_proof: 'x' } });
    expect(problem(res)).toEqual([422, 'VALIDATION_FAILED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('<serial> étranger dans la clé → 422 VALIDATION_FAILED, aucun numéro rangé', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const before = (await rw.pw.registry(term.t.deviceId)).length;
    const res = await rw.reverse(term, sale.id, { key: 'AUTRE-SERIE:0099' });
    expect(problem(res)).toEqual([422, 'VALIDATION_FAILED']);
    expect((await rw.pw.registry(term.t.deviceId)).length).toBe(before);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('vente inconnue ou d’un autre prestataire → 404 (pas de fuite d’existence)', async () => {
    const term = await terminal();
    expect(problem(await rw.reverse(term, randomUUID()))).toEqual([404, 'NOT_FOUND']);
  });

  it('une annulation ne s’annule pas, et seule une vente s’annule → 422 REVERSAL_NOT_ALLOWED', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const reversal = await rw.reverse(term, sale.id);
    expect(problem(await rw.reverse(term, String(reversal.body.transaction_id)))).toEqual([
      422,
      'REVERSAL_NOT_ALLOWED',
    ]);
  });

  it('vendor_session_id absent → 409 VENDOR_SESSION_INVALID ; corps sans reason → 422', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    expect(problem(await rw.reverse(term, sale.id, { session: null }))).toEqual([
      409,
      'VENDOR_SESSION_INVALID',
    ]);
    expect((await rw.reverse(term, sale.id, { body: { reason: 'AUTRE' } })).status).toBe(422);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('ordre des gardes (reports WP09/WP11) : session fermée pendant l’attente du verrou → 409, rien d’écrit', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const res = await commitWhileWaiting(
      {
        sql: `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
        params: [term.sessionId],
      },
      { role: 'cashless_app', statement: 'assert_vendor_session' },
      () => rw.reverse(term, sale.id),
    );
    expect(problem(res)).toEqual([409, 'VENDOR_SESSION_INVALID']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('ordre des verrous : le terminal est pris AVANT la session (la requête attend le terminal, pas la session)', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const res = await commitWhileWaiting(
      {
        sql: 'UPDATE device SET app_version = app_version WHERE id = $1',
        params: [term.t.deviceId],
      },
      { role: 'cashless_app', statement: 'FOR UPDATE OF d' },
      () => rw.reverse(term, sale.id),
    );
    expect(res.status).toBe(201);
  });

  it('terminal suspendu entre la garde d’identité et la prise du verrou : refus par assert_device_active, rien d’écrit', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const res = await commitWhileWaiting(
      {
        sql: `UPDATE device SET status = 'SUSPENDED' WHERE id = $1`,
        params: [term.t.deviceId],
      },
      { role: 'cashless_app', statement: 'FOR UPDATE OF d' },
      () => rw.reverse(term, sale.id),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('refus 4xx : le numéro est enregistré à part (REJECTED), contenu = champs chaînés', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const key = term.t.seqKey();
    expect((await rw.reverse(term, sale.id, { key, body: { reason: 'AUTRE' } })).status).toBe(422);
    const seq = String(Number(key.split(':')[1]));
    expect((await rw.pw.registry(term.t.deviceId)).find((r) => r.seq === seq)).toMatchObject({
      outcome: 'REJECTED',
    });
  });

  it('NFR-005 : 20 annulations simultanées de la même vente → exactement 1', async () => {
    const term = await terminal();
    const sale = await rw.sell(term, 4000);
    const results = await Promise.all(Array.from({ length: 20 }, () => rw.reverse(term, sale.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.code === 'ALREADY_REVERSED'),
    ).toBe(true);
    expect(statuses.filter((s) => s !== 201 && s !== 409)).toEqual([]);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
    expect(await rw.pw.spendable(sale.media.walletId)).toBe(20_000);
  });
});
