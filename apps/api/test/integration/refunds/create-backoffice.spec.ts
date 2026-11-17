// Intégration (mission 9b, WP11 ; FR-017, OP-N123) : `createRefundRequest` (POST /refund-requests, back-office).
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { freshPhone } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows as rows } from '../../support/media-fixtures';
import { setEvent } from './create-fixtures';
import { expectRefundInvariants } from './refund-invariants';
import {
  call,
  confirm,
  createRefundWorld,
  createStaff,
  proposeApproval,
  executeApproval,
  requestState,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';
import { fundedCustomer } from './create-fixtures';

jest.setTimeout(300_000);

// IBAN d'exemple valides (clé de contrôle correcte) : France et Sénégal.
const IBAN = 'FR1420041010050500013M02606';
const IBAN_SN = 'SN08SN0100152000048500003035';
const REASON = 'Virement demandé par le festivalier au guichet';

describe('création d’une demande de remboursement par le back-office (POST /refund-requests)', () => {
  let r: RefundWorld;
  let s: Staff;
  const create = (who: TestPerson | null, body: unknown, key?: string) =>
    call(r.app, who, '/refund-requests', body, key);
  const bank = (walletId: string, iban: string = IBAN) => ({
    wallet_id: walletId,
    destination: { method: 'BANK_TRANSFER', iban },
    reason: REASON,
  });
  const lines = (walletId: string) =>
    rows<{ id: string }>('SELECT id FROM refund_request WHERE wallet_id = $1', [walletId]);

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  });
  afterAll(async () => {
    await r.app.close();
  });

  it('FR-017 : virement créé par A (requested_by = A), proposé par B, exécuté par C, confirmé PAID ; IBAN absent de la réponse et de l’audit', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const created = await create(s.adminA, bank(c.walletId, 'fr14 2004 1010 0505 0001 3m02 606'));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'REQUESTED',
      estimated_amount: 24_500,
      fee: 500,
      destination: { method: 'BANK_TRANSFER' },
    });
    expect(contractViolations('RefundRequest', created.body)).toEqual([]);
    expect(JSON.stringify(created.body)).not.toContain('FR14');
    const id = created.body.refund_request_id as string;
    // IBAN stocké normalisé (jamais la saisie brute) ; requested_by = l'auteur.
    const [row] = await rows<{ iban: string; requested_by: string; msisdn: string | null }>(
      'SELECT iban, requested_by, msisdn FROM refund_request WHERE id = $1',
      [id],
    );
    expect(row).toEqual({ iban: IBAN, requested_by: s.adminA.userId, msisdn: null });
    // Audit : raison présente, IBAN masqué.
    const [audit] = await rows<{ after: Record<string, unknown>; actor_id: string }>(
      `SELECT after, actor_id FROM audit_log WHERE action = 'REFUND_REQUEST_CREATED' AND object_id = $1`,
      [id],
    );
    expect(audit!.actor_id).toBe(s.adminA.userId);
    expect(audit!.after).toMatchObject({ reason: REASON, iban: 'FR14*******************2606' });
    expect(JSON.stringify(audit)).not.toContain('2004101005');
    // Approbation proposée par B, exécutée par C : le WALLET_REFUND virement s'exécute (A-BANQUE).
    const proposed = await proposeApproval(r, s.adminB, id);
    expect(proposed.status).toBe(202);
    const executed = await executeApproval(r, s.adminC, proposed.body.approval_request_id);
    expect(executed.status).toBe(200);
    expect((await requestState(id)).status).toBe('PROCESSING');
    const paid = await confirm(r, s.adminB, id, { outcome: 'PAID', external_reference: 'VIR-1' });
    expect([paid.status, paid.body.status]).toEqual([200, 'PAID']);
    const [bankLine] = await rows<{ s: string }>(
      `SELECT sum(p.amount)::text AS s FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 AND a.code = 'A-BANQUE'`,
      [(await requestState(id)).transaction_id],
    );
    expect(Number(bankLine!.s)).toBe(-24_500);
    await expectRefundInvariants({ ledgerId: r.w.ids.ledgerA });
  });

  it('FR-017 : le demandeur ne valide pas sa propre demande (approbation exécutée par A : refus, demande REQUESTED)', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const id = (await create(s.adminA, bank(c.walletId))).body.refund_request_id as string;
    const proposed = await proposeApproval(r, s.adminB, id);
    expect(proposed.status).toBe(202);
    const attempt = await executeApproval(r, s.adminA, proposed.body.approval_request_id);
    // La CHECK `refund_request_two_persons` refuse l'écriture : l'approbation échoue proprement (`failure()`).
    expect(attempt.body.status).toBe('FAILED');
    const state = await requestState(id);
    expect([state.status, state.transaction_id, state.approved_by]).toEqual([
      'REQUESTED',
      null,
      null,
    ]);
    const [approval] = await rows<{ status: string }>(
      'SELECT status FROM approval_request WHERE id = $1',
      [proposed.body.approval_request_id],
    );
    expect(approval!.status).toBe('FAILED');
  });

  it('FR-017 : IBAN mal formé (clé fausse, pays inconnu, longueur, caractères) : 422, aucune ligne', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    for (const bad of [
      'FR1520041010050500013M02606', // clé de contrôle fausse
      'XX1420041010050500013M02606', // pays inconnu
      'FR142004101005050001', // longueur
      'FR14-2004!1010050500013M02606', // caractère interdit
      'FR14',
    ]) {
      const res = await create(s.adminA, bank(c.walletId, bad));
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    expect(await lines(c.walletId)).toEqual([]);
  });

  it('corps strict : champ inconnu, msisdn avec virement, iban avec Wave, reason courte : 422', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const bad: unknown[] = [
      { ...bank(c.walletId), extra: 1 },
      { ...bank(c.walletId), reason: 'court' },
      {
        wallet_id: c.walletId,
        destination: { method: 'BANK_TRANSFER', iban: IBAN, msisdn: '+221770000001' },
        reason: REASON,
      },
      {
        wallet_id: c.walletId,
        destination: { method: 'WAVE', iban: IBAN, msisdn: '+221770000001' },
        reason: REASON,
      },
      { wallet_id: c.walletId, destination: { method: 'WAVE' }, reason: REASON },
      { wallet_id: c.walletId, destination: { method: 'CASH' }, reason: REASON },
    ];
    for (const body of bad) expect((await create(s.adminA, body)).status).toBe(422);
    expect(await lines(c.walletId)).toEqual([]);
  });

  it('rôles et portée : SUPERVISOR et CASHIER 403, sans jeton 401, portefeuille inconnu 404, ORGANIZER_ADMIN de l’événement accepté', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    for (const who of [r.w.supervisorA, r.w.cashierA])
      expect((await create(who, bank(c.walletId))).status).toBe(403);
    expect((await create(null, bank(c.walletId))).status).toBe(401);
    expect((await create(s.adminA, bank(randomUUID()))).status).toBe(404);
    expect(await lines(c.walletId)).toEqual([]);
    const ok = await create(r.w.organizerAdminA, bank(c.walletId));
    expect(ok.status).toBe(201);
  });

  it('une seule demande ouverte par portefeuille : REFUND_ALREADY_OPEN ; rejeu avec la même clé : même réponse, une ligne', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const key = randomUUID();
    const first = await create(s.adminA, bank(c.walletId), key);
    expect(first.status).toBe(201);
    const replay = await create(s.adminA, bank(c.walletId), key);
    expect(replay.body).toEqual(first.body);
    const second = await create(s.adminB, bank(c.walletId));
    expect([second.status, second.body.code]).toEqual([409, 'REFUND_ALREADY_OPEN']);
    expect(await lines(c.walletId)).toHaveLength(1);
  });

  it('mêmes refus d’éligibilité que l’app : fenêtre close, solde payé nul', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const empty = await fundedCustomer(r.w, 0);
    expect([(await create(s.adminA, bank(empty.walletId))).status]).toEqual([422]);
    await setEvent(r.w, 'refund_deadline = NULL, ends_at = NULL');
    try {
      const res = await create(s.adminA, bank(c.walletId));
      expect([res.status, res.body.code]).toEqual([422, 'REFUND_WINDOW_CLOSED']);
    } finally {
      await setEvent(r.w, "refund_deadline = now() + interval '10 days', ends_at = NULL");
    }
    expect(await lines(c.walletId)).toEqual([]);
  });

  it('virement au-delà de refund_new_number_max : extra_check_required, note exigée à l’approbation', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    await setEvent(r.w, 'refund_new_number_max = 1000');
    try {
      const res = await create(s.adminA, bank(c.walletId, IBAN_SN));
      expect([res.status, res.body.extra_check_required]).toEqual([201, true]);
      const noNote = await proposeApproval(r, s.adminB, res.body.refund_request_id);
      expect(noNote.status).toBeGreaterThanOrEqual(400);
      expect(
        (await proposeApproval(r, s.adminB, res.body.refund_request_id, { note: 'Pièce vue' }))
          .status,
      ).toBe(202);
    } finally {
      await setEvent(r.w, 'refund_new_number_max = 50000');
    }
  });

  it('Wave : numéro du titulaire vérifié : REQUESTED ; autre numéro : AWAITING_HOLDER avec code envoyé au titulaire ; titulaire sans compte : REQUESTED', async () => {
    const holder = await fundedCustomer(r.w, 25_000);
    const same = await create(s.adminA, {
      wallet_id: holder.walletId,
      destination: { method: 'WAVE', msisdn: holder.phone },
      reason: REASON,
    });
    expect([same.status, same.body.status, same.body.new_number]).toEqual([
      201,
      'REQUESTED',
      false,
    ]);
    const other = await fundedCustomer(r.w, 25_000);
    const sentBefore = r.sender.count(other.phone);
    const foreign = await create(s.adminA, {
      wallet_id: other.walletId,
      destination: { method: 'ORANGE_MONEY', msisdn: freshPhone() },
      reason: REASON,
    });
    expect([foreign.status, foreign.body.status, foreign.body.new_number]).toEqual([
      201,
      'AWAITING_HOLDER',
      true,
    ]);
    expect(r.sender.count(other.phone)).toBe(sentBefore + 1);
    expect(foreign.body.hold_until).not.toBeNull();
    // Bracelet sans compte : pas de titulaire à interroger.
    const anon = await fundedCustomer(r.w, 25_000);
    await withOwner((db) =>
      db.query('UPDATE wallet SET customer_id = NULL WHERE id = $1', [anon.walletId]),
    );
    const noOwner = await create(s.adminA, {
      wallet_id: anon.walletId,
      destination: { method: 'WAVE', msisdn: freshPhone() },
      reason: REASON,
    });
    expect([noOwner.status, noOwner.body.status]).toEqual([201, 'REQUESTED']);
    const [row] = await rows<{ customer_id: string | null; requested_by: string }>(
      'SELECT customer_id, requested_by FROM refund_request WHERE id = $1',
      [noOwner.body.refund_request_id],
    );
    expect(row).toEqual({ customer_id: null, requested_by: s.adminA.userId });
  });

  it('le remboursement du back-office n’émet jamais waiveFee : frais normaux dans l’écriture', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const id = (await create(s.adminA, bank(c.walletId))).body.refund_request_id as string;
    const proposed = await proposeApproval(r, s.adminB, id);
    await executeApproval(r, s.adminC, proposed.body.approval_request_id);
    const state = await requestState(id);
    const fee = await rows<{ amount: string }>(
      `SELECT p.amount::text FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 AND a.code = 'L-ORG-FFEST'`,
      [state.transaction_id],
    );
    expect(fee.length).toBeGreaterThan(0);
    expect(fee.reduce((n, x) => n + Number(x.amount), 0)).toBe(-500);
  });
});
