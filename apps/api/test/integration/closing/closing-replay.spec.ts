// FR-004, FR-005 : une étape ne s'écrit qu'une fois ; rejeu avec une AUTRE clé d'en-tête : même réponse, zéro écriture
// (le moteur répondrait CL002 si l'état n'était pas lu avant le calcul).
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

describe('rejeu des étapes de clôture', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.toSettling();
  });
  afterAll(async () => w.close());

  it('FR-004 : même étape, deux clés d’en-tête différentes : même réponse, aucune écriture, pas de CL002', async () => {
    const first = await w.post('/closing-steps/PITCH_FEES');
    expect(first.status).toBe(200);
    const after = await w.counts();
    const again = await w.post('/closing-steps/PITCH_FEES');
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await w.counts()).toEqual(after);
    // Plusieurs rejeux de suite : toujours la même réponse.
    for (let i = 0; i < 3; i += 1)
      expect((await w.post('/closing-steps/PITCH_FEES')).body).toEqual(first.body);
    expect(await w.counts()).toEqual(after);
  });

  it('même clé d’en-tête rejouée : réponse enregistrée, en-tête Idempotency-Replayed', async () => {
    const key = '5f6c1f5b-2a4e-4a6e-9a7b-111111111111';
    const first = await w.post('/closing-steps/OPERATOR_FEE', undefined, key);
    expect(first.status).toBe(200);
    const after = await w.counts();
    const replay = await w.post('/closing-steps/OPERATOR_FEE', undefined, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await w.counts()).toEqual(after);
  });

  it('une étape faite le reste après l’étape suivante : l’état vient de closing_step, pas du calcul', async () => {
    const before = await w.get('/closing-steps');
    await w.post('/closing-steps/PLATFORM_FEE');
    const redo = await w.post('/closing-steps/OPERATOR_FEE');
    expect(redo.status).toBe(200);
    const after = await w.get('/closing-steps');
    expect(after.body.data[1]).toEqual(before.body.data[1]);
    expect(after.body.data[2].status).toBe('DONE');
    const [row] = await w.owner<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key LIKE 'closing:%'`,
      [w.fx.ledgerId],
    );
    expect(row!.n).toBe(3);
  });
});
