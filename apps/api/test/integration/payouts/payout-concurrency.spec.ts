// Intégration : concurrence et refus de la base (mission 9b, lot WP08, T039 ; NFR-001, FR-010).
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { PayoutWorld } from './payout-fixtures';

jest.setTimeout(180_000);

describe('versements et concurrence', () => {
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

  it('NFR-001 : 50 approbations concurrentes du même lot : une transaction PAYOUT_INITIATED, un jeu de lignes', async () => {
    const m1 = await p.merchant(20_000);
    const m2 = await p.merchant(20_000);
    const asked = await p.request([p.line(m1, 5_000), p.line(m2, 7_000)]);
    const id = String(asked.body.approval_request_id);
    const before = await p.txCount('PAYOUT_INITIATED');
    const all = await Promise.all(Array.from({ length: 50 }, () => p.approve(id)));
    expect(all.filter((r) => r.status === 200 && r.body.status === 'EXECUTED')).toHaveLength(1);
    expect(all.every((r) => r.status >= 200 && r.status < 500)).toBe(true);
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before + 1);
    expect(await p.payoutsOf(id)).toHaveLength(2);
    expect(await p.net(m1.partyId)).toBe(15_000);
    expect(await p.net(m2.partyId)).toBe(13_000);
  });

  it('NFR-001 : 50 résultats concurrents d’une ligne (clés distinctes) : un seul PAYOUT_CONFIRMED', async () => {
    const m = await p.merchant(10_000);
    const { id } = await p.batch([p.line(m, 4_000)]);
    const payout = (await p.payoutsOf(id))[0]!.id;
    const before = await p.txCount('PAYOUT_CONFIRMED');
    const all = await Promise.all(
      Array.from({ length: 50 }, () =>
        p.bo('POST', `/payouts/${payout}/confirm`, p.w.organizerAdminA, {
          outcome: 'CONFIRMED',
          external_reference: 'REF-1',
        }),
      ),
    );
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(before + 1);
    const audits = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'PAYOUT_CONFIRMED' AND object_id = $1`,
      [payout],
    );
    expect(audits[0]!.n).toBe(1);
  });

  it('résultats contradictoires en parallèle : un seul passe, l’autre 409, un seul recrédit au plus', async () => {
    const m = await p.merchant(10_000);
    const { id } = await p.batch([p.line(m, 10_000)]);
    const payout = (await p.payoutsOf(id))[0]!.id;
    const [a, b] = await Promise.all([
      p.bo('POST', `/payouts/${payout}/confirm`, p.organizerAdmin3, {
        outcome: 'FAILED',
        failure_reason: 'échec réseau',
      }),
      p.bo('POST', `/payouts/${payout}/confirm`, p.organizerAdmin2, {
        outcome: 'CONFIRMED',
        external_reference: 'R',
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [row] = await p.payoutsOf(id);
    expect(['CONFIRMED', 'FAILED']).toContain(row!.status);
    expect(await p.net(m.partyId)).toBe(row!.status === 'FAILED' ? 10_000 : 0);
  });

  it('FR-010 : la base refuse auteur = valideur et une charge modifiée ; aucune écriture', async () => {
    const m = await p.merchant(10_000);
    const before = await p.txCount('PAYOUT_INITIATED');
    const req = randomUUID();
    const line = JSON.stringify([
      {
        beneficiary: { participation_id: m.participationId },
        beneficiary_id: m.partyId,
        amount: 100,
        method: 'WAVE',
        msisdn: '+221770000001',
      },
    ]);
    const call = (author: string, approver: string, lines = line) =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [p.w.ops.a]);
        return db.query('SELECT create_payout_batch($1, $2, $3::jsonb, $4, $5)', [
          p.ledger,
          req,
          lines,
          author,
          approver,
        ]);
      });
    const same = p.w.organizerAdminA.userId;
    await expect(call(same, same)).rejects.toMatchObject({ code: 'CL001' });
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);

    // Charge modifiée en base (propriétaire) après la demande : l'exécution la refuse ou la base la
    // refuse.
    const asked = await p.request([p.line(m, 1_000)]);
    const id = String(asked.body.approval_request_id);
    const tamper = await ownerRows(
      `UPDATE approval_request SET payload = jsonb_set(payload, '{lines,0,amount}', '99999999') WHERE id = $1`,
      [id],
    ).then(
      () => 'MODIFIED',
      (error: Error) => error.message,
    );
    const res = await p.approve(id);
    if (tamper === 'MODIFIED') {
      // La charge a changé : l'exécution la refuse (droit net dépassé), rien n'est écrit.
      expect(res.body.status).toBe('FAILED');
      expect(await p.txCount('PAYOUT_INITIATED')).toBe(before);
      expect(await p.payoutsOf(id)).toHaveLength(0);
    } else {
      // La base refuse de modifier la charge d'une demande : la demande exécute la charge
      // d'origine, une fois.
      expect(tamper).toMatch(/approval_request|immuable|modif|interdit|payload/i);
      expect(res.body.status).toBe('EXECUTED');
      expect(await p.txCount('PAYOUT_INITIATED')).toBe(before + 1);
      expect((await p.payoutsOf(id))[0]!.amount).toBe('1000');
    }
  });
});
