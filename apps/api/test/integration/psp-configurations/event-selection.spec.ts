// Choix de configuration PSP par événement hors `LIVE` (mission 6, lot WP10, T051 ; FR-010) : écriture directe,
// contrôles de la base (organisateur, ACTIVE, moyen, titulaire des fonds), cloisonnement.
import { randomUUID } from 'node:crypto';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

describe('choix de PSP par événement (brouillon)', () => {
  let w: PspWorld;
  let org: string;
  let event: string;
  beforeAll(async () => {
    w = await createPspWorld();
    org = w.fx.parties.ORG;
    event = w.fx.eventId;
  });
  afterAll(async () => {
    await w?.close();
  });
  const put = (who: typeof w.org1, method: string, configId: string, eventId = event) =>
    w.api(who, 'put', `/events/${eventId}/psp-selections/${method}`, { psp_config_id: configId });
  const rows = (eventId = event) =>
    w.owner('SELECT method, psp_configuration_id FROM event_psp_selection WHERE event_id = $1', [
      eventId,
    ]);

  it('choix direct 200, relu par les deux rôles sans secret_ref, identique = 200', async () => {
    const cfg = await w.activeConfig();
    const res = await put(w.org1, 'WAVE', cfg);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      event_id: event,
      method: 'WAVE',
      psp_config_id: cfg,
      selected_by: w.org1.userId,
      approved_by: null,
    });
    expect((await put(w.org1, 'WAVE', cfg)).status).toBe(200);
    for (const who of [w.org1, w.op1]) {
      const list = await w.api(who, 'get', `/events/${event}/psp-selections`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.text).not.toContain('secret_ref');
      expect(list.text).not.toContain('psp/');
    }
  });

  it('refus de la base en 422, rien d’écrit : brouillon, suspendue, autre organisateur, autre moyen, autre titulaire', async () => {
    const event2 = await w.createEvent();
    const draft = await w.createConfig(w.op1);
    const suspended = await w.activeConfig();
    const s = await w.requestChange(w.op1, suspended, { status: 'SUSPENDED' });
    await w.approve(w.op2, s.approval_request_id);
    const otherOrganizer = await w.activeConfig({}, w.organizer2);
    const card = await w.activeConfig({
      method: 'CARD',
      provider: 'STRIPE',
      secret_ref: `psp/${org}/card`,
    });
    const operatorHolder = await w.activeConfig({
      holder_party_id: w.fx.parties.OPE,
      secret_ref: `psp/${w.fx.parties.OPE}/op-holder`,
    });
    for (const cfg of [draft, suspended, otherOrganizer, card, operatorHolder]) {
      const res = await put(w.org1, 'WAVE', cfg, event2);
      expect({ cfg, status: res.status }).toEqual({ cfg, status: 422 });
    }
    expect(await rows(event2)).toEqual([]);
    expect((await put(w.org1, 'WAVE', randomUUID(), event2)).status).toBe(422);
  });

  it('cloisonnement : autre organisateur et autre prestataire 404 (lecture et écriture), OPERATOR_ADMIN 403 à l’écriture', async () => {
    const cfg = await w.activeConfig();
    const before = await rows();
    for (const who of [w.org2Other, w.orgBAdmin, w.opBAdmin]) {
      expect((await put(who, 'WAVE', cfg)).status).toBe(who === w.opBAdmin ? 403 : 404);
      expect((await w.api(who, 'get', `/events/${event}/psp-selections`)).status).toBe(404);
    }
    expect((await put(w.op1, 'WAVE', cfg)).status).toBe(403);
    expect(await rows()).toEqual(before);
  });

  it('validations : moyen inconnu 400, corps inconnu 422, événement inexistant 404', async () => {
    const cfg = await w.activeConfig();
    expect((await put(w.org1, 'PAYPAL', cfg)).status).toBe(400);
    expect(
      (
        await w.api(w.org1, 'put', `/events/${event}/psp-selections/WAVE`, {
          psp_config_id: cfg,
          x: 1,
        })
      ).status,
    ).toBe(422);
    expect((await put(w.org1, 'WAVE', cfg, randomUUID())).status).toBe(404);
  });
});
