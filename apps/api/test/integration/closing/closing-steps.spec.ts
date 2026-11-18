// FR-003, FR-005 à FR-007, FR-024 : le festival de référence, les sept étapes par les routes, montants du scénario.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

interface Result {
  status: string;
  transaction_ids: string[];
  summary: { total: number; lines: { party_id: string; amount: number }[] };
}

describe('étapes de clôture : montants du scénario de référence', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.toSettling();
  });
  afterAll(async () => w.close());

  const unbalanced = () =>
    w.owner(
      `SELECT transaction_id FROM posting WHERE ledger_id = $1 GROUP BY transaction_id HAVING sum(amount) <> 0`,
      [w.fx.ledgerId],
    );

  it('FR-003 : sept étapes à faire ; aperçu des trois étapes de SETTLING sans aucune écriture', async () => {
    const list = await w.get('/closing-steps');
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { step: string; status: string }) => s.status)).toEqual(
      Array(7).fill('TODO'),
    );
    const before = await w.counts();
    const totals: number[] = [];
    for (const step of ['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE']) {
      const res = await w.get(`/closing-steps/${step}/preview`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ step, currency: 'XOF', applicable: true });
      totals.push(res.body.total);
    }
    expect(totals).toEqual([25_000, 6000, 1017]);
    expect(await w.counts()).toEqual(before);
  });

  it('FR-003, FR-005 : l’exécution écrit ce que l’aperçu annonçait (25 000, 6 000, 1 017), grand livre équilibré', async () => {
    for (const [step, total] of [
      ['PITCH_FEES', 25_000],
      ['OPERATOR_FEE', 6000],
      ['PLATFORM_FEE', 1017],
    ] as const) {
      const preview = await w.get(`/closing-steps/${step}/preview`);
      const res = await w.post(`/closing-steps/${step}`);
      expect(res.status).toBe(200);
      const body = res.body as Result;
      expect(body).toMatchObject({ status: 'DONE', step });
      expect(body.transaction_ids).toHaveLength(1);
      expect(body.summary.total).toBe(total);
      expect(body.summary.lines).toEqual(
        preview.body.lines.map((l: { party_id: string; amount: number }) => ({
          party_id: l.party_id,
          label: expect.any(String),
          amount: l.amount,
        })),
      );
    }
    expect(await unbalanced()).toEqual([]);
    const [fees] = await w.owner<{ fees: string }>(
      `SELECT sum(-p.amount)::text AS fees FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.ledger_id = $1 AND a.purpose IN ('OPE_FRAIS', 'OPE_TAX')`,
      [w.fx.ledgerId],
    );
    expect(fees!.fees).toBe('6000');
  });

  it('FR-024 : une ligne d’audit par exécution, auteur correct, sans donnée personnelle', async () => {
    const rows = await w.owner<{ actor_id: string; object_id: string; after: { step: string } }>(
      `SELECT actor_id, object_id, after FROM audit_log WHERE action = 'CLOSING_STEP_EXECUTED' AND object_id = $1
        ORDER BY id`,
      [w.fx.eventId],
    );
    expect(rows.map((r) => r.after.step)).toEqual(['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE']);
    expect(new Set(rows.map((r) => r.actor_id))).toEqual(
      new Set([w.fx.people.operatorAdmin.userId]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/@|display_name/);
  });

  it('FR-005 à FR-007 : phase de remboursement, régularisation sans objet (GROSS), casse, caution, crédits offerts', async () => {
    await w.toRefundWindow();
    const expected = [
      ['OPERATOR_FEE_REGULARIZATION', 'NOT_APPLICABLE', 0],
      ['BREAKAGE', 'DONE', 20_000],
      ['DEPOSIT_FORFEIT', 'DONE', 2000],
      ['PROMO_EXPIRY', 'DONE', 1000],
    ] as const;
    for (const [step, status, total] of expected) {
      const preview = await w.get(`/closing-steps/${step}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.total).toBe(total);
      const res = await w.post(`/closing-steps/${step}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expect(res.body.summary.total ?? 0).toBe(total);
    }
    const parts = await w.owner<{ purpose: string; v: string }>(
      `SELECT a.purpose, sum(-p.amount)::text AS v FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.ledger_id = $1 AND a.purpose IN ('ORG_CASSE', 'OPE_CASSE') GROUP BY a.purpose ORDER BY a.purpose`,
      [w.fx.ledgerId],
    );
    expect(parts).toEqual([
      { purpose: 'OPE_CASSE', v: '4000' },
      { purpose: 'ORG_CASSE', v: '16000' },
    ]);
    expect(await unbalanced()).toEqual([]);
    const list = await w.get('/closing-steps');
    expect(list.body.data.map((s: { status: string }) => s.status)).toEqual([
      'DONE',
      'DONE',
      'DONE',
      'NOT_APPLICABLE',
      'DONE',
      'DONE',
      'DONE',
    ]);
  });
});
