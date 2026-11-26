// Modèle de téléphone déclaré par le terminal et niveau NFC des terminaux (mission routes-
// backoffice 11b, WP09 ; FR-016, FR-017, C-003, D2). Le modèle est facultatif, informatif et non
// vérifié : il n'empêche JAMAIS l'enrôlement ni le signal de vie d'un terminal. Enrôlement par la
// route avec le vérificateur d'attestation réel de test.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ATTESTATION_VERIFIER } from '../../../src/security/port-tokens';
import { Logger } from '@nestjs/common';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import {
  asPerson,
  issueCode,
  realAttestation,
  type RealAttestation,
} from '../../support/device-e2e';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal, type RouteServer } from '../../support/test-terminal';

const BRAND = `wp09-${randomUUID().slice(0, 8)}`;
const huge = 'x'.repeat(5000);

describe('modèle déclaré par le terminal et niveau NFC (WP09, T035, T036, T037)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let attestation: RealAttestation;
  let operatorAdminB: TestPerson;

  const staff = (who: TestPerson) => asPerson(server, who.token);
  const newCode = async () =>
    (await issueCode(server, w.operatorAdminA.token, { event_id: w.ids.eventA })).code;

  /** Enrôle un terminal par la route ; `extra` s'ajoute au corps (device_model, etc.). */
  const enroll = async (
    extra: Record<string, unknown> = {},
    terminal = new TestTerminal('ANDROID'),
  ) => {
    const res = await terminal.enrollByRoute(server, await newCode(), {
      androidPki: attestation.androidPki,
      iosPki: attestation.iosPki,
      body: extra,
    });
    return { terminal, res };
  };
  const row = async (deviceId: string) =>
    (
      await ownerRows<{
        manufacturer: string | null;
        model: string | null;
        last_seen_at: Date | null;
      }>('SELECT manufacturer, model, last_seen_at FROM device WHERE id = $1', [deviceId])
    )[0]!;
  const beat = (t: TestTerminal, extra: Record<string, unknown> = {}) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/device/heartbeat',
      body: {
        device_time: new Date().toISOString(),
        snapshot_version: null,
        last_local_seq: 0,
        pending_operations: 0,
        ...extra,
      },
    });
  const setLevel = (model: string, level: 'RECOMMENDED' | 'TOLERATED') =>
    withOwner((db) =>
      db.query('SELECT upsert_phone_model($1, $2, $3, now()::date, $4)', [
        BRAND,
        model,
        level,
        w.platformAdmin.userId,
      ]),
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    attestation = await realAttestation();
    api = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: ATTESTATION_VERIFIER, useValue: attestation.verifier }],
      trustProxyHops: 1,
    });
    server = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
    await withOwner(async (db) => {
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
  }, 90_000);
  afterAll(async () => {
    await withOwner((db) => db.query('DELETE FROM phone_model WHERE manufacturer = $1', [BRAND]));
    await api?.close();
    attestation?.dispose();
  });

  it('enrôlement avec device_model : enrôlé, modèle normalisé, réponse de même forme', async () => {
    const without = await enroll();
    const withModel = await enroll({ device_model: { manufacturer: BRAND, model: 'Galaxy  A15' } });
    expect([without.res.status, withModel.res.status]).toEqual([201, 201]);
    expect(Object.keys(withModel.res.body).sort()).toEqual(Object.keys(without.res.body).sort());
    expect(await row(withModel.terminal.deviceId)).toMatchObject({
      manufacturer: BRAND,
      model: 'galaxy a15',
    });
    expect(await row(without.terminal.deviceId)).toMatchObject({ manufacturer: null, model: null });
  });

  it('C-003 : valeur inconnue, mal formée ou énorme : toujours enrôlé, jamais 4xx', async () => {
    const bad: unknown[] = [
      null,
      'Samsung',
      [],
      {},
      { manufacturer: BRAND },
      { model: 'x' },
      { manufacturer: 12, model: 'x' },
      { manufacturer: '', model: 'x' },
      { manufacturer: '   ', model: 'x' },
      { manufacturer: BRAND, model: huge },
      { manufacturer: huge, model: huge },
      { manufacturer: BRAND, model: 'inconnu-de-la-table' },
    ];
    for (const value of bad) {
      const { terminal, res } = await enroll({ device_model: value });
      expect([res.status, JSON.stringify(value).slice(0, 40)]).toEqual([
        201,
        JSON.stringify(value).slice(0, 40),
      ]);
      const stored = await row(terminal.deviceId);
      if (JSON.stringify(value)?.includes('inconnu-de-la-table'))
        expect(stored).toMatchObject({ manufacturer: BRAND, model: 'inconnu-de-la-table' });
      else expect(stored).toMatchObject({ manufacturer: null, model: null });
    }
  });

  it('échec de la base sur un modèle bien formé : enrôlé et 200 quand même, trace sans la valeur', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const value = { manufacturer: BRAND, model: 'a\u0000b' };
      const { terminal, res } = await enroll({ device_model: value });
      expect(res.status).toBe(201);
      expect(await row(terminal.deviceId)).toMatchObject({ manufacturer: null, model: null });
      expect((await beat(terminal, { device_model: value })).status).toBe(200);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('modèle'));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        expect(line).toContain(terminal.deviceId);
        expect(line).toMatch(/sqlstate=\w{5}/);
        expect(line).not.toContain(BRAND);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('signal de vie : modèle écrit si fourni, jamais effacé, jamais refusé (C-003)', async () => {
    const { terminal } = await enroll();
    expect((await beat(terminal)).status).toBe(200);
    expect(await row(terminal.deviceId)).toMatchObject({ manufacturer: null, model: null });
    const first = await beat(terminal, { device_model: { manufacturer: BRAND, model: 'Pixel 8' } });
    expect(first.status).toBe(200);
    expect(contractViolations('HeartbeatResponse', first.body)).toEqual([]);
    expect(await row(terminal.deviceId)).toMatchObject({ manufacturer: BRAND, model: 'pixel 8' });
    // Absent, vide ou mal formé : 200 et la valeur connue reste.
    for (const extra of [
      {},
      { device_model: null },
      { device_model: { manufacturer: '', model: '' } },
      { device_model: { manufacturer: BRAND, model: huge } },
      { device_model: 'Pixel' },
    ]) {
      expect((await beat(terminal, extra)).status).toBe(200);
      expect(await row(terminal.deviceId)).toMatchObject({ manufacturer: BRAND, model: 'pixel 8' });
    }
    // Nouveau modèle déclaré : mis à jour.
    expect(
      (await beat(terminal, { device_model: { manufacturer: BRAND, model: 'Pixel 9' } })).status,
    ).toBe(200);
    expect(await row(terminal.deviceId)).toMatchObject({ model: 'pixel 9' });
  });

  it('C-003 : le niveau NFC n’empêche ni l’enrôlement ni l’usage (absent, toléré)', async () => {
    await setLevel('toléré', 'TOLERATED');
    const tolerated = await enroll({ device_model: { manufacturer: BRAND, model: 'toléré' } });
    const untested = await enroll({ device_model: { manufacturer: BRAND, model: 'jamais testé' } });
    for (const { terminal, res } of [tolerated, untested]) {
      expect(res.status).toBe(201);
      expect((await beat(terminal)).status).toBe(200);
      const tap = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'POST',
        path: '/taps',
        body: {},
      });
      // Authentifié et autorisé : la requête n'échoue que sur son corps, jamais pour le niveau NFC.
      expect([400, 422]).toContain(tap.status);
    }
  });

  it('fiche et liste : device_model et nfc_level, casse sans effet', async () => {
    await setLevel('galaxy a15', 'RECOMMENDED');
    await setLevel('pixel 8', 'TOLERATED');
    const a = await enroll({
      device_model: { manufacturer: BRAND.toUpperCase(), model: 'Galaxy A15' },
    });
    const b = await enroll({ device_model: { manufacturer: BRAND, model: 'PIXEL 8' } });
    const c = await enroll({ device_model: { manufacturer: BRAND, model: 'Modèle Inconnu' } });
    const d = await enroll();
    const expected: Array<[TestTerminal, string, boolean]> = [
      [a.terminal, 'RECOMMENDED', true],
      [b.terminal, 'TOLERATED', true],
      [c.terminal, 'UNTESTED', true],
      [d.terminal, 'UNTESTED', false],
    ];
    for (const [terminal, level, hasModel] of expected) {
      const res = await staff(w.operatorAdminA).get(`/devices/${terminal.deviceId}`);
      expect(res.status).toBe(200);
      expect(contractViolations('DeviceAdminDetail', res.body)).toEqual([]);
      expect(res.body.nfc_level).toBe(level);
      if (hasModel) expect(res.body.device_model).toMatchObject({ manufacturer: BRAND });
      else expect(res.body).not.toHaveProperty('device_model');
    }
    const list = await staff(w.operatorAdminA).get('/devices?limit=200');
    expect(list.status).toBe(200);
    expect(contractViolations('DevicePage', list.body)).toEqual([]);
    const byId = new Map<string, { nfc_level: string }>(
      (list.body.data as Array<{ device_id: string; nfc_level: string }>).map((x) => [
        x.device_id,
        x,
      ]),
    );
    for (const [terminal, level] of expected)
      expect(byId.get(terminal.deviceId)?.nfc_level).toBe(level);
    // Un niveau retiré de la table : le terminal redevient UNTESTED (la jointure est lue à chaque
    // requête).
    await withOwner((db) =>
      db.query('DELETE FROM phone_model WHERE manufacturer = $1 AND model = $2', [
        BRAND,
        'galaxy a15',
      ]),
    );
    const after = await staff(w.operatorAdminA).get(`/devices/${a.terminal.deviceId}`);
    expect(after.body.nfc_level).toBe('UNTESTED');
  });

  it('portée et prestataire : autre prestataire 404, superviseur refusé', async () => {
    const { terminal } = await enroll({ device_model: { manufacturer: BRAND, model: 'pixel 8' } });
    const other = await staff(operatorAdminB).get(`/devices/${terminal.deviceId}`);
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain(BRAND);
    const otherList = await staff(operatorAdminB).get('/devices?limit=200');
    expect(otherList.status).toBe(200);
    expect(JSON.stringify(otherList.body)).not.toContain(terminal.deviceId);
    expect(JSON.stringify(otherList.body)).not.toContain(BRAND);
    // Droit de lecture des terminaux inchangé : un simple superviseur n'y accède pas.
    expect((await staff(w.supervisorA).get(`/devices/${terminal.deviceId}`)).status).toBe(403);
    const organizer = await staff(w.organizerAdminA).get(`/devices/${terminal.deviceId}`);
    expect([200, 404]).toContain(organizer.status);
  });
});
