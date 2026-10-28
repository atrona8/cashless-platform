// Configurations PSP, création, liste, lecture (mission 6, lot WP10, T049 ; FR-009, FR-010, FR-023). Le secret
// n'est jamais rendu à un autre rôle que l'OPERATOR_ADMIN ni recopié dans une erreur ou un audit.
import { randomUUID } from 'node:crypto';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

const CANARY = 'sk_live_CANARY0123456789abcdefghijkl';

describe('configurations PSP : routes', () => {
  let w: PspWorld;
  let org: string;
  beforeAll(async () => {
    w = await createPspWorld();
    org = w.fx.parties.ORG;
  });
  afterAll(async () => {
    await w?.close();
  });

  it('création : 201 DRAFT, secret_ref rendu à l’OPERATOR_ADMIN, audit sans secret_ref', async () => {
    const ref = `psp/${org}/wave-prod`;
    const res = await w.api(w.op1, 'post', `/organizers/${org}/psp-configurations`, {
      method: 'WAVE',
      provider: 'WAVE',
      holder_party_id: org,
      secret_ref: ref,
      is_default: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      version: 1,
      method: 'WAVE',
      secret_ref: ref,
      organizer_id: org,
      is_default: true,
      compliance_ref: null,
      created_by: w.op1.userId,
    });
    const audit = await w.owner<{ after: string }>(
      `SELECT after::text AS after FROM audit_log WHERE action = 'PSP_CONFIGURATION_CREATED' AND object_id = $1`,
      [res.body.psp_config_id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).not.toContain('secret_ref');
    expect(audit[0]!.after).not.toContain('psp/');
  });

  it('un ORGANIZER_ADMIN ne reçoit jamais secret_ref (liste et lecture, clé absente), l’OPERATOR_ADMIN si ACTIVE', async () => {
    const draft = await w.createConfig(w.op1, { secret_ref: `psp/${org}/draft-ref` });
    const active = await w.activeConfig({ secret_ref: `psp/${org}/active-ref` });
    const list = await w.api(w.org1, 'get', `/organizers/${org}/psp-configurations?limit=200`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    for (const item of list.body.data) expect(Object.keys(item)).not.toContain('secret_ref');
    for (const id of [draft, active]) {
      const one = await w.api(w.org1, 'get', `/psp-configurations/${id}`);
      expect(one.status).toBe(200);
      expect(Object.keys(one.body)).not.toContain('secret_ref');
      expect(one.text).not.toContain('psp/');
    }
    expect(list.text).not.toContain('active-ref');
    const op = await w.api(w.op1, 'get', `/psp-configurations/${active}`);
    expect(op.body.secret_ref).toBe(`psp/${org}/active-ref`);
    const opList = await w.api(w.op1, 'get', `/organizers/${org}/psp-configurations?status=ACTIVE`);
    expect(
      opList.body.data.find((c: { psp_config_id: string }) => c.psp_config_id === active),
    ).toMatchObject({ secret_ref: `psp/${org}/active-ref` });
    // Brouillon : la porte du coffre ne sert que ACTIVE et SUSPENDED, pas de référence pour l'instant.
    expect((await w.api(w.op1, 'get', `/psp-configurations/${draft}`)).body.secret_ref).toBeNull();
  });

  it('un ORGANIZER_ADMIN ne crée pas (403) ; un autre organisateur est 404', async () => {
    const body = {
      method: 'WAVE',
      provider: 'WAVE',
      holder_party_id: org,
      secret_ref: `psp/${org}/x`,
    };
    expect(
      (await w.api(w.org1, 'post', `/organizers/${org}/psp-configurations`, body)).status,
    ).toBe(403);
    expect((await w.api(w.org2Other, 'get', `/organizers/${org}/psp-configurations`)).status).toBe(
      404,
    );
  });

  it('refus de forme : secret collé, titulaire différent, point initial, champ inconnu, jamais recopiés', async () => {
    const before = (
      await w.owner<{ n: number }>('SELECT count(*)::int n FROM psp_configuration')
    )[0]!.n;
    const bad: Array<Record<string, unknown>> = [
      { secret_ref: CANARY },
      { secret_ref: `psp/${org}/${CANARY}` },
      { secret_ref: `Bearer ${CANARY}` },
      { secret_ref: `psp/${randomUUID()}/other-holder` },
      { secret_ref: `psp/${org}/.hidden` },
      { secret_ref: `psp/${org}/with space` },
      { secret_ref: `psp/${org.toUpperCase()}/upper` },
      { secret_ref: 42 },
      { status: 'ACTIVE' },
      { provider: 'STRIPE' },
      { valid_from: '2026-02-01T00:00:00Z', valid_until: '2026-01-01T00:00:00Z' },
    ];
    for (const over of bad) {
      const res = await w.api(w.op1, 'post', `/organizers/${org}/psp-configurations`, {
        method: 'WAVE',
        provider: 'WAVE',
        holder_party_id: org,
        secret_ref: `psp/${org}/ok`,
        ...over,
      });
      expect({ over, status: res.status }).toEqual({ over, status: 422 });
      expect(res.text).not.toContain('CANARY');
    }
    const after = (
      await w.owner<{ n: number }>('SELECT count(*)::int n FROM psp_configuration')
    )[0]!.n;
    expect(after).toBe(before);
    const leaked = await w.owner(
      `SELECT 1 FROM audit_log WHERE after::text LIKE '%CANARY%' OR before::text LIKE '%CANARY%'`,
    );
    expect(leaked).toEqual([]);
  });

  it('rejeu de la même clé : réponse rejouée, une seule ligne', async () => {
    const key = randomUUID();
    const body = {
      method: 'ORANGE_MONEY',
      provider: 'ORANGE_MONEY',
      holder_party_id: org,
      secret_ref: `psp/${org}/replay-ref`,
    };
    const a = await w.api(w.op1, 'post', `/organizers/${org}/psp-configurations`, body, key);
    const b = await w.api(w.op1, 'post', `/organizers/${org}/psp-configurations`, body, key);
    expect(a.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(
      await w.owner(`SELECT 1 FROM psp_configuration WHERE psp_configuration_id = $1`, [
        a.body.psp_config_id,
      ]),
    ).toHaveLength(1);
  });

  it('titulaire qui n’est pas une partie du prestataire : 404, rien d’écrit', async () => {
    const res = await w.api(w.op1, 'post', `/organizers/${org}/psp-configurations`, {
      method: 'WAVE',
      provider: 'WAVE',
      holder_party_id: w.organizerB,
      secret_ref: `psp/${w.organizerB}/foreign`,
    });
    expect(res.status).toBe(404);
  });

  it('pagination et filtre de statut ; liste vide pour un organisateur sans configuration', async () => {
    const page = await w.api(w.op1, 'get', `/organizers/${org}/psp-configurations?limit=1`);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.has_more).toBe(true);
    const empty = await w.api(w.op1, 'get', `/organizers/${w.organizer2}/psp-configurations`);
    expect(empty.body).toEqual({ data: [], next_cursor: null, has_more: false });
    expect(
      (await w.api(w.op1, 'get', `/organizers/${org}/psp-configurations?status=X`)).status,
    ).toBe(400);
  });
});
