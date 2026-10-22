// Isolation entre prestataires sur chaque route de la mission 5a (lot WP18, T084 ; NFR-007,
// SC-006 ; contracts/enrollment.md : « même serial chez deux prestataires »). Deux prestataires A
// et B, chacun son événement, son administrateur et un terminal enrôlé par la route avec LE MÊME
// `serial`. Chaque route de la mission (liste lue dans le contrat : une route sans cas ici fait
// échouer le premier test) est appelée par B sur les objets de A : jamais un 2xx sur un objet de
// A, jamais un identifiant de A dans une réponse à B, et aucun objet de A modifié ni audité. Les
// routes de terminal de la mission 4 (guichet) sont aussi appelées par le terminal et le caissier
// de B sur un bracelet de A. `deviceScope` (relecture de WP16) : un OPERATOR_ADMIN ne voit que les
// terminaux du prestataire de son attribution.
//
// Écritures directes en base : amorçage seulement (prestataire B : événement, grand livre,
// personnes ; bracelet de A personnalisé et activé par les fonctions du schéma ; numéros déjà
// consommés par le terminal de A). La suite enrôle depuis sa propre adresse (`X-Forwarded-For`)
// et ne lit que ses propres objets.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { ATTESTATION_VERIFIER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  asPerson,
  contractDeviceOperations,
  enrollFrom,
  issueCode,
  realAttestation,
  refresh,
  testAddress,
  type RealAttestation,
} from '../../support/device-e2e';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import { TestTerminal, type RouteServer, type TerminalResponse } from '../../support/test-terminal';

jest.setTimeout(120_000);

/** Opérations ajoutées au contrat par la mission 5a (contracts/openapi-additions.md). */
const MISSION_OPERATIONS = [
  'createDeviceEnrollmentCode',
  'listDeviceEnrollmentCodes',
  'enrollDevice',
  'refreshDeviceToken',
  'getDeviceConfig',
  'postDeviceHeartbeat',
  'listDevices',
  'getDevice',
  'suspendDevice',
  'reactivateDevice',
  'revokeDevice',
];
const REASON = 'Contrôle d’isolation entre prestataires (test).';
const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');

/** Identifiants d'opération du contrat. */
function contractOperationIds(): Set<string> {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  return new Set(
    Object.values(contract.paths).flatMap((operations) =>
      Object.values(operations).flatMap((op) => (op?.operationId ? [op.operationId] : [])),
    ),
  );
}

describe('NFR-007, SC-006 : aucune fuite entre prestataires, routes de la mission', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let attestation: RealAttestation;
  let tokens: DeviceTokenService;
  let ca: FakeDeviceCa;
  let eventB: string;
  let operatorAdminB: TestPerson;
  let mediaA: SeededMedia;
  const address = testAddress();
  const serial = `ISO-${randomUUID().slice(0, 8)}`;
  const a = new TestTerminal('ANDROID', serial);
  const b = new TestTerminal('ANDROID', serial);
  let codeIdA = '';
  let usedCodeA = '';
  let counter = 0;
  const next = () => (counter += 1);

  /** Identifiants de A qu'aucune réponse faite à B ne doit contenir. */
  const secretsOfA = () => [a.deviceId, codeIdA, w.ids.eventA, w.ids.ledgerA, mediaA.id];
  /** Identifiants de A dans la réponse, hors ceux que B a lui-même envoyés dans sa requête. */
  const leaks = (res: TerminalResponse, sent: string[] = []) =>
    secretsOfA().filter((id) => !sent.includes(id) && res.text.includes(id));
  const stateOfA = async () => ({
    device: await rows('SELECT status, status_reason, event_id FROM device WHERE id = $1', [
      a.deviceId,
    ]),
    history: await rows('SELECT to_status FROM device_status_history WHERE device_id = $1', [
      a.deviceId,
    ]),
    audit: await rows(
      `SELECT action FROM audit_log WHERE object_type = 'device' AND object_id = $1 ORDER BY seq`,
      [a.deviceId],
    ),
    codes: await rows(
      'SELECT id, used_at FROM device_enrollment_code WHERE event_id = $1 ORDER BY id',
      [w.ids.eventA],
    ),
    refresh: await rows(
      `SELECT consumed_at, revoked_at FROM device_refresh_token WHERE device_id = $1`,
      [a.deviceId],
    ),
  });

  beforeAll(async () => {
    w = await createMediaWorld();
    attestation = await realAttestation();
    api = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: ATTESTATION_VERIFIER, useValue: attestation.verifier }],
      trustProxyHops: 1,
    });
    server = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
    tokens = api.app.get(DeviceTokenService, { strict: false });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    eventB = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         SELECT $1, $2, $3, 'Événement B', currency, timezone, jurisdiction_id, funds_holder
           FROM event WHERE id = $4`,
        [eventB, w.ops.b, w.ids.organizerB, w.ids.eventA],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      await db.query('SELECT open_event_ledger($1)', [eventB]);
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
    await withOwner(async (db) => {
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      [mediaA] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [mediaA.id],
      });
    });
    const pkis = { androidPki: attestation.androidPki };
    const codeA = await issueCode(server, w.operatorAdminA.token, { event_id: w.ids.eventA });
    codeIdA = String(codeA.res.body.enrollment_code_id);
    usedCodeA = codeA.code;
    expect((await enrollFrom(server, a, codeA.code, address, pkis)).status).toBe(201);
    const codeB = await issueCode(server, operatorAdminB.token, { event_id: eventB });
    expect((await enrollFrom(server, b, codeB.code, address, pkis)).status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    attestation?.dispose();
  });

  it('le contrat déclare les routes de la mission, et chacune a un cas dans ce fichier', () => {
    const contract = contractOperationIds();
    expect(MISSION_OPERATIONS.filter((id) => !contract.has(id))).toEqual([]);
    // Les deux routes de terminal de la mission sont bien des routes à preuves de terminal.
    expect(contractDeviceOperations().map((op) => op.operationId)).toEqual(
      expect.arrayContaining(['getDeviceConfig', 'postDeviceHeartbeat', 'refreshDeviceToken']),
    );
    expect(Object.keys(cases).sort()).toEqual([...MISSION_OPERATIONS].sort());
  });

  it('même serial chez deux prestataires : deux terminaux, chacun chez lui', async () => {
    expect(a.deviceId).not.toBe(b.deviceId);
    expect([a.operatorId, b.operatorId]).toEqual([w.ops.a, w.ops.b]);
    expect(
      await rows<{ operator_id: string; serial: string }>(
        'SELECT operator_id, serial FROM device WHERE id = ANY($1) ORDER BY operator_id = $2 DESC',
        [[a.deviceId, b.deviceId], w.ops.a],
      ),
    ).toEqual([
      { operator_id: w.ops.a, serial },
      { operator_id: w.ops.b, serial },
    ]);
  });

  /**
   * Un cas par opération de la mission : B (sa personne, ou son terminal) vise A. Rend la réponse ;
   * le test commun vérifie l'absence de 2xx sur A, de fuite, et de changement sur A.
   */
  const cases: Record<
    string,
    () => Promise<{ res: TerminalResponse; listing?: boolean; sent?: string[] }>
  > = {
    createDeviceEnrollmentCode: async () => ({
      res: await asPerson(server, operatorAdminB.token).post('/device-enrollment-codes', {
        event_id: w.ids.eventA,
        app_mode: 'CATALOG_POS',
        kind: 'POS',
        personal_phone: false,
      }),
      sent: [w.ids.eventA],
    }),
    listDeviceEnrollmentCodes: async () => ({
      res: await asPerson(server, operatorAdminB.token).get('/device-enrollment-codes?limit=100'),
      listing: true,
    }),
    enrollDevice: async () => {
      // Route anonyme : le prestataire est celui du code. Le code de A, déjà utilisé, reçoit le
      // refus d'un code inconnu, sans rien dire de A (ni terminal, ni événement).
      const res = await enrollFrom(server, new TestTerminal(), usedCodeA, address, {
        androidPki: attestation.androidPki,
      });
      return { res };
    },
    refreshDeviceToken: async () => ({
      res: await refresh(server, b, { token: a.refreshToken }),
    }),
    getDeviceConfig: async () => ({
      // Le certificat de A avec le jeton et la signature de B : preuves de deux terminaux.
      res: await b.request(
        api.baseUrl,
        api.tls.serverCaPem,
        { method: 'GET', path: '/device/config' },
        { certificate: a },
      ),
    }),
    postDeviceHeartbeat: async () => ({
      res: await b.request(
        api.baseUrl,
        api.tls.serverCaPem,
        {
          method: 'POST',
          path: '/device/heartbeat',
          body: {
            device_time: new Date().toISOString(),
            snapshot_version: null,
            last_local_seq: 0,
            pending_operations: 0,
            pending_exposure: 0,
            battery_percent: 50,
          },
        },
        { token: a.token },
      ),
    }),
    listDevices: async () => ({
      res: await asPerson(server, operatorAdminB.token).get('/devices?limit=100'),
      listing: true,
    }),
    getDevice: async () => ({
      res: await asPerson(server, operatorAdminB.token).get(`/devices/${a.deviceId}`),
      sent: [a.deviceId],
    }),
    suspendDevice: async () => ({
      res: await asPerson(server, operatorAdminB.token).post(`/devices/${a.deviceId}/suspend`, {
        reason: REASON,
      }),
      sent: [a.deviceId],
    }),
    reactivateDevice: async () => ({
      res: await asPerson(server, operatorAdminB.token).post(`/devices/${a.deviceId}/reactivate`, {
        reason: REASON,
      }),
      sent: [a.deviceId],
    }),
    revokeDevice: async () => ({
      res: await asPerson(server, operatorAdminB.token).post(`/devices/${a.deviceId}/revoke`, {
        reason: REASON,
      }),
      sent: [a.deviceId],
    }),
  };

  it('B sur les objets de A : jamais 2xx, rien ne fuit, rien ne change', async () => {
    const before = await stateOfA();
    const wrong: string[] = [];
    for (const [operation, run] of Object.entries(cases)) {
      const { res, listing, sent } = await run();
      if (!listing && res.status < 300) wrong.push(`${operation} : ${res.status} sur A`);
      if (listing && res.status !== 200) wrong.push(`${operation} : liste ${res.status}`);
      const leaked = leaks(res, sent);
      if (leaked.length > 0) wrong.push(`${operation} : ${leaked.join(', ')} dans la réponse`);
    }
    expect(wrong).toEqual([]);
    expect(await stateOfA()).toEqual(before);
    // Aucun code créé par B sur l'événement de A.
    expect(
      await rows('SELECT 1 FROM device_enrollment_code WHERE event_id = $1 AND created_by = $2', [
        w.ids.eventA,
        operatorAdminB.userId,
      ]),
    ).toEqual([]);
    // A est toujours servi, avec ses propres preuves.
    expect(
      (
        await a.request(api.baseUrl, api.tls.serverCaPem, {
          method: 'GET',
          path: '/device/config',
        })
      ).status,
    ).toBe(200);
  });

  it('chacun sa configuration ; next_seq calculé dans son prestataire', async () => {
    const confA = await a.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
    const confB = await b.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
    expect([confA.status, confB.status]).toEqual([200, 200]);
    expect((confA.body.event as { event_id: string }).event_id).toBe(w.ids.eventA);
    expect((confB.body.event as { event_id: string }).event_id).toBe(eventB);
    expect(leaks(confB)).toEqual([]);
    // Ré-enrôlement du même serial chez B après sa révocation : next_seq de B, jamais celui de A
    // (amorçage : le terminal de A a déjà consommé 50 numéros, posé en propriétaire).
    await withOwner((db) =>
      db.query('UPDATE device SET last_seq = 50 WHERE id = $1', [a.deviceId]),
    );
    const lastSeqB = (
      await rows<{ last_seq: string }>(
        'SELECT last_seq::text AS last_seq FROM device WHERE id = $1',
        [b.deviceId],
      )
    )[0]!.last_seq;
    expect(
      (
        await asPerson(server, operatorAdminB.token).post(`/devices/${b.deviceId}/revoke`, {
          reason: REASON,
        })
      ).status,
    ).toBe(200);
    const renewed = new TestTerminal('ANDROID', serial);
    const code = await issueCode(server, operatorAdminB.token, { event_id: eventB });
    const res = await enrollFrom(server, renewed, code.code, address, {
      androidPki: attestation.androidPki,
    });
    expect(res.status).toBe(201);
    expect(res.body.next_seq).toBe(Number(lastSeqB) + 1);
    expect(res.body.next_seq).not.toBe(51);
    expect(leaks(res)).toEqual([]);
    expect(renewed.operatorId).toBe(w.ops.b);
    // A n'a pas été touché par la révocation de B.
    expect((await rows('SELECT status FROM device WHERE id = $1', [a.deviceId]))[0]).toEqual({
      status: 'ACTIVE',
    });
  });

  it('listes de B : aucun terminal ni code de A ; listes de A : aucun de B', async () => {
    const devicesB = await asPerson(server, operatorAdminB.token).get('/devices?limit=100');
    const idsB = (devicesB.body.data as Array<{ device_id: string }>).map((d) => d.device_id);
    expect(idsB).toContain(b.deviceId);
    expect(idsB).not.toContain(a.deviceId);
    const devicesA = await asPerson(server, w.operatorAdminA.token).get('/devices?limit=100');
    const idsA = (devicesA.body.data as Array<{ device_id: string }>).map((d) => d.device_id);
    expect(idsA).toContain(a.deviceId);
    expect(idsA).not.toContain(b.deviceId);
    const codesB = await asPerson(server, operatorAdminB.token).get(
      '/device-enrollment-codes?limit=100',
    );
    expect(codesB.status).toBe(200);
    expect(
      (codesB.body.data as Array<{ event_id: string }>).every((c) => c.event_id === eventB),
    ).toBe(true);
  });

  it('deviceScope : OPERATOR_ADMIN sur un autre prestataire refusé par la base', async () => {
    // Une attribution OPERATOR_ADMIN porte toujours la portée OPERATOR de son propre prestataire
    // (role_assignment_guard) : la défense en profondeur de `deviceScope` ne peut être prise en
    // défaut par une ligne mal formée. Le test unitaire de deviceScope couvre l'autre côté.
    await expect(
      withOwner((db) =>
        db.query(
          `INSERT INTO role_assignment (user_id, role, scope_type, scope_id)
           VALUES ($1, 'OPERATOR_ADMIN', 'OPERATOR', $2)`,
          [operatorAdminB.userId, w.ops.a],
        ),
      ),
    ).rejects.toThrow(/autre prestataire/);
    const res = await asPerson(server, operatorAdminB.token).get(`/devices/${a.deviceId}`);
    expect(res.status).toBe(404);
  });

  it('guichet (mission 4) : terminal et caissier de B sur un bracelet de A', async () => {
    const cashierB = w.cashierB;
    const staff = { 'x-staff-authorization': `Bearer ${cashierB.token}` };
    const wrong: string[] = [];
    const calls: Array<[string, 'GET' | 'POST', string, unknown]> = [
      ['GET /media/{}', 'GET', `/media/${mediaA.id}`, undefined],
      ['POST /media/{}/release', 'POST', `/media/${mediaA.id}/release`, {}],
      ['POST /media/{}/deposit', 'POST', `/media/${mediaA.id}/deposit`, {}],
      ['POST /media/{}/deposit/refund', 'POST', `/media/${mediaA.id}/deposit/refund`, {}],
      ['POST /media/{}/replace', 'POST', `/media/${mediaA.id}/replace`, {}],
      ['POST /media/{}/reassignment', 'POST', `/media/${mediaA.id}/reassignment`, {}],
      ['POST /media/{}/cash-due-refunds', 'POST', `/media/${mediaA.id}/cash-due-refunds`, {}],
      [
        'POST /media/activations',
        'POST',
        '/media/activations',
        { tap: tapBody(mediaA, next()), channel: 'DESK', occurred_at: new Date().toISOString() },
      ],
    ];
    // Terminal actif de B, enrôlé en propriétaire (celui de la suite a été révoqué plus haut).
    const renewedB = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId: w.ops.b, eventId: eventB, ca }),
    );
    await renewedB.issueToken(tokens);
    const mediaBefore = await rows('SELECT status, wallet_id FROM media WHERE id = $1', [
      mediaA.id,
    ]);
    for (const [route, method, path, body] of calls) {
      const res = await renewedB.request(
        api.baseUrl,
        api.tls.serverCaPem,
        { method, path, body, idempotencyKey: method === 'POST' ? randomUUID() : undefined },
        { headers: staff },
      );
      if (res.status < 300) wrong.push(`${route} : ${res.status}`);
      const leaked = leaks(res, [mediaA.id]);
      if (leaked.length > 0) wrong.push(`${route} : ${leaked.join(', ')}`);
    }
    // Lecture d'un bracelet de A par le terminal de B : enregistrée nulle part chez A.
    const tap = await renewedB.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/taps',
      body: tapBody(mediaA, next()),
    });
    expect(leaks(tap, [mediaA.id])).toEqual([]);
    expect(wrong).toEqual([]);
    expect(await rows('SELECT status, wallet_id FROM media WHERE id = $1', [mediaA.id])).toEqual(
      mediaBefore,
    );
    expect(
      await rows('SELECT 1 FROM media_tap WHERE device_id = $1 AND media_id = $2', [
        renewedB.deviceId,
        mediaA.id,
      ]),
    ).toEqual([]);
  });
});
