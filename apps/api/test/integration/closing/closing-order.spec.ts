// FR-001, FR-002, FR-004 : ordre, phase et échéance des étapes ; accès (404, 403) ; conditions de passage.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

describe('ordre et conditions des étapes de clôture', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.replay(1, 24);
  });
  afterAll(async () => w.close());

  it('FR-001 : RECONCILING refusé avec une session de caisse ouverte (texte en français et en anglais)', async () => {
    const conditions = async (language: string) =>
      (await w.get('/status-conditions?to=RECONCILING').set('Accept-Language', language)).body as {
        code: string;
        met: boolean;
        detail: string;
      }[];
    // Le scénario a fermé l'événement (CLOSING) avec la session de caisse encore ouverte : condition non remplie.
    const fr = (await conditions('fr')).find((c) => c.code === 'NO_OPEN_CASH_SESSION');
    expect(fr).toMatchObject({ met: false });
    expect(fr!.detail).toMatch(/session de caisse/);
    const en = (await conditions('en')).find((c) => c.code === 'NO_OPEN_CASH_SESSION');
    expect(en!.detail).toMatch(/cash session/);
    const refused = await w.post('/status-transitions').send({ to: 'RECONCILING' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CLOSING_CONDITION_NOT_MET');
    expect(refused.body.detail).toContain('NO_OPEN_CASH_SESSION');
    // Session en cours de fermeture (CLOSING) : même refus.
    await w.tamper(
      'cash_session',
      `UPDATE cash_session SET status = 'CLOSING', counted_amount = 0, expected_amount = 0,
              closed_by = opened_by WHERE event_id = $1`,
      [w.fx.eventId],
    );
    const closing = await w.post('/status-transitions').send({ to: 'RECONCILING' });
    expect([closing.status, closing.body.code]).toEqual([409, 'CLOSING_CONDITION_NOT_MET']);
    expect(closing.body.detail).toContain('NO_OPEN_CASH_SESSION');
  });

  it('FR-004 : étapes refusées hors phase et hors ordre, rien d’écrit', async () => {
    await w.replay(25, 29);
    const before = await w.counts();
    // L'événement est encore en CLOSING ou RECONCILING : aucune étape n'est permise.
    const early = await w.post('/closing-steps/PITCH_FEES');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('CLOSING_CONDITION_NOT_MET');
    expect(await w.counts()).toEqual(before);
  });

  it('FR-004 : étape 2 avant l’étape 1, étape 4 en SETTLING : 409 ; étape inconnue : 400', async () => {
    await w.settle();
    const before = await w.counts();
    for (const step of [
      'OPERATOR_FEE',
      'PLATFORM_FEE',
      'OPERATOR_FEE_REGULARIZATION',
      'BREAKAGE',
    ]) {
      const res = await w.post(`/closing-steps/${step}`);
      expect({ step, status: res.status, code: res.body.code }).toEqual({
        step,
        status: 409,
        code: 'CLOSING_CONDITION_NOT_MET',
      });
    }
    expect((await w.post('/closing-steps/NOPE')).status).toBe(400);
    expect((await w.get('/closing-steps/NOPE/preview')).status).toBe(400);
    expect(await w.counts()).toEqual(before);
  });

  it('FR-001, FR-002 : REFUND_WINDOW refusé sans les étapes 1 à 3 ; CLOSED refusé avant l’échéance', async () => {
    const refund = await w.post('/status-transitions').send({ to: 'REFUND_WINDOW' });
    expect(refund.status).toBe(409);
    expect(refund.body.detail).toContain('CLOSING_STEPS_DONE');
    for (const step of ['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE'])
      expect((await w.post(`/closing-steps/${step}`)).status).toBe(200);
    await w.enterRefundWindow();
    // Phase de remboursement : échéance non atteinte, étape 4 refusée ; CLOSED refusé (échéance et étapes).
    await w.owner(
      `UPDATE event SET refund_deadline = clock_timestamp() + interval '30 days' WHERE id = $1`,
      [w.fx.eventId],
    );
    const early = await w.post('/closing-steps/OPERATOR_FEE_REGULARIZATION');
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/date limite/);
    const conditions = (await w.get('/status-conditions?to=CLOSED').set('Accept-Language', 'en'))
      .body as { code: string; met: boolean; detail: string }[];
    expect(conditions.filter((c) => !c.met).map((c) => c.code)).toEqual(
      expect.arrayContaining(['REFUND_DEADLINE_REACHED', 'CLOSING_STEPS_DONE']),
    );
    expect(conditions.find((c) => c.code === 'REFUND_DEADLINE_REACHED')!.detail).toMatch(
      /deadline/,
    );
    const closed = await w.post('/status-transitions').send({ to: 'CLOSED' });
    expect(closed.status).toBe(409);
  });

  it('étapes 4 à 7 : l’ordre se tient aussi en REFUND_WINDOW (échéance atteinte) ; puis CLOSED', async () => {
    await w.afterDeadline();
    const res = await w.post('/closing-steps/DEPOSIT_FORFEIT');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/OPERATOR_FEE_REGULARIZATION|BREAKAGE/);
    for (const step of [
      'OPERATOR_FEE_REGULARIZATION',
      'BREAKAGE',
      'DEPOSIT_FORFEIT',
      'PROMO_EXPIRY',
    ])
      expect((await w.post(`/closing-steps/${step}`)).status).toBe(200);
    await w.replay(46, 48);
    const closed = await w.post('/status-transitions').send({ to: 'CLOSED' });
    expect([closed.status, closed.body.detail]).toEqual([200, undefined]);
  });

  it('FR-008 : grand livre LOCKED : relevé vide, étape refusée (409 CONFLICT_STATE)', async () => {
    const [ledger] = await w.owner<{ status: string }>('SELECT status FROM ledger WHERE id = $1', [
      w.fx.ledgerId,
    ]);
    expect(ledger!.status).toBe('LOCKED');
    const res = await w.get('/remaining-balances');
    expect(res.body).toMatchObject({
      wallet_count: 0,
      paid_total: 0,
      cash_due_total: 0,
      promo_total: 0,
    });
    const csv = await w.get('/remaining-balances?format=csv').buffer(true);
    expect(csv.text.trim()).toBe('wallet_id,paid,cash_due,promo');
    const step = await w.post('/closing-steps/PITCH_FEES');
    expect([step.status, step.body.code]).toEqual([409, 'CONFLICT_STATE']);
  });

  it('accès : autre prestataire (404) ou organisateur non administré (403), aucune écriture', async () => {
    const before = await w.counts();
    const paths = ['/closing-steps', '/closing-steps/PITCH_FEES/preview', '/remaining-balances'];
    const foreign = await w.foreignOperator();
    for (const path of paths) expect((await w.get(path, foreign)).status).toBe(404);
    expect((await w.post('/closing-steps/PITCH_FEES', foreign)).status).toBe(404);
    const stranger = await w.stranger();
    for (const path of paths) expect((await w.get(path, stranger)).status).toBe(403);
    expect((await w.post('/closing-steps/PITCH_FEES', stranger)).status).toBe(403);
    expect(await w.counts()).toEqual(before);
  });
});
