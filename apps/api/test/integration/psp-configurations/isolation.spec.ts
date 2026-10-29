// Isolation (mission 6, lot WP10, T053 ; NFR) : chaque route du lot, appelée par le personnel d'un autre
// prestataire et par un ORGANIZER_ADMIN d'un autre organisateur, sur les objets du prestataire A (jamais un
// identifiant inexistant) : jamais de succès, `404` sans fuite, rien ne change (avant / après).
import { randomUUID } from 'node:crypto';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

describe('isolation des routes de configuration PSP', () => {
  let w: PspWorld;
  let cfg: string;
  beforeAll(async () => {
    w = await createPspWorld();
    cfg = await w.activeConfig();
  });
  afterAll(async () => {
    await w?.close();
  });
  const snapshot = async () =>
    (
      await w.owner(
        `SELECT (SELECT count(*)::int FROM psp_configuration WHERE operator_id = $1) AS configs,
                (SELECT string_agg(status || version, ',' ORDER BY psp_configuration_id) FROM psp_configuration WHERE operator_id = $1) AS statuses,
                (SELECT count(*)::int FROM event_psp_selection WHERE operator_id = $1) AS selections,
                (SELECT count(*)::int FROM approval_request WHERE operator_id = $1) AS requests,
                (SELECT count(*)::int FROM audit_log WHERE operator_id = $1) AS audits`,
        [w.fx.parties.OPE],
      )
    )[0];

  it.each([
    ['OPERATOR_ADMIN de B', () => w.opBAdmin],
    ['ORGANIZER_ADMIN de B', () => w.orgBAdmin],
    ['ORGANIZER_ADMIN d’un autre organisateur de A', () => w.org2Other],
  ])('%s : 404 sur les objets de A, rien ne change', async (_name, who) => {
    const org = w.fx.parties.ORG;
    const before = await snapshot();
    const calls = [
      w.api(who(), 'get', `/organizers/${org}/psp-configurations`),
      w.api(who(), 'get', `/psp-configurations/${cfg}`),
      w.api(who(), 'get', `/events/${w.fx.eventId}/psp-selections`),
      w.api(who(), 'put', `/events/${w.fx.eventId}/psp-selections/WAVE`, { psp_config_id: cfg }),
      w.api(who(), 'post', `/psp-configurations/${cfg}/approval-requests`, {
        status: 'SUSPENDED',
      }),
      w.api(who(), 'post', `/organizers/${org}/psp-configurations`, {
        method: 'WAVE',
        provider: 'WAVE',
        holder_party_id: org,
        secret_ref: `psp/${org}/intruder`,
      }),
    ];
    const results = await Promise.all(calls);
    // Lectures : 404. Écritures : 403 quand le rôle ne convient pas à la route (choix : ORGANIZER_ADMIN ;
    // demande et création : OPERATOR_ADMIN), 404 sinon.
    const operatorB = who() === w.opBAdmin;
    const expectedStatuses = operatorB
      ? [404, 404, 404, 403, 404, 404]
      : [404, 404, 404, 404, 403, 403];
    expect(results.map((res) => res.status)).toEqual(expectedStatuses);
    for (const res of results) {
      expect(res.text).not.toContain('secret_ref');
      expect(res.text).not.toContain(`psp/${org}`);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('sans jeton : 401 ; identifiants inexistants : 404', async () => {
    const { default: request } = await import('supertest');
    const res = await request(w.app.getHttpServer()).get(`/v1/psp-configurations/${cfg}`);
    expect(res.status).toBe(401);
    expect((await w.api(w.op1, 'get', `/psp-configurations/${randomUUID()}`)).status).toBe(404);
  });
});
