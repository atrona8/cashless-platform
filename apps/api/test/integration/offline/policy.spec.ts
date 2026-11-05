// Politique hors ligne par l'API (mission hors-ligne-snapshots-lots, lot WP14 ; FR-001 à FR-003,
// FR-043). Le monde de test est propre à ce fichier (prestataires aléatoires) : rien n'est affirmé
// d'une valeur globale.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseUpdate } from '../../../src/offline/policy/offline-policy.dto';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { createOperators, type Operators } from '../transverse/fixtures';

jest.setTimeout(120_000);

describe('politique hors ligne : plafond, trois portées, risque (WP14)', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const id = {
    org1: randomUUID(),
    org2: randomUUID(),
    orgB: randomUUID(),
    event1: randomUUID(),
    event2: randomUUID(),
    eventB: randomUUID(),
    dev1a: randomUUID(),
    dev1b: randomUUID(),
    dev2: randomUUID(),
    devB: randomUUID(),
  };
  let opAdmin: TestPerson;
  let org1Admin: TestPerson;
  let org2Admin: TestPerson;
  let supervisor: TestPerson;
  let platformAdmin: TestPerson;
  let opAdminB: TestPerson;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Org 1', 'SN'), ($2, 'ORGANIZER', $4, 'Org 2', 'SN'),
           ($3, 'ORGANIZER', $5, 'Org B', 'SN')`,
        [id.org1, id.org2, id.orgB, ops.a, ops.b],
      );
      const profile = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [profile],
      );
      const event = (eventId: string, op: string, org: string) =>
        db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                              funds_holder)
           VALUES ($1, $2, $3, 'Événement', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
          [eventId, op, org, profile],
        );
      await event(id.event1, ops.a, id.org1);
      await event(id.event2, ops.a, id.org2);
      await event(id.eventB, ops.b, id.orgB);
      const device = (deviceId: string, op: string, eventId: string) =>
        db.query(
          `INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ($1, $2, 'POS', $3, $4)`,
          [deviceId, op, eventId, `S-${randomUUID()}`],
        );
      await device(id.dev1a, ops.a, id.event1);
      await device(id.dev1b, ops.a, id.event1);
      await device(id.dev2, ops.a, id.event2);
      await device(id.devB, ops.b, id.eventB);
      opAdmin = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }],
      });
      org1Admin = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: id.org1 }],
      });
      org2Admin = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: id.org2 }],
      });
      supervisor = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: id.org1 }],
      });
      platformAdmin = await idp.createPerson(db, {
        operatorId: null,
        roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
      });
      opAdminB = await idp.createPerson(db, {
        operatorId: ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }],
      });
    });
    app = await createTestApp({ identity: idp });
  });
  afterAll(async () => {
    await app?.close();
  });

  const call = (
    method: 'get' | 'put',
    path: string,
    who?: TestPerson,
    body?: unknown,
    key: string = randomUUID(),
  ) => {
    let req = request(app.getHttpServer())[method](`/v1${path}`);
    if (who) req = req.set('Authorization', `Bearer ${who.token}`);
    if (method === 'put') req = req.set('Idempotency-Key', key).send(body as object);
    return req;
  };
  const P = {
    ceiling: () => `/operators/${ops.a}/offline-ceiling`,
    org: (org = id.org1) => `/organizers/${org}/offline-policy`,
    event: (event = id.event1) => `/events/${event}/offline-policy`,
    device: (device = id.dev1a) => `/devices/${device}/offline-policy`,
    risk: (event = id.event1) => `/events/${event}/offline-risk`,
  };
  const row = async (type: string, scope: string) =>
    (
      await ownerRows<Record<string, unknown>>(
        `SELECT * FROM offline_policy WHERE scope_type = $1 AND scope_id = $2`,
        [type, scope],
      )
    )[0];
  const auditRows = (action: string, objectId: string) =>
    ownerRows<{ actor_id: string; actor_role: string; before: unknown; after: unknown }>(
      `SELECT actor_id, actor_role, before, after FROM audit_log
        WHERE action = $1 AND object_id = $2 ORDER BY id`,
      [action, objectId],
    );
  const history = (scope: string) =>
    ownerRows<{ version: number; deleted: boolean }>(
      `SELECT version, deleted FROM offline_policy_history WHERE scope_id = $1 ORDER BY id`,
      [scope],
    );

  it('plafond : jamais posé = version 0 ; pose, relecture, rôles', async () => {
    const empty = await call('get', P.ceiling(), opAdmin);
    expect(empty.status).toBe(200);
    expect(contractViolations('OfflinePolicyLevelView', empty.body)).toEqual([]);
    expect(empty.body).toMatchObject({
      level: 'OPERATOR_CEILING',
      scope_id: ops.a,
      version: 0,
      updated_by: null,
      policy: { offline_enabled: null, max_per_sale: null, cash_topup_offline: false },
    });
    const set = await call('put', P.ceiling(), opAdmin, {
      offline_enabled: true,
      max_per_sale: 5_000,
      max_per_media_per_device: 20_000,
      max_total_per_device: 100_000,
      max_snapshot_age_seconds: 600,
    });
    expect(set.status).toBe(200);
    expect(contractViolations('OfflinePolicyLevelView', set.body)).toEqual([]);
    expect(set.body).toMatchObject({ version: 1, updated_by: opAdmin.userId });
    expect(set.body.policy.max_total_per_device).toBe(100_000);
    // Lecture par un ORGANIZER_ADMIN du prestataire ; écriture refusée (403) ; autres rôles 403 ;
    // sans jeton 401.
    expect((await call('get', P.ceiling(), org1Admin)).status).toBe(200);
    expect((await call('put', P.ceiling(), org1Admin, { version: 1 })).status).toBe(403);
    expect((await call('put', P.ceiling(), platformAdmin, { version: 1 })).status).toBe(403);
    expect((await call('get', P.ceiling(), supervisor)).status).toBe(403);
    expect((await call('get', P.ceiling())).status).toBe(401);
    expect((await row('OPERATOR_CEILING', ops.a))?.version).toBe(1);
  });

  it('organisation, événement, terminal : remplacement complet, héritage, plafond qui borne', async () => {
    const org = await call('put', P.org(), org1Admin, {
      offline_enabled: true,
      max_per_sale: 8_000,
      max_per_media_per_device: 15_000,
      max_total_per_device: 150_000,
    });
    expect(org.status).toBe(200);
    expect(org.body.version).toBe(1);
    // Événement : seulement le total ; le reste hérite.
    const ev = await call('put', P.event(), org1Admin, { max_total_per_device: 60_000 });
    expect(ev.status).toBe(200);
    expect(ev.body.policy).toMatchObject({ offline_enabled: null, max_total_per_device: 60_000 });
    expect(contractViolations('OfflinePolicyLevelView', ev.body)).toEqual([]);
    expect(ev.body.risk).toMatchObject({ event_id: id.event1, currency: 'XOF' });
    // Terminal : effective = terminal > événement > organisateur, borné par le plafond (5 000 par
    // vente).
    const dev = await call('put', P.device(), org1Admin, { max_per_media_per_device: 12_000 });
    expect(dev.status).toBe(200);
    expect(contractViolations('OfflinePolicyLevelView', dev.body)).toEqual([]);
    expect(dev.body.effective).toEqual({
      offline_enabled: true,
      max_per_sale: 5_000,
      max_per_media_per_device: 12_000,
      max_total_per_device: 60_000,
      max_snapshot_age_seconds: 600,
      cash_topup_offline: false,
      capped: true,
    });
    // Remplacement complet : un second PUT sans le champ le remet à « hérite ».
    const again = await call('put', P.device(), org1Admin, { version: 1, max_per_sale: 3_000 });
    expect(again.status).toBe(200);
    expect(again.body.policy.max_per_media_per_device).toBeNull();
    expect(again.body).toMatchObject({ version: 2, updated_by: org1Admin.userId });
    expect(again.body.effective.max_per_sale).toBe(3_000);
    expect(again.body.effective.capped).toBe(false);
    const read = await call('get', P.device(), opAdmin);
    expect(read.status).toBe(200);
    expect(read.body.policy).toEqual(again.body.policy);
    // Historique : une ligne par modification, écrite par le déclencheur de la base (pas par
    // l'API).
    expect((await history(id.dev1a)).map((h) => h.version)).toEqual([1, 2]);
  });

  it('risque : somme calculée à la main, capped rendu tel quel, événement sans terminal', async () => {
    // dev1a : 60 000 (événement) ; dev1b : 60 000, borné ? plafond 100 000 > 60 000 -> non
    // plafonné.
    await call('put', P.device(id.dev1b), org1Admin, { max_total_per_device: 400_000 });
    const risk = await call('get', P.risk(), org1Admin);
    expect(risk.status).toBe(200);
    expect(contractViolations('OfflineRisk', risk.body)).toEqual([]);
    const byId = Object.fromEntries(
      risk.body.devices.map((d: { device_id: string }) => [d.device_id, d]),
    );
    expect(byId[id.dev1a]).toMatchObject({ max_total_per_device: 60_000, capped: false });
    expect(byId[id.dev1b]).toMatchObject({ max_total_per_device: 100_000, capped: true });
    expect(risk.body).toMatchObject({
      max_total_risk: 160_000,
      offline_devices: 2,
      currency: 'XOF',
    });
    const dbNow = (await ownerRows<{ n: Date }>('SELECT clock_timestamp() AS n'))[0]!.n.getTime();
    expect(Math.abs(dbNow - Date.parse(risk.body.computed_at))).toBeLessThan(60_000);
    // Événement 2 : aucune politique propre ; l'organisateur 2 n'a rien -> hors ligne interdit ->
    // aucun terminal.
    const none = await call('get', P.risk(id.event2), org2Admin);
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ max_total_risk: 0, offline_devices: 0, devices: [] });
    // La réponse d'un PUT sur l'événement porte le même risque.
    const put = await call('put', P.event(), org1Admin, {
      version: 1,
      max_total_per_device: 60_000,
    });
    expect(put.body.risk.max_total_risk).toBe(160_000);
  });

  it('valeur énorme en base : refus net (500), jamais un nombre arrondi ; somme exacte sinon', async () => {
    const setCeiling = (value: string) =>
      withOwner((db) =>
        db.query(
          `UPDATE offline_policy SET max_total_per_device = $1::bigint
            WHERE scope_type = 'OPERATOR_CEILING' AND scope_id = $2`,
          [value, ops.a],
        ),
      );
    const setDevice = (value: string) =>
      withOwner((db) =>
        db.query(
          `UPDATE offline_policy SET max_total_per_device = $1::bigint
            WHERE scope_type = 'DEVICE' AND scope_id = $2`,
          [value, id.dev1b],
        ),
      );
    try {
      // Le plafond du prestataire borne la valeur effective : il faut le lever pour exposer la
      // valeur énorme.
      await setCeiling((2n ** 60n).toString());
      await setDevice((2n ** 60n).toString());
      const res = await call('get', P.risk(), org1Admin);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('1152921504606846976');
      // Deux valeurs sûres dont la somme sort de la plage sûre : refus net aussi (jamais arrondie).
      await setDevice(String(Number.MAX_SAFE_INTEGER));
      await withOwner((db) =>
        db.query(
          `UPDATE offline_policy SET max_total_per_device = $1::bigint
            WHERE scope_type = 'EVENT' AND scope_id = $2`,
          [String(Number.MAX_SAFE_INTEGER), id.event1],
        ),
      );
      const sum = await call('get', P.risk(), org1Admin);
      expect(sum.status).toBe(500);
      // Somme sûre : exacte (un terminal à 2^53-1, l'autre ramené à 0).
      await withOwner((db) =>
        db.query(
          `UPDATE offline_policy SET max_total_per_device = 0 WHERE scope_type = 'EVENT' AND scope_id = $1`,
          [id.event1],
        ),
      );
      const ok = await call('get', P.risk(), org1Admin);
      expect(ok.status).toBe(200);
      expect(ok.body.max_total_risk).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      await setCeiling('100000');
      await setDevice('400000');
      await withOwner((db) =>
        db.query(
          `UPDATE offline_policy SET max_total_per_device = 60000 WHERE scope_type = 'EVENT' AND scope_id = $1`,
          [id.event1],
        ),
      );
    }
    expect((await call('get', P.risk(), org1Admin)).body.max_total_risk).toBe(160_000);
  });

  it('cash_topup_offline vrai (ou nul) : 422 à chaque portée, ligne inchangée ; la base refuse aussi', async () => {
    const targets: [string, string, string, TestPerson][] = [
      ['OPERATOR_CEILING', P.ceiling(), ops.a, opAdmin],
      ['ORGANIZER', P.org(), id.org1, org1Admin],
      ['EVENT', P.event(), id.event1, org1Admin],
      ['DEVICE', P.device(), id.dev1a, org1Admin],
    ];
    for (const [type, path, scope, who] of targets) {
      const before = await row(type, scope);
      for (const value of [true, null, 'true', 1]) {
        const res = await call('put', path, who, {
          version: before?.version,
          cash_topup_offline: value,
        });
        expect({ type, value, status: res.status }).toEqual({ type, value, status: 422 });
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      expect(await row(type, scope)).toEqual(before);
      expect((await call('get', path, who)).body.policy.cash_topup_offline).toBe(false);
    }
    await expect(
      withOwner((db) =>
        db.query(`UPDATE offline_policy SET cash_topup_offline = true WHERE scope_id = $1`, [
          id.org1,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('validation avant la base : décimal, négatif, chaîne, âge, champ inconnu, version', async () => {
    const before = await row('ORGANIZER', id.org1);
    const bad: object[] = [
      { max_per_sale: 5.5 },
      { max_per_sale: -1 },
      { max_per_sale: '100' },
      { max_per_sale: 2 ** 53 },
      { max_snapshot_age_seconds: 86_401 },
      { offline_enabled: 'oui' },
      { scope_id: randomUUID() },
      { operator_id: ops.b },
      { version: 1.5 },
      { version: -1 },
    ];
    for (const body of bad) {
      const res = await call('put', P.org(), org1Admin, body);
      expect({ body, status: res.status }).toEqual({ body, status: 422 });
    }
    expect((await call('put', P.org(), org1Admin, [1] as unknown as object)).status).toBe(422);
    expect(await row('ORGANIZER', id.org1)).toEqual(before);
    // 5.0 est l'entier 5 en JSON : accepté, sans 22P02.
    expect(parseUpdate(JSON.parse('{"max_per_sale": 5.0}')).values.max_per_sale).toBe(5);
    // Clé d'idempotence absente ou non UUID : refus, rien d'écrit.
    const noKey = await request(app.getHttpServer())
      .put(`/v1${P.org()}`)
      .set('Authorization', `Bearer ${org1Admin.token}`)
      .send({ max_per_sale: 1 });
    expect([400, 422]).toContain(noKey.status);
    expect(
      (await call('put', P.org(), org1Admin, {}, 'pas-un-uuid')).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await row('ORGANIZER', id.org1)).toEqual(before);
  });

  it('version attendue fausse : 409 sans audit ; deux PUT concurrents : un seul gagne', async () => {
    const current = (await row('ORGANIZER', id.org1))!.version as number;
    const audits = (await auditRows('OFFLINE_POLICY_SET', id.org1)).length;
    const stale = await call('put', P.org(), org1Admin, {
      version: current + 5,
      max_per_sale: 1_000,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT_STATE');
    // Création alors qu'un niveau existe (version absente) : 409.
    expect((await call('put', P.org(), org1Admin, { max_per_sale: 1_000 })).status).toBe(409);
    expect((await auditRows('OFFLINE_POLICY_SET', id.org1)).length).toBe(audits);
    const results = await Promise.all(
      [1_111, 2_222].map((n) =>
        call('put', P.org(), org1Admin, { version: current, max_per_sale: n }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await row('ORGANIZER', id.org1))!.version).toBe(current + 1);
    // Création concurrente d'un niveau absent : un seul gagne.
    const created = await Promise.all(
      [10, 20].map((n) => call('put', P.event(id.event2), org2Admin, { max_per_sale: n })),
    );
    expect(created.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('même clé : rejeu sans second appel ; autre corps : refus, aucune écriture', async () => {
    const key = randomUUID();
    const v = (await row('ORGANIZER', id.org1))!.version as number;
    const first = await call('put', P.org(), org1Admin, { version: v, max_per_sale: 700 }, key);
    const replay = await call('put', P.org(), org1Admin, { version: v, max_per_sale: 700 }, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((await row('ORGANIZER', id.org1))!.version).toBe(v + 1);
    const other = await call('put', P.org(), org1Admin, { version: v + 1, max_per_sale: 701 }, key);
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(Number((await row('ORGANIZER', id.org1))!.max_per_sale)).toBe(700);
  });

  it('OPERATOR_ADMIN : coupe un terminal sans toucher ses montants ; rien d’autre', async () => {
    const before = await call('get', P.device(id.dev1b), opAdmin);
    const cut = await call('put', P.device(id.dev1b), opAdmin, {
      version: before.body.version,
      offline_enabled: false,
    });
    expect(cut.status).toBe(200);
    expect(cut.body.policy).toEqual({ ...before.body.policy, offline_enabled: false });
    expect(cut.body.effective.offline_enabled).toBe(false);
    const audit = await auditRows('OFFLINE_POLICY_SET', id.dev1b);
    expect(audit.at(-1)).toMatchObject({ actor_id: opAdmin.userId, actor_role: 'OPERATOR_ADMIN' });
    const snapshot = await row('DEVICE', id.dev1b);
    const v = cut.body.version;
    const forbidden: object[] = [
      { version: v, offline_enabled: true },
      { version: v, offline_enabled: false, max_total_per_device: 9_999_999 },
      { version: v, max_total_per_device: 9_999_999 },
      { version: v },
      { version: v, offline_enabled: null },
    ];
    for (const body of forbidden) {
      const res = await call('put', P.device(id.dev1b), opAdmin, body);
      expect({ body, status: res.status }).toEqual({ body, status: 403 });
    }
    for (const path of [P.org(), P.event()]) {
      const res = await call('put', path, opAdmin, { offline_enabled: false });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(await row('DEVICE', id.dev1b)).toEqual(snapshot);
    // Version fausse sur la coupure : 409.
    expect(
      (await call('put', P.device(id.dev1b), opAdmin, { version: 99, offline_enabled: false }))
        .status,
    ).toBe(409);
  });

  it('effacement : corps sans valeur ; audit CLEARED au nom de l’acteur réel ; version fausse 409', async () => {
    const created = await call('put', P.device(id.dev2), org2Admin, { max_per_sale: 100 });
    expect(created.status).toBe(200);
    const wrong = await call('put', P.device(id.dev2), org2Admin, { version: 7 });
    expect(wrong.status).toBe(409);
    expect(await row('DEVICE', id.dev2)).toBeDefined();
    const cleared = await call('put', P.device(id.dev2), org2Admin, { version: 1 });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ version: 0, updated_by: null });
    expect(cleared.body.policy.max_per_sale).toBeNull();
    expect(await row('DEVICE', id.dev2)).toBeUndefined();
    const audit = await auditRows('OFFLINE_POLICY_CLEARED', id.dev2);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: org2Admin.userId, actor_role: 'ORGANIZER_ADMIN' });
    expect(JSON.stringify(audit[0]!.before)).toContain('"version":1');
    // Effacer un niveau absent : 200, rien à auditer.
    expect((await call('put', P.device(id.dev2), org2Admin, {})).status).toBe(200);
    expect(await auditRows('OFFLINE_POLICY_CLEARED', id.dev2)).toHaveLength(1);
    // L'historique garde la ligne de suppression.
    expect(await history(id.dev2)).toEqual([
      { version: 1, deleted: false },
      { version: 2, deleted: true },
    ]);
  });

  it('audit : présent pour chaque succès (avant/après, sans secret), absent pour chaque refus', async () => {
    const count = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE action IN ('OFFLINE_POLICY_SET','OFFLINE_POLICY_CLEARED') AND operator_id = $1`,
        [ops.a],
      ).then((r) => r[0]!.n);
    const v = (await row('EVENT', id.event1))!.version as number;
    const n0 = await count();
    const ok = await call('put', P.event(), org1Admin, {
      version: v,
      max_total_per_device: 61_000,
    });
    expect(ok.status).toBe(200);
    expect(await count()).toBe(n0 + 1);
    const [entry] = (await auditRows('OFFLINE_POLICY_SET', id.event1)).slice(-1);
    expect(entry).toMatchObject({ actor_id: org1Admin.userId, actor_role: 'ORGANIZER_ADMIN' });
    expect(entry!.before).toMatchObject({ version: v, policy: { max_total_per_device: 60_000 } });
    expect(entry!.after).toMatchObject({
      version: v + 1,
      policy: { max_total_per_device: 61_000 },
    });
    const refusals = [
      call('put', P.event(), org1Admin, { version: 99 }), // 409
      call('put', P.event(), org1Admin, { cash_topup_offline: true }), // 422
      call('put', P.event(), org2Admin, { max_per_sale: 1 }), // 404
      call('put', P.event(), supervisor, { max_per_sale: 1 }), // 403
      call('put', P.event(), opAdmin, { max_per_sale: 1 }), // 403
      call('put', P.event(), opAdminB, { max_per_sale: 1 }), // 404
    ];
    expect((await Promise.all(refusals)).map((r) => r.status)).toEqual([
      409, 422, 404, 403, 403, 404,
    ]);
    expect(await count()).toBe(n0 + 1);
  });

  it('périmètre : 404 neutre hors organisateur ou hors prestataire, 403 sans rôle, 401 sans jeton', async () => {
    const paths = [P.org(), P.event(), P.device(), P.risk()];
    for (const path of paths) {
      // autre organisateur, même prestataire
      expect((await call('get', path, org2Admin)).status).toBe(404);
      expect((await call('get', path, opAdminB)).status).toBe(404); // autre prestataire
      expect((await call('get', path, supervisor)).status).toBe(403);
      expect((await call('get', path)).status).toBe(401);
      expect((await call('get', path, opAdmin)).status).toBe(200);
    }
    // Objet inconnu : même réponse que l'objet d'un autre prestataire (pas d'oracle).
    const unknown = await call('get', P.device(randomUUID()), org1Admin);
    const foreign = await call('get', P.device(id.devB), org1Admin);
    expect([unknown.status, foreign.status]).toEqual([404, 404]);
    expect(foreign.body.code).toBe(unknown.body.code);
    expect(JSON.stringify(foreign.body)).not.toContain(id.devB);
    // Terminal / événement / organisateur d'un autre prestataire : en lecture comme en écriture.
    for (const path of [P.device(id.devB), P.event(id.eventB), P.org(id.orgB), P.risk(id.eventB)]) {
      expect((await call('get', path, opAdmin)).status).toBe(404);
      expect((await call('get', path, org1Admin)).status).toBe(404);
    }
    for (const path of [P.device(id.devB), P.event(id.eventB), P.org(id.orgB)]) {
      expect((await call('put', path, opAdmin, { offline_enabled: false })).status).toBe(404);
      expect((await call('put', path, org1Admin, { max_per_sale: 1 })).status).toBe(404);
    }
    expect(await row('DEVICE', id.devB)).toBeUndefined();
    // Plafond d'un autre prestataire.
    const other = `/operators/${ops.b}/offline-ceiling`;
    expect((await call('get', other, opAdmin)).status).toBe(404);
    expect((await call('put', other, opAdmin, { max_per_sale: 1 })).status).toBe(404);
    expect((await call('get', '/operators/pas-un-uuid/offline-ceiling', opAdmin)).status).toBe(404);
  });

  it('historique : un UPDATE direct du propriétaire écrit aussi une ligne (déclencheur de la base)', async () => {
    const before = (await history(id.org1)).length;
    await withOwner((db) =>
      db.query(
        `UPDATE offline_policy SET max_per_sale = 4242 WHERE scope_type = 'ORGANIZER' AND scope_id = $1`,
        [id.org1],
      ),
    );
    expect((await history(id.org1)).length).toBe(before + 1);
  });

  it('aucune écriture SQL directe sur offline_policy ni son historique dans src/offline/policy', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../../src/offline/policy');
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect({
        file,
        direct: /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+offline_policy/i.test(text),
      }).toEqual({
        file,
        direct: false,
      });
    }
  });
});
