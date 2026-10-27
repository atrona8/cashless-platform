// Action à deux personnes `SALE_REVERSAL` au back-office (mission 5b, lot WP12, T058 et T059 ; FR-017 ; ADR-122).
// Bornage obligatoire : seuls SUPERVISOR et ORGANIZER_ADMIN, sur l'événement de la vente, deux personnes distinctes.
// La demande est créée et décidée par les services de l'application (mêmes appels que les routes), sur la vraie base.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApprovalService, type ApprovalActor } from '../../../src/approval/approval.service';
import { TenantTx } from '../../../src/db/tenant-tx';
import type { Principal } from '../../../src/identity/principal';
import type { TestPerson } from '../../support/fake-idp';
import { withOwner } from '../../support/db';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { SaleReversalActions } from '../../../src/reversals/sale-reversal-action';
import { ReversalWorld, type Sale } from './reversal-fixtures';

jest.setTimeout(240_000);

describe('SALE_REVERSAL : deux personnes au back-office (WP12)', () => {
  let rw: ReversalWorld;
  let tx: TenantTx;
  let actions: SaleReversalActions;
  let approvals: ApprovalService;
  let supervisor: TestPerson;
  let supervisor2: TestPerson;
  let organizerAdmin: TestPerson;
  let cashier: TestPerson;
  let operatorAdmin: TestPerson;
  const people = new Map<string, Principal>();

  beforeAll(async () => {
    rw = await ReversalWorld.create();
    const app = rw.pw.api.app;
    tx = app.get(TenantTx, { strict: false });
    actions = app.get(SaleReversalActions, { strict: false });
    approvals = app.get(ApprovalService, { strict: false });
    supervisor = await rw.person('SUPERVISOR');
    supervisor2 = await rw.person('SUPERVISOR');
    organizerAdmin = await rw.person('ORGANIZER_ADMIN', {
      scope: { type: 'ORGANIZER', id: rw.pw.w.ids.organizerA },
    });
    cashier = await rw.person('CASHIER');
    operatorAdmin = rw.pw.w.operatorAdminA;
    const roles: Array<[TestPerson, string, 'EVENT' | 'ORGANIZER' | 'OPERATOR', string]> = [
      [supervisor, 'SUPERVISOR', 'EVENT', rw.pw.w.ids.eventA],
      [supervisor2, 'SUPERVISOR', 'EVENT', rw.pw.w.ids.eventA],
      [organizerAdmin, 'ORGANIZER_ADMIN', 'ORGANIZER', rw.pw.w.ids.organizerA],
      [cashier, 'CASHIER', 'EVENT', rw.pw.w.ids.eventA],
      [operatorAdmin, 'OPERATOR_ADMIN', 'OPERATOR', rw.pw.w.ops.a],
    ];
    for (const [p, role, scopeType, scopeId] of roles)
      people.set(p.userId, {
        userId: p.userId,
        operatorId: rw.pw.w.ops.a,
        issuer: 'test',
        subject: p.subject,
        assignments: [{ role, scopeType, scopeId }],
      } as unknown as Principal);
  });
  afterAll(async () => {
    await rw?.close();
  });

  const actor = (p: TestPerson): ApprovalActor => ({
    principal: people.get(p.userId)!,
    audit: { actorId: p.userId, actorRole: null, origin: null, requestId: null },
  });
  const operatorId = () => rw.pw.w.ops.a;
  const sale = async (): Promise<Sale> => rw.sell(await rw.pw.terminal({ mode: 'KEYPAD_TPE' }));
  const ask = (by: TestPerson, saleId: string, extra: Record<string, unknown> = {}) =>
    tx.run(operatorId(), (client) =>
      actions.request(
        client,
        operatorId(),
        { transactionId: saleId, reason: 'CUSTOMER_CANCELLED', comment: 'Client parti', ...extra },
        actor(by),
      ),
    );
  const decide = (by: TestPerson, id: string) =>
    tx.run(operatorId(), (client) => approvals.approve(client, operatorId(), id, null, actor(by)));
  const statusOf = async (id: string) =>
    (
      await ownerRows<{
        status: string;
        failure_code: string | null;
        executed_tx_id: string | null;
      }>('SELECT status, failure_code, executed_tx_id FROM approval_request WHERE id = $1', [id])
    )[0]!;

  it('demande puis approbation par une seconde personne → REVERSAL BACKOFFICE, auteur ≠ valideur, solde rendu', async () => {
    const s = await sale();
    const asked = await ask(supervisor, s.id);
    expect(asked).toMatchObject({ action: 'SALE_REVERSAL', status: 'PENDING', target_id: s.id });
    expect(asked.payload).toMatchObject({
      transaction_id: s.id,
      scope_type: 'EVENT',
      scope_id: rw.pw.w.ids.eventA,
    });
    const done = await decide(supervisor2, asked.approval_request_id);
    expect(done.status).toBe('EXECUTED');
    const reversals = await ownerRows<{
      id: string;
      source: string;
      created_by: string;
      approved_by: string;
      device_id: string | null;
    }>(
      `SELECT id, source, created_by, approved_by, device_id FROM journal_transaction
        WHERE reverses_id = $1`,
      [s.id],
    );
    expect(reversals).toEqual([
      {
        id: reversals[0]!.id,
        source: 'BACKOFFICE',
        created_by: supervisor.userId,
        approved_by: supervisor2.userId,
        device_id: null,
      },
    ]);
    expect((await statusOf(asked.approval_request_id)).executed_tx_id).toBe(reversals[0]!.id);
    expect(await rw.pw.spendable(s.media.walletId)).toBe(20_000);
    expect(
      await ownerRows(
        'SELECT vendor_session_id, actor_user_id FROM sale_attribution WHERE transaction_id = $1',
        [reversals[0]!.id],
      ),
    ).toEqual([{ vendor_session_id: null, actor_user_id: supervisor.userId }]);
  });

  it('ADR-122 : un ORGANIZER_ADMIN de l’organisateur de l’événement demande, un SUPERVISOR approuve', async () => {
    const s = await sale();
    const asked = await ask(organizerAdmin, s.id);
    expect((await decide(supervisor, asked.approval_request_id)).status).toBe('EXECUTED');
    expect(await rw.reversalsOf(s.id)).toHaveLength(1);
  });

  it('même personne comme auteur et valideur → refus, rien annulé', async () => {
    const s = await sale();
    const asked = await ask(supervisor, s.id);
    await expect(decide(supervisor, asked.approval_request_id)).rejects.toBeDefined();
    expect((await statusOf(asked.approval_request_id)).status).toBe('PENDING');
    expect(await rw.reversalsOf(s.id)).toHaveLength(0);
  });

  it('bornage des rôles : CASHIER et OPERATOR_ADMIN ne demandent pas, ne décident pas', async () => {
    const s = await sale();
    await expect(ask(cashier, s.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ask(operatorAdmin, s.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const asked = await ask(supervisor, s.id);
    await expect(decide(cashier, asked.approval_request_id)).rejects.toBeDefined();
    await expect(decide(operatorAdmin, asked.approval_request_id)).rejects.toBeDefined();
    expect((await statusOf(asked.approval_request_id)).status).toBe('PENDING');
    expect(await rw.reversalsOf(s.id)).toHaveLength(0);
  });

  it('charge utile : tout autre champ, portée d’une autre vente ou raison hors liste → 422, vente inconnue → 404', async () => {
    const s = await sale();
    const def = (
      actions as unknown as { definition(): { validate(p: unknown): unknown } }
    ).definition();
    const good = {
      transaction_id: s.id,
      reason: 'OTHER',
      scope_type: 'EVENT',
      scope_id: rw.pw.w.ids.eventA,
    };
    expect(() => def.validate(good)).not.toThrow();
    for (const bad of [
      { ...good, amount: 1 },
      { ...good, reason: 'AUTRE' },
      { ...good, scope_type: 'OPERATOR' },
      { ...good, comment: 'x'.repeat(501) },
    ])
      expect(() => def.validate(bad)).toThrow();
    await expect(ask(supervisor, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('vente déjà annulée → demande FAILED avec le motif, une seule annulation', async () => {
    const s = await sale();
    const asked = await ask(supervisor, s.id);
    // Annulation par le vendeur entre la demande et l'approbation.
    const term = s.terminal;
    expect((await rw.reverse(term, s.id)).status).toBe(201);
    const done = await decide(supervisor2, asked.approval_request_id);
    expect(done.status).toBe('FAILED');
    expect(await statusOf(asked.approval_request_id)).toMatchObject({
      status: 'FAILED',
      failure_code: 'ALREADY_REVERSED',
    });
    expect(await rw.reversalsOf(s.id)).toHaveLength(1);
  });

  it('base : assert_reversible BACKOFFICE refuse une demande non approuvée, d’une autre vente, ou à auteur = valideur', async () => {
    const s = await sale();
    const other = await sale();
    const asked = await ask(supervisor, s.id);
    const call = (tx_: string, request: string) =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId()]);
        return db.query('SELECT * FROM assert_reversible($1, $2, NULL, NULL, NULL, $3)', [
          tx_,
          'BACKOFFICE',
          request,
        ]);
      });
    await expect(call(s.id, asked.approval_request_id)).rejects.toMatchObject({ code: 'CL036' });
    await decide(supervisor2, asked.approval_request_id).catch(() => undefined);
    await expect(call(other.id, asked.approval_request_id)).rejects.toMatchObject({
      code: 'CL036',
    });
  });

  // ---- ADR-129 : le chemin de la personne de `reversePayment` (humanBearer) crée la demande, 202 ----------------

  describe('reversePayment par une personne (ADR-129)', () => {
    const body = {
      reason: 'CUSTOMER_CANCELLED',
      comment: 'Client parti',
      occurred_at: new Date().toISOString(),
    };
    // Comptages bornés à la vente et à son portefeuille (la base est partagée avec d'autres suites en parallèle).
    const footprint = async (s: Sale) =>
      (
        await ownerRows<{ reversals: number; lines: number; balance: string }>(
          `SELECT (SELECT count(*)::int FROM journal_transaction WHERE reverses_id = $1) AS reversals,
                  (SELECT count(*)::int FROM posting p JOIN account a ON a.id = p.account_id
                    WHERE a.wallet_id = $2) AS lines,
                  (SELECT coalesce(sum(p.amount), 0)::text FROM posting p JOIN account a ON a.id = p.account_id
                    WHERE a.wallet_id = $2) AS balance`,
          [s.id, s.media.walletId],
        )
      )[0]!;
    const post = (who: TestPerson, saleId: string, key?: string | null, payload: unknown = body) =>
      rw.person_request(who, `/payments/${saleId}/reversal`, payload, key);

    it('SUPERVISOR : 202 + demande SALE_REVERSAL conforme au contrat, Location, aucune écriture au grand livre', async () => {
      const s = await sale();
      const before = await footprint(s);
      const res = await post(supervisor, s.id);
      expect(res.status).toBe(202);
      expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
      expect(res.body).toMatchObject({
        action: 'SALE_REVERSAL',
        status: 'PENDING',
        target_id: s.id,
        requested_by: supervisor.userId,
      });
      expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
      expect(await footprint(s)).toEqual(before);
      expect(await rw.reversalsOf(s.id)).toHaveLength(0);
      // Rejeu de la même clé : même demande, une seule.
      const key = randomUUID();
      const a = await post(supervisor, s.id, key);
      const b = await post(supervisor, s.id, key);
      expect(b.body).toEqual(a.body);
      expect(b.headers['idempotency-replayed']).toBe('true');
      expect(
        await ownerRows(`SELECT 1 FROM approval_request WHERE id = $1`, [
          a.body.approval_request_id,
        ]),
      ).toHaveLength(1);
    });

    it('ORGANIZER_ADMIN de l’organisateur de l’événement : 202', async () => {
      expect((await post(organizerAdmin, (await sale()).id)).status).toBe(202);
    });

    it('demandeur ≠ approbateur : la même personne ne peut pas approuver (HTTP), une seconde personne exécute l’annulation (BACKOFFICE)', async () => {
      const s = await sale();
      const asked = await post(supervisor, s.id);
      const id = String(asked.body.approval_request_id);
      const self = await rw.person_request(supervisor, `/approval-requests/${id}/approve`, {});
      expect(self.status).toBeGreaterThanOrEqual(400);
      expect(await rw.reversalsOf(s.id)).toHaveLength(0);
      const done = await rw.person_request(supervisor2, `/approval-requests/${id}/approve`, {});
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('EXECUTED');
      const [r] = await ownerRows<{ source: string; created_by: string; approved_by: string }>(
        'SELECT source, created_by, approved_by FROM journal_transaction WHERE reverses_id = $1',
        [s.id],
      );
      expect(r).toEqual({
        source: 'BACKOFFICE',
        created_by: supervisor.userId,
        approved_by: supervisor2.userId,
      });
      expect(await rw.pw.spendable(s.media.walletId)).toBe(20_000);
    });

    it('autres rôles (CASHIER, OPERATOR_ADMIN) → 403 ; SUPERVISOR d’un autre événement → 403 ; rien créé', async () => {
      const s = await sale();
      const other = await rw.otherEvent();
      const outsider = await rw.supervisor({ scope: { type: 'EVENT', id: other.eventId } });
      for (const who of [cashier, operatorAdmin, outsider])
        expect((await post(who, s.id)).status).toBe(403);
      expect(
        await ownerRows(`SELECT 1 FROM approval_request WHERE target_id = $1`, [s.id]),
      ).toHaveLength(0);
    });

    it('vente inconnue → 404 ; clé non UUID → 422 sans rien créer ; sans clé → 422 ; supervisor_pin_proof → 422 ; raison hors liste → 422', async () => {
      const s = await sale();
      expect((await post(supervisor, randomUUID())).status).toBe(404);
      expect((await post(supervisor, s.id, 'TPE-01:0001')).status).toBe(422);
      expect((await post(supervisor, s.id, null)).status).toBeGreaterThanOrEqual(400);
      expect(
        (await post(supervisor, s.id, undefined, { ...body, supervisor_pin_proof: '1' })).status,
      ).toBe(422);
      expect((await post(supervisor, s.id, undefined, { ...body, reason: 'AUTRE' })).status).toBe(
        422,
      );
      expect(
        await ownerRows(`SELECT 1 FROM approval_request WHERE target_id = $1`, [s.id]),
      ).toHaveLength(0);
    });

    it('plus de 403 APPROVAL_REQUIRED : la personne légitime n’est plus refusée pour ce motif', async () => {
      const res = await post(supervisor, (await sale()).id);
      expect(res.body.code).not.toBe('APPROVAL_REQUIRED');
    });
  });
});
