// Choix de PSP pendant `LIVE` : action `EVENT_PSP_SELECTION` à deux personnes (mission 6, lot WP10, T051).
import { EVENT_PSP_SELECTION_ROLES } from '../../../src/psp-configurations/event-psp-selection-action';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

describe('EVENT_PSP_SELECTION : événement en direct', () => {
  let w: PspWorld;
  beforeAll(async () => {
    w = await createPspWorld();
  });
  afterAll(async () => {
    await w?.close();
  });
  const put = (who: typeof w.org1, eventId: string, configId: string) =>
    w.api(who, 'put', `/events/${eventId}/psp-selections/WAVE`, { psp_config_id: configId });
  const selections = (eventId: string) =>
    w.owner<{ psp_configuration_id: string; approved_by: string | null; selected_by: string }>(
      'SELECT psp_configuration_id, approved_by, selected_by FROM event_psp_selection WHERE event_id = $1',
      [eventId],
    );
  const live = async () => {
    const id = await w.createEvent();
    await w.setLive(id);
    return id;
  };

  it('rôle de l’action borné à l’ORGANIZER_ADMIN', () => {
    expect([...EVENT_PSP_SELECTION_ROLES]).toEqual(['ORGANIZER_ADMIN']);
  });

  it('LIVE : 202, table inchangée avant approbation ; une autre personne approuve, la base écrit', async () => {
    const id = await live();
    const cfg = await w.activeConfig();
    const res = await put(w.org1, id, cfg);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      action: 'EVENT_PSP_SELECTION',
      status: 'PENDING',
      payload: { event_id: id, method: 'WAVE', psp_configuration_id: cfg, scope_id: id },
    });
    expect(await selections(id)).toEqual([]);
    const done = await w.approve(w.org2, res.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    expect(await selections(id)).toEqual([
      { psp_configuration_id: cfg, approved_by: w.org2.userId, selected_by: w.org1.userId },
    ]);
    const audit = await w.owner(
      `SELECT 1 FROM audit_log WHERE action = 'EVENT_PSP_SELECTION_CHANGED' AND object_id = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
  });

  it('auteur = valideur refusé ; un OPERATOR_ADMIN ni demande ni approuve', async () => {
    const id = await live();
    const cfg = await w.activeConfig();
    const res = await put(w.org1, id, cfg);
    expect((await w.approve(w.org1, res.body.approval_request_id)).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await w.approve(w.op1, res.body.approval_request_id)).status).toBe(403);
    expect(await selections(id)).toEqual([]);
    expect((await put(w.op1, id, cfg)).status).toBe(403);
  });

  it('configuration suspendue entre la demande et l’approbation : FAILED, rien d’écrit', async () => {
    const id = await live();
    const cfg = await w.activeConfig();
    const res = await put(w.org1, id, cfg);
    const s = await w.requestChange(w.op1, cfg, { status: 'SUSPENDED' });
    await w.approve(w.op2, s.approval_request_id);
    const done = await w.approve(w.org2, res.body.approval_request_id);
    expect(done.body.status).toBe('FAILED');
    expect(await selections(id)).toEqual([]);
  });

  it('autre organisateur : 404 ; configuration inconnue : 422', async () => {
    const id = await live();
    const cfg = await w.activeConfig();
    expect((await put(w.org2Other, id, cfg)).status).toBe(404);
    expect((await put(w.org1, id, '00000000-0000-4000-8000-000000000000')).status).toBe(422);
  });
});
