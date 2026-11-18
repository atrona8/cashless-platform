// FR-001, FR-002 : conditions de passage vraies (PSP_RECONCILED calculée, trois codes nouveaux), textes fr et en.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

type Condition = { code: string; met: boolean | null; detail: string; source: string };

describe('conditions de passage des statuts', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.replay(1, 29);
  });
  afterAll(async () => w.close());

  const conditions = async (to: string, language = 'fr') =>
    (await w.get(`/status-conditions?to=${to}`).set('Accept-Language', language))
      .body as Condition[];

  it('PSP_RECONCILED vient de la base : non remplie sans relevé, remplie avec relevé, textes fr et en', async () => {
    const before = (await conditions('SETTLING')).find((c) => c.code === 'PSP_RECONCILED')!;
    expect(before).toMatchObject({ met: false, source: 'DATABASE' });
    expect(before.detail).not.toMatch(/pas encore calculable/);
    const refused = await w.post('/status-transitions').send({ to: 'SETTLING' });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('PSP_RECONCILED');
    await w.settle();
    const [row] = await w.owner<{ status: string }>(
      'SELECT status::text FROM event WHERE id = $1',
      [w.fx.eventId],
    );
    expect(row!.status).toBe('SETTLING');
    const en = (await conditions('SETTLING', 'en')).find((c) => c.code === 'PSP_RECONCILED')!;
    expect(en.detail).toMatch(/reconciled/);
  });

  it('CLOSING_STEPS_DONE et REFUND_DEADLINE_REACHED : calculées, textes remplie/non remplie fr et en', async () => {
    const fr = await conditions('REFUND_WINDOW');
    expect(fr.find((c) => c.code === 'CLOSING_STEPS_DONE')).toMatchObject({
      met: false,
      source: 'DATABASE',
    });
    expect(fr.find((c) => c.code === 'CLOSING_STEPS_DONE')!.detail).toMatch(/étapes de clôture/i);
    for (const step of ['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE'])
      expect((await w.post(`/closing-steps/${step}`)).status).toBe(200);
    const done = await conditions('REFUND_WINDOW', 'en');
    expect(done.find((c) => c.code === 'CLOSING_STEPS_DONE')).toMatchObject({ met: true });
    expect(done.find((c) => c.code === 'CLOSING_STEPS_DONE')!.detail).toMatch(
      /done or not applicable/,
    );
    const closed = await conditions('CLOSED', 'en');
    expect(closed.find((c) => c.code === 'REFUND_DEADLINE_REACHED')!.met).toBe(false);
    expect(closed.find((c) => c.code === 'REFUND_DEADLINE_REACHED')!.detail).toMatch(
      /not been reached/,
    );
  });
});
