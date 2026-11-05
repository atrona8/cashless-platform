// `GET /device/seq-status` (`getDeviceSeqStatus`, mission 7, lot WP21, partie D ; sync_protocol.md §6).
// Nominal, sans preuves (401), terminal suspendu (servi) ou révoqué (403), cloisonnement entre prestataires.
// `GET /events/{event_id}/device-sync-status` (`getEventDeviceSyncStatus`, ADR-73) : nominal, sans jeton (401),
// rôle non autorisé (403), autre prestataire ou événement inexistant (404 neutre).
// Écritures directes en base : amorçage seulement (événement du prestataire B, état de numérotation du terminal).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import type { TestPerson } from '../../support/fake-idp';
import { send, TestTerminal } from '../../support/test-terminal';

jest.setTimeout(180_000);

describe('getDeviceSeqStatus : état des séquences du terminal', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let a: TestTerminal;
  let b: TestTerminal;

  const status = (t: TestTerminal) =>
    t.request(api.baseUrl, api.tls.serverCaPem, { method: 'GET', path: '/device/seq-status' });

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    const eventB = randomUUID();
    await withOwner(async (db) => {
      const profile = (
        await db.query<{ j: string }>('SELECT jurisdiction_id AS j FROM event WHERE id = $1', [
          w.ids.eventA,
        ])
      ).rows[0]!.j;
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, w.ops.b, w.ids.organizerB, profile],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      await db.query('SELECT open_event_ledger($1)', [eventB]);
      a = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        ca,
      });
      b = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: w.ops.b,
        eventId: eventB,
        ca,
      });
    });
    await a.issueToken(tokens);
    await b.issueToken(tokens);
  });
  afterAll(async () => {
    await api?.close();
  });

  it('terminal neuf : rien reçu, aucun trou, plancher à 1', async () => {
    const res = await status(a);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      device_serial: a.serial,
      contiguous_acked_seq: 0,
      max_seen_seq: 0,
      missing_seqs: [],
      next_seq_floor: 1,
    });
  });

  it('numéros reçus avec trous : le plus grand sans trou, le plus grand vu et la liste des trous', async () => {
    await withOwner(async (db) => {
      // Amorçage : 1 et 2 acquittés, le plus grand vu est 5, aucune ligne de registre pour 3, 4 et 5.
      await db.query('ALTER TABLE device DISABLE TRIGGER USER');
      await db.query(
        'UPDATE device SET last_seq = 5, contiguous_acked_seq = 2, next_seq_floor = 6 WHERE id = $1',
        [a.deviceId],
      );
      await db.query('ALTER TABLE device ENABLE TRIGGER USER');
    });
    const res = await status(a);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      device_serial: a.serial,
      contiguous_acked_seq: 2,
      max_seen_seq: 5,
      missing_seqs: [3, 4, 5],
      next_seq_floor: 6,
    });
  });

  it('sans preuves de terminal : 401', async () => {
    const res = await send(
      {
        url: new URL(`${api.baseUrl}/device/seq-status`),
        method: 'GET',
        headers: {},
        body: '',
        cert: null,
        key: null,
      },
      api.tls.serverCaPem,
    );
    expect(res.status).toBe(401);
  });

  it('autre prestataire : chaque terminal ne lit que le sien, rien de l’autre ne fuit', async () => {
    const rb = await status(b);
    expect(rb.status).toBe(200);
    expect(rb.body.device_serial).toBe(b.serial);
    expect(rb.body.max_seen_seq).toBe(0);
    for (const forbidden of [a.serial, a.deviceId, w.ops.a])
      expect(rb.text).not.toContain(forbidden);
    const ra = await status(a);
    expect(ra.body.device_serial).toBe(a.serial);
    for (const forbidden of [b.serial, b.deviceId, w.ops.b])
      expect(ra.text).not.toContain(forbidden);
  });

  it('suspendu : servi ; révoqué : 403', async () => {
    await withOwner((db) => b.setStatus(db, 'SUSPENDED'));
    expect((await status(b)).status).toBe(200);
    await withOwner((db) => b.setStatus(db, 'REVOKED'));
    const res = await status(b);
    expect([res.status, res.body.code]).toEqual([403, 'DEVICE_REVOKED']);
  });
});

describe('getEventDeviceSyncStatus : remontée des terminaux d’un événement', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: FakeDeviceCa;
  let eventB: string;
  let term: TestTerminal;
  let admin: TestPerson; // ORGANIZER_ADMIN de A
  let operatorAdmin: TestPerson;
  let supervisor: TestPerson;
  let adminB: TestPerson;
  let otherOrganizerAdmin: TestPerson; // ORGANIZER_ADMIN d'un autre organisateur du même prestataire

  const get = (path: string, who: TestPerson | null) =>
    send(
      {
        url: new URL(`${api.baseUrl}${path}`),
        method: 'GET',
        headers: who ? { authorization: `Bearer ${who.token}` } : {},
        body: '',
        cert: null,
        key: null,
      },
      api.tls.serverCaPem,
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    eventB = randomUUID();
    const person = (
      operatorId: string,
      role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN' | 'SUPERVISOR',
      scopeType: 'OPERATOR' | 'ORGANIZER',
      scopeId: string,
    ) =>
      withOwner((db) =>
        w.idp.createPerson(db, { operatorId, roles: [{ role, scopeType, scopeId }] }),
      );
    await withOwner(async (db) => {
      const profile = (
        await db.query<{ j: string }>('SELECT jurisdiction_id AS j FROM event WHERE id = $1', [
          w.ids.eventA,
        ])
      ).rows[0]!.j;
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, w.ops.b, w.ids.organizerB, profile],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      await db.query('SELECT open_event_ledger($1)', [eventB]);
      term = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        ca,
      });
    });
    admin = await person(w.ops.a, 'ORGANIZER_ADMIN', 'ORGANIZER', w.ids.organizerA);
    operatorAdmin = await person(w.ops.a, 'OPERATOR_ADMIN', 'OPERATOR', w.ops.a);
    supervisor = await person(w.ops.a, 'SUPERVISOR', 'ORGANIZER', w.ids.organizerA);
    adminB = await person(w.ops.b, 'ORGANIZER_ADMIN', 'ORGANIZER', w.ids.organizerB);
    const otherOrganizer = randomUUID();
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name)
         VALUES ($1, 'ORGANIZER', $2, 'Autre organisateur')`,
        [otherOrganizer, w.ops.a],
      );
    });
    otherOrganizerAdmin = await person(w.ops.a, 'ORGANIZER_ADMIN', 'ORGANIZER', otherOrganizer);
  });
  afterAll(async () => {
    await api?.close();
  });

  it('nominal : date limite et terminaux de l’événement, pour les deux rôles de lecture', async () => {
    for (const who of [admin, operatorAdmin]) {
      const res = await get(`/events/${w.ids.eventA}/device-sync-status`, who);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['devices', 'sync_deadline']);
      const mine = (res.body.devices as Array<Record<string, unknown>>).find(
        (d) => d.device_id === term.deviceId,
      );
      expect(mine).toEqual({
        device_id: term.deviceId,
        serial: term.serial,
        caught_up: false,
        reason: 'NOT_SEEN_SINCE_CLOSING',
      });
    }
  });

  it('événement sans terminal : liste vide, date limite lisible', async () => {
    const res = await get(`/events/${eventB}/device-sync-status`, adminB);
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([]);
  });

  it('sans jeton : 401', async () => {
    expect((await get(`/events/${w.ids.eventA}/device-sync-status`, null)).status).toBe(401);
  });

  it('rôle non autorisé : 403', async () => {
    const res = await get(`/events/${w.ids.eventA}/device-sync-status`, supervisor);
    expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('autre prestataire, autre organisateur, événement inexistant : 404 neutre, sans fuite', async () => {
    const cases: Array<[string, TestPerson, string]> = [
      ['autre prestataire', adminB, w.ids.eventA],
      ['autre organisateur', otherOrganizerAdmin, w.ids.eventA],
      ['événement inexistant', admin, randomUUID()],
      ['événement de l’autre prestataire', admin, eventB],
    ];
    for (const [label, who, event] of cases) {
      const res = await get(`/events/${event}/device-sync-status`, who);
      expect({ label, status: res.status, code: res.body.code }).toEqual({
        label,
        status: 404,
        code: 'NOT_FOUND',
      });
      expect(res.text).not.toContain(term.serial);
      expect(res.text).not.toContain(term.deviceId);
    }
  });
});
