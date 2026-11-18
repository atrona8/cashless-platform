// Intégration : résultat d'un versement (route 9) (mission 9b, lot WP08, T038 ; FR-012).
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { PayoutWorld } from './payout-fixtures';

jest.setTimeout(120_000);

describe('résultat des versements', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 240_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(async () => {
    expect(await p.unbalanced()).toBe(0);
  });

  const confirm = (id: string, body: unknown, who = p.w.organizerAdminA, key = randomUUID()) =>
    p.bo('POST', `/payouts/${id}/confirm`, who, body, key);
  const one = async (claim = 10_000, amount = 4_000) => {
    const m = await p.merchant(claim);
    const { id } = await p.batch([p.line(m, amount)]);
    return { m, id, payout: (await p.payoutsOf(id))[0]!.id };
  };

  it('FR-012 : CONFIRMED avec référence écrit PAYOUT_CONFIRMED une fois ; réponse Payout', async () => {
    const { payout, id } = await one();
    const before = await p.txCount('PAYOUT_CONFIRMED');
    const res = await confirm(payout, { outcome: 'CONFIRMED', external_reference: 'WAVE-123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      payout_id: payout,
      approval_request_id: id,
      status: 'CONFIRMED',
      external_reference: 'WAVE-123',
      confirmed_by: p.w.organizerAdminA.userId,
    });
    expect(res.body.settled_transaction_id).toEqual(expect.any(String));
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(before + 1);
    expect(res.text).not.toContain('770000001');
    const audit = await ownerRows<{ after: unknown }>(
      `SELECT after FROM audit_log WHERE action = 'PAYOUT_CONFIRMED' AND object_id = $1`,
      [payout],
    );
    expect(audit).toHaveLength(1);
  });

  it('FR-012 : FAILED recrédite le droit net ; un nouveau lot est possible', async () => {
    const { m, payout } = await one(10_000, 10_000);
    expect(await p.net(m.partyId)).toBe(0);
    expect((await p.request([p.line(m, 1)])).status).toBe(409);
    const before = await p.txCount('PAYOUT_FAILED');
    const res = await confirm(
      payout,
      { outcome: 'FAILED', failure_reason: 'Compte Wave fermé' },
      p.organizerAdmin3,
    );
    expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'Compte Wave fermé' });
    expect(await p.txCount('PAYOUT_FAILED')).toBe(before + 1);
    expect(await p.net(m.partyId)).toBe(10_000);
    expect((await p.request([p.line(m, 10_000)])).status).toBe(202);
  });

  it('décision 18 : FAILED refusé 403 au préparateur et au valideur du lot, rien d’écrit ; une troisième personne passe et devient le valideur de la transaction', async () => {
    const { m, id, payout } = await one(10_000, 10_000);
    const body = { outcome: 'FAILED', failure_reason: 'Compte Wave fermé' };
    const before = await p.txCount('PAYOUT_FAILED');
    for (const who of [p.w.organizerAdminA, p.organizerAdmin2]) {
      const res = await confirm(payout, body, who);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.detail).toContain('préparé ou validé');
    }
    expect(await p.txCount('PAYOUT_FAILED')).toBe(before);
    expect((await p.payoutsOf(id))[0]!.status).toBe('INITIATED');
    expect(await p.net(m.partyId)).toBe(0);
    const third = await confirm(payout, body, p.organizerAdmin3);
    expect(third.status).toBe(200);
    expect(third.body).toMatchObject({ status: 'FAILED', confirmed_by: p.organizerAdmin3.userId });
    const tx = await ownerRows<{ created_by: string; approved_by: string }>(
      `SELECT t.created_by, t.approved_by FROM payout po JOIN journal_transaction t ON t.id = po.settled_tx_id
        WHERE po.id = $1`,
      [payout],
    );
    expect(tx[0]).toEqual({
      created_by: p.w.organizerAdminA.userId,
      approved_by: p.organizerAdmin3.userId,
    });
    expect(await p.net(m.partyId)).toBe(10_000);
  });

  it('décision 18 : la base refuse elle-même un FAILED du préparateur ou du valideur (CL041) ; CONFIRMED à une personne passe', async () => {
    const { payout } = await one(10_000, 4_000);
    const call = (actor: string, outcome: string) =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [p.w.ops.a]);
        return db.query('SELECT settle_payout($1, $2, $3, $4, $5)', [
          payout,
          outcome,
          outcome === 'CONFIRMED' ? 'REF-D18' : null,
          outcome === 'FAILED' ? 'motif' : null,
          actor,
        ]);
      });
    for (const actor of [p.w.organizerAdminA.userId, p.organizerAdmin2.userId])
      await expect(call(actor, 'FAILED')).rejects.toMatchObject({ code: 'CL041' });
    const status = await ownerRows<{ s: string }>('SELECT status AS s FROM payout WHERE id = $1', [
      payout,
    ]);
    expect(status[0]!.s).toBe('INITIATED');
    await expect(call(p.w.organizerAdminA.userId, 'CONFIRMED')).resolves.toBeDefined();
  });

  it('FR-012 : corps invalides refusés ; ligne inconnue ou d’un autre prestataire 404 ; mauvais rôle 403', async () => {
    const { payout } = await one();
    for (const body of [
      { outcome: 'CONFIRMED' },
      { outcome: 'CONFIRMED', external_reference: '   ' },
      { outcome: 'FAILED' },
      { outcome: 'FAILED', failure_reason: 'ok' },
      { outcome: 'CONFIRMED', external_reference: 'x', failure_reason: 'abc' },
      { outcome: 'PAID', external_reference: 'x' },
      { outcome: 'FAILED', failure_reason: 'motif', extra: 1 },
    ]) {
      const res = await confirm(payout, body);
      expect([400, 422]).toContain(res.status);
    }
    expect(
      (await confirm(randomUUID(), { outcome: 'CONFIRMED', external_reference: 'x' })).status,
    ).toBe(404);
    expect(
      (await confirm(payout, { outcome: 'CONFIRMED', external_reference: 'x' }, p.operatorAdminB))
        .status,
    ).toBe(404);
    expect(
      (await confirm(payout, { outcome: 'CONFIRMED', external_reference: 'x' }, p.operatorAdmin2))
        .status,
    ).toBe(403);
    expect(
      (await confirm(payout, { outcome: 'CONFIRMED', external_reference: 'x' }, p.w.cashierA))
        .status,
    ).toBe(403);
    expect(
      (
        await p.payoutsOf(
          (
            await ownerRows<{ a: string }>(
              'SELECT approval_request_id AS a FROM payout WHERE id = $1',
              [payout],
            )
          )[0]!.a,
        )
      )[0]!.status,
    ).toBe('INITIATED');
  });

  it('FR-012 : deuxième résultat différent sur la même ligne : 409, jamais un second PAYOUT_CONFIRMED ni un double recrédit', async () => {
    const { m, payout } = await one(10_000, 4_000);
    expect((await confirm(payout, { outcome: 'CONFIRMED', external_reference: 'R1' })).status).toBe(
      200,
    );
    const confirmed = await p.txCount('PAYOUT_CONFIRMED');
    const failed = await p.txCount('PAYOUT_FAILED');
    for (const body of [
      { outcome: 'FAILED', failure_reason: 'trop tard' },
      { outcome: 'CONFIRMED', external_reference: 'R2' },
    ]) {
      const res = await confirm(payout, body, p.organizerAdmin3, randomUUID());
      expect(res.status).toBe(409);
    }
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(confirmed);
    expect(await p.txCount('PAYOUT_FAILED')).toBe(failed);
    expect(await p.net(m.partyId)).toBe(6_000);
    // Même résultat rejoué avec la même clé : même réponse, aucune écriture.
    const key = randomUUID();
    const a = await confirm(
      payout,
      { outcome: 'CONFIRMED', external_reference: 'R1' },
      p.w.organizerAdminA,
      key,
    );
    const b = await confirm(
      payout,
      { outcome: 'CONFIRMED', external_reference: 'R1' },
      p.w.organizerAdminA,
      key,
    );
    expect(a.status).toBe(b.status);
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(confirmed);
  });

  it('FR-012 : la clôture est refusée tant qu’une ligne est INITIATED (PAYOUT_PENDING_ZERO)', async () => {
    await one();
    const condition = () =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [p.w.ops.a]);
        const { rows } = await db.query<{ met: boolean }>(
          `SELECT met FROM event_transition_conditions($1, 'REFUND_WINDOW') WHERE code = 'PAYOUT_PENDING_ZERO'`,
          [p.w.ids.eventA],
        );
        return rows[0]!.met;
      });
    expect(await condition()).toBe(false);
    const open = await ownerRows<{ id: string }>(
      `SELECT id FROM payout WHERE ledger_id = $1 AND status = 'INITIATED'`,
      [p.ledger],
    );
    // Aucune route ne règle plusieurs lignes à la fois : une par une, par la route de résultat.
    for (const row of open) {
      const res = await confirm(row.id, {
        outcome: 'CONFIRMED',
        external_reference: `R-${row.id}`,
      });
      expect(res.status).toBe(200);
    }
    expect(await condition()).toBe(true);
  });
});
