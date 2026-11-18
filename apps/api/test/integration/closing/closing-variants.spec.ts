// FR-005, FR-006 : régularisation NET_OF_REFUNDS (règle à minimum, une seule transaction, puis CLOSED) et casse
// selon la destination du profil de législation, toutes passées par le moteur réel.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

const steps123 = async (w: ClosingWorld) => {
  for (const step of ['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE'])
    expect((await w.post(`/closing-steps/${step}`)).status).toBe(200);
};

describe('FR-005 : régularisation NET_OF_REFUNDS avec règle à minimum', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.tamper(
      'contract',
      `UPDATE contract SET operator_fee_basis = 'NET_OF_REFUNDS' WHERE id = $1`,
      [w.fx.contractId],
    );
    // 3 % des recharges, au moins 2 800 : brut 3 000 ; net des remboursements (85 500) 2 565 relevé à 2 800.
    await w.tamper(
      'fee_rule',
      `UPDATE fee_rule SET min_amount = 2800 WHERE scope_id = $1 AND basis = 'TOPUP_AMOUNT'`,
      [w.fx.contractId],
    );
    await w.toSettling();
    await steps123(w);
    await w.toRefundWindow();
  });
  afterAll(async () => w.close());

  it('l’aperçu égale l’exécution : écart de 200 (et non 435, le taux sur les remboursements), une transaction', async () => {
    const preview = await w.get('/closing-steps/OPERATOR_FEE_REGULARIZATION/preview');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ applicable: true, total: 200 });
    const before = await w.counts();
    const res = await w.post('/closing-steps/OPERATOR_FEE_REGULARIZATION');
    expect([res.status, res.body.detail]).toEqual([200, undefined]);
    expect(res.body.status).toBe('DONE');
    expect(res.body.transaction_ids).toHaveLength(1);
    expect(res.body.summary.total).toBe(200);
    expect(res.body.summary.lines.map((l: { amount: number }) => l.amount)).toEqual(
      preview.body.lines.map((l: { amount: number }) => l.amount),
    );
    expect((await w.counts()).closing).toBe(before.closing + 1);
    // Deux exécutions : une seule écriture.
    expect((await w.post('/closing-steps/OPERATOR_FEE_REGULARIZATION')).body).toEqual(res.body);
    expect((await w.counts()).closing).toBe(before.closing + 1);
    expect(
      await w.owner(
        `SELECT transaction_id FROM posting WHERE ledger_id = $1 GROUP BY transaction_id HAVING sum(amount) <> 0`,
        [w.fx.ledgerId],
      ),
    ).toEqual([]);
  });

  it('puis les étapes 5 à 7, les versements et CLOSED', async () => {
    for (const step of ['BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY'])
      expect((await w.post(`/closing-steps/${step}`)).status).toBe(200);
    await w.payOutRemaining();
    const closed = await w.post('/status-transitions').send({ to: 'CLOSED' });
    expect(closed.status).toBe(200);
  });
});

describe('FR-006 : casse selon la destination du profil de législation', () => {
  const cases = [
    ['OPERATOR', { OPE_CASSE: '20000' }],
    ['LEGAL_ACCOUNT', { LEGAL_BREAKAGE: '20000' }],
    ['NONE', {}],
  ] as const;
  it.each(cases)('%s', async (destination, expected) => {
    const w = await createClosingWorld();
    try {
      await w.tamper(
        'jurisdiction_profile',
        `UPDATE jurisdiction_profile SET breakage_destination = $2 WHERE id = $1`,
        [w.fx.jurisdictionId, destination],
      );
      if (destination === 'LEGAL_ACCOUNT')
        // Le compte légal est créé à l'ouverture du grand livre selon le profil ; ici il est posé après coup.
        await w.owner(
          `INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side, allow_negative)
           VALUES ($1, $2, 'L-LEGAL-CASSE', 'CLAIM', 'LEGAL_BREAKAGE', 'C', false)`,
          [w.fx.parties.OPE, w.fx.ledgerId],
        );
      await w.toSettling();
      await steps123(w);
      await w.toRefundWindow();
      expect((await w.post('/closing-steps/OPERATOR_FEE_REGULARIZATION')).status).toBe(200);
      const res = await w.post('/closing-steps/BREAKAGE');
      expect([res.status, res.body.detail]).toEqual([200, undefined]);
      expect(res.body.status).toBe(destination === 'NONE' ? 'NOT_APPLICABLE' : 'DONE');
      const rows = await w.owner<{ purpose: string; v: string }>(
        `SELECT a.purpose, sum(-p.amount)::text AS v FROM posting p JOIN account a ON a.id = p.account_id
          WHERE p.ledger_id = $1 AND a.purpose IN ('ORG_CASSE', 'OPE_CASSE', 'LEGAL_BREAKAGE')
          GROUP BY a.purpose`,
        [w.fx.ledgerId],
      );
      expect(Object.fromEntries(rows.map((r) => [r.purpose, r.v]))).toEqual(expected);
    } finally {
      // Le profil de législation du pays de fixture est partagé par tous les mondes : le remettre.
      await w.tamper(
        'jurisdiction_profile',
        `UPDATE jurisdiction_profile SET breakage_destination = 'ORGANIZER' WHERE id = $1`,
        [w.fx.jurisdictionId],
      );
      await w.close();
    }
  });
});
