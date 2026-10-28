// Dépôt en banque `CASH_DEPOSIT` (mission 6, lot WP08, T041 ; FR-029, FR-031 ; contracts/cash.md règle 10, IC-10).
// Demande par `requestCashDeposit` (HTTP), décision par `approveApprovalRequest`, exécution par `CashDepositActions`
// sous la transaction de l'approbation. Le transit est alimenté par de vraies fermetures de caisse.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CASH_DEPOSIT_ROLES } from '../../../src/cash-sessions/cash-deposit-action';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { CashWorld } from './cash-session-fixtures';

jest.setTimeout(240_000);

describe('dépôt en banque CASH_DEPOSIT (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });

  const author = () => cw.w.operatorAdminA;
  const validator = () => cw.w.organizerAdminA;
  const transit = () => cw.balance(cw.a.ledgerId, 'A-TRANSIT');
  const bank = () => cw.balance(cw.a.ledgerId, 'A-BANQUE');
  const depositsOf = (key?: string) =>
    ownerRows<{
      id: string;
      source: string;
      created_by: string;
      approved_by: string;
      idempotency_key: string;
    }>(
      `SELECT id, source, created_by, approved_by, idempotency_key FROM journal_transaction
        WHERE ledger_id = $1 AND type = 'CASH_DEPOSIT' AND ($2::text IS NULL OR idempotency_key = $2)`,
      [cw.a.ledgerId, key ?? null],
    );
  const request = (
    who = author(),
    body: unknown = { amount: 1_000, bank_reference: 'BORD-1' },
    key = randomUUID(),
  ) => cw.bo('POST', `/ledgers/${cw.a.ledgerId}/cash-deposits/approval-requests`, who, body, key);
  const approve = (id: unknown, who = validator()) =>
    cw.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  const statusOf = (id: unknown) =>
    ownerRows<{ status: string; failure_code: string | null }>(
      'SELECT status, failure_code FROM approval_request WHERE id = $1',
      [id],
    ).then((r) => r[0]!);
  /** Alimente le transit de l'événement A d'au moins `amount` par une vraie fermeture de caisse. */
  async function fundTransit(amount: number): Promise<void> {
    const { id } = await cw.ready({ expected: amount, counted: amount });
    expect((await cw.closeBo(id, cw.supervisor)).status).toBe(200);
  }

  it('le contrat nomme ORGANIZER_ADMIN et OPERATOR_ADMIN, aucun autre rôle (constante bornée)', () => {
    expect([...CASH_DEPOSIT_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('demande : 202, ApprovalRequest PENDING, portée lue en base, rien d’écrit au grand livre ; rejeu de clé', async () => {
    await fundTransit(3_000);
    const before = {
      tx: (await depositsOf()).length,
      transit: await transit(),
      bank: await bank(),
    };
    const res = await request(author(), { amount: 2_000, bank_reference: 'BORD-2026-0001' });
    expect(res.status).toBe(202);
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      action: 'CASH_DEPOSIT',
      status: 'PENDING',
      target_id: cw.a.ledgerId,
      requested_by: author().userId,
    });
    expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
    const [row] = await ownerRows<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM approval_request WHERE id = $1',
      [res.body.approval_request_id],
    );
    expect(row!.payload).toMatchObject({
      ledger_id: cw.a.ledgerId,
      scope_type: 'EVENT',
      scope_id: cw.a.eventId,
      amount: 2_000,
    });
    expect({
      tx: (await depositsOf()).length,
      transit: await transit(),
      bank: await bank(),
    }).toEqual(before);
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'CASH_DEPOSIT_REQUESTED' AND object_id = $1`,
        [res.body.approval_request_id],
      ),
    ).toHaveLength(1);
    const key = randomUUID();
    const a = await request(author(), { amount: 10, bank_reference: 'R' }, key);
    const b = await request(author(), { amount: 10, bank_reference: 'R' }, key);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(
      await ownerRows(`SELECT 1 FROM approval_request WHERE id = $1`, [a.body.approval_request_id]),
    ).toHaveLength(1);
    // ORGANIZER_ADMIN demande aussi.
    expect((await request(validator())).status).toBe(202);
  });

  it('autres rôles 403 ; autre prestataire 404 ; sans jeton 401 ; rien n’est créé', async () => {
    const count = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM approval_request WHERE action = 'CASH_DEPOSIT'`,
      ).then((r) => r[0]!.n);
    const before = await count();
    for (const who of [cw.w.cashierA, cw.supervisor, cw.w.supervisorA, cw.w.platformAdmin])
      expect([who.userId === who.userId, (await request(who)).status]).toEqual([true, 403]);
    expect((await request(cw.operatorAdminOp2)).status).toBe(404);
    expect((await request(cw.organizerAdminOp2)).status).toBe(404);
    const anonymous = await cw.bo(
      'POST',
      `/ledgers/${cw.a.ledgerId}/cash-deposits/approval-requests`,
      cw.w.cashierA,
      {
        amount: 1,
        bank_reference: 'x',
      },
      randomUUID(),
      { authorization: '' },
    );
    expect(anonymous.status).toBe(401);
    expect((await request(author(), {})).status).toBe(422);
    expect(await count()).toBe(before);
  });

  it('corps invalide (montant, référence, champ de portée ajouté, grand livre inconnu) : refusé, rien créé', async () => {
    const bad: unknown[] = [
      { amount: 0, bank_reference: 'R' },
      { amount: -5, bank_reference: 'R' },
      { amount: 1.5, bank_reference: 'R' },
      { amount: '100', bank_reference: 'R' },
      { amount: 100, bank_reference: '' },
      { amount: 100, bank_reference: 'a\nb' },
      { amount: 100, bank_reference: 'x'.repeat(201) },
      { amount: 100 },
      { amount: 100, bank_reference: 'R', scope_id: randomUUID() },
      { amount: 100, bank_reference: 'R', ledger_id: randomUUID() },
      [],
      'texte',
    ];
    for (const body of bad) {
      const res = await request(author(), body);
      // Un corps qui n'est pas un objet est refusé dès l'analyse JSON (400) ; les autres par la validation (422).
      const expected = typeof body === 'object' && !Array.isArray(body) ? [422] : [400, 422];
      expect([JSON.stringify(body), expected.includes(res.status)]).toEqual([
        JSON.stringify(body),
        true,
      ]);
    }
    const unknown = await cw.bo(
      'POST',
      `/ledgers/${randomUUID()}/cash-deposits/approval-requests`,
      author(),
      { amount: 100, bank_reference: 'R' },
      randomUUID(),
    );
    expect(unknown.status).toBe(404);
    expect(
      (
        await cw.bo('POST', '/ledgers/pas-un-uuid/cash-deposits/approval-requests', author(), {
          amount: 100,
          bank_reference: 'R',
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('approbation par une AUTRE personne : CASH_DEPOSIT BACKOFFICE, banque +montant, transit −montant, auteur et valideur tracés', async () => {
    await fundTransit(6_000);
    const t0 = await transit();
    const b0 = await bank();
    const asked = await request(author(), { amount: 2_500, bank_reference: 'BORD-77' });
    const id = String(asked.body.approval_request_id);
    // L'auteur ne s'approuve pas lui-même ; un SUPERVISOR n'est pas du rôle ; rien d'écrit.
    expect((await approve(id, author())).status).toBeGreaterThanOrEqual(400);
    expect((await approve(id, cw.supervisor)).status).toBe(403);
    expect((await approve(id, cw.operatorAdminOp2)).status).toBeGreaterThanOrEqual(400);
    expect(await depositsOf(`cash-deposit:${id}`)).toHaveLength(0);
    expect((await statusOf(id)).status).toBe('PENDING');
    // Une seconde personne du rôle (OPERATOR_ADMIN du même prestataire) l'approuve.
    const done = await approve(id, cw.operatorAdmin2);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    expect(contractViolations('ApprovalRequest', done.body)).toEqual([]);
    const [tx] = await depositsOf(`cash-deposit:${id}`);
    expect(tx).toEqual({
      id: expect.any(String),
      source: 'BACKOFFICE',
      created_by: author().userId,
      approved_by: cw.operatorAdmin2.userId,
      idempotency_key: `cash-deposit:${id}`,
    });
    expect(await bank()).toBe(b0 + 2_500);
    expect(await transit()).toBe(t0 - 2_500);
    const [meta] = await ownerRows<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM journal_transaction WHERE id = $1',
      [tx!.id],
    );
    expect(meta!.metadata).toMatchObject({ approval_request_id: id, bank_reference: 'BORD-77' });
    // Décision déjà prise : une seconde approbation n'écrit rien de plus.
    expect((await approve(id, validator())).status).toBeGreaterThanOrEqual(400);
    expect(await depositsOf(`cash-deposit:${id}`)).toHaveLength(1);
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'APPROVAL_EXECUTED' AND object_id = $1`,
        [id],
      ),
    ).toHaveLength(1);
  });

  it('au-delà du transit : demande FAILED, aucune transaction, soldes inchangés', async () => {
    const t0 = await transit();
    const b0 = await bank();
    const asked = await request(author(), { amount: t0 + 1, bank_reference: 'TROP' });
    const id = String(asked.body.approval_request_id);
    const res = await approve(id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(await statusOf(id)).toMatchObject({ status: 'FAILED' });
    expect(await depositsOf(`cash-deposit:${id}`)).toHaveLength(0);
    expect(await transit()).toBe(t0);
    expect(await bank()).toBe(b0);
    // Le motif est lisible et ne contient aucun texte SQL.
    expect(JSON.stringify(res.body)).not.toMatch(/CL00|violates|ERROR/);
  });

  it('deux dépôts approuvés en même temps dont la somme dépasse le transit : un seul passe, l’autre FAILED', async () => {
    await fundTransit(5_000);
    const t0 = await transit();
    const amount = Math.floor(t0 * 0.6);
    const ids = [
      String((await request(author(), { amount, bank_reference: 'A' })).body.approval_request_id),
      String((await request(author(), { amount, bank_reference: 'B' })).body.approval_request_id),
    ];
    const results = await Promise.all(ids.map((id) => approve(id)));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.status).sort()).toEqual(['EXECUTED', 'FAILED']);
    expect(await transit()).toBe(t0 - amount);
    const executed = results.filter((r) => r.body.status === 'EXECUTED');
    expect(await depositsOf(`cash-deposit:${executed[0]!.body.approval_request_id}`)).toHaveLength(
      1,
    );
  });

  it('demande expirée : refusée, rien d’écrit ; grand livre verrouillé : FAILED', async () => {
    await fundTransit(1_000);
    const expired = String(
      (await request(author(), { amount: 100, bank_reference: 'EXP' })).body.approval_request_id,
    );
    await withOwner(async (db) => {
      await db.query('ALTER TABLE approval_request DISABLE TRIGGER approval_request_guard');
      try {
        await db.query(
          `UPDATE approval_request SET requested_at = now() - interval '3 days',
                  expires_at = now() - interval '1 day' WHERE id = $1`,
          [expired],
        );
      } finally {
        await db.query('ALTER TABLE approval_request ENABLE TRIGGER approval_request_guard');
      }
    });
    expect((await approve(expired)).status).toBeGreaterThanOrEqual(400);
    expect(await depositsOf(`cash-deposit:${expired}`)).toHaveLength(0);

    // Grand livre d'un autre événement (créé pour l'occasion), verrouillé après l'alimentation du transit.
    const ev = await withOwner((db) => cw.newEvent(db));
    const t = await cw.terminal(ev);
    const sid = await cw.open(t, cw.w.supervisorA);
    await cw.seedCash(t, 900, ev);
    expect((await cw.count(t, sid, cw.w.supervisorA, 900)).status).toBe(200);
    expect((await cw.closeBo(sid, cw.supervisor2)).status).toBeGreaterThanOrEqual(400);
    const closer = await withOwner((db) =>
      cw.w.idp.createPerson(db, {
        operatorId: cw.w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: ev.eventId }],
      }),
    );
    expect((await cw.closeBo(sid, closer)).status).toBe(200);
    const asked = await cw.bo(
      'POST',
      `/ledgers/${ev.ledgerId}/cash-deposits/approval-requests`,
      author(),
      {
        amount: 100,
        bank_reference: 'LOCK',
      },
    );
    expect(asked.status).toBe(202);
    await withOwner((db) =>
      db.query(`UPDATE ledger SET status = 'LOCKED' WHERE id = $1`, [ev.ledgerId]),
    );
    const res = await approve(asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(
      await ownerRows(
        `SELECT 1 FROM journal_transaction WHERE ledger_id = $1 AND type = 'CASH_DEPOSIT'`,
        [ev.ledgerId],
      ),
    ).toHaveLength(0);
  });
});
