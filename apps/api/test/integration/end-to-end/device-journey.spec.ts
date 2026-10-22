// Parcours complet d'un terminal (mission 5a, lot WP18, T083 ; SC-001, SC-003, NFR-003 ; FR-016,
// FR-025 ; ADR-115 ; quickstart.md, « Parcours à la main »), entièrement par l'API, en HTTPS réel :
// un OPERATOR_ADMIN émet deux codes, un Android et un iPhone de test s'enrôlent par la route
// (vérificateur d'attestation RÉEL sur des racines de test), lisent leur configuration, envoient
// leur battement de cœur ; le caissier active un bracelet au guichet avec l'Android, qui le lit ;
// l'Android rafraîchit son jeton ; le back-office le suspend (configuration et battement servis,
// lecture et rafraîchissement refusés), le réactive, le révoque (`403 DEVICE_REVOKED` sur chaque
// route avec des preuves valides, `401` avec une preuve fausse, rien écrit), puis le même `serial`
// est ré-enrôlé. Les transitions sont auditées avec l'adresse du client et le `X-Request-Id`.
//
// Écritures directes en base : amorçage seulement (jeu d'essai commun, bracelet personnalisé posé
// par `seedPersonalizedMedia` : la personnalisation par la route est prouvée par la mission 4).
// Aucune étape du parcours n'écrit en base ; les lectures sont bornées aux objets de la suite. La
// suite enrôle depuis sa propre adresse (`X-Forwarded-For`, un répartiteur de confiance pour cette
// suite seulement) et n'efface rien.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ATTESTATION_VERIFIER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import {
  adoptRefresh,
  asPerson,
  claimsOf,
  enrollFrom,
  issueCode,
  noncesOf,
  realAttestation,
  refresh,
  testAddress,
  type RealAttestation,
} from '../../support/device-e2e';
import {
  createBatch,
  createMediaWorld,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import {
  TestTerminal,
  type ProofOptions,
  type RouteServer,
  type TerminalResponse,
} from '../../support/test-terminal';

jest.setTimeout(120_000);

const SUSPEND_REASON = 'Terminal signalé perdu par le commerçant, en recherche.';
const REACTIVATE_REASON = 'Retrouvé et contrôlé sur site.';
const REVOKE_REASON = 'Terminal volé, plainte déposée.';

interface DeviceRow {
  status: string;
  last_seq: string;
  last_seen_at: Date | null;
  app_version: string | null;
}

describe('SC-001 : parcours complet d’un terminal, tout par l’API', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let attestation: RealAttestation;
  let media: SeededMedia;
  /** Adresse des terminaux qui s'enrôlent, et celle du back-office (audit). */
  const enrollFromAddress = testAddress();
  const adminAddress = testAddress();
  const android = new TestTerminal('ANDROID');
  const iphone = new TestTerminal('IOS');
  let counter = 0;
  const next = () => (counter += 1);
  /** `X-Request-Id` de chaque transition du back-office, dans l'ordre. */
  const transitionRequests: string[] = [];

  const request = (
    t: TestTerminal,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    proofs: ProofOptions = {},
  ): Promise<TerminalResponse> =>
    t.request(api.baseUrl, api.tls.serverCaPem, { method, path, body }, proofs);
  const config = (t: TestTerminal, proofs: ProofOptions = {}) =>
    request(t, 'GET', '/device/config', undefined, proofs);
  const heartbeat = (t: TestTerminal, proofs: ProofOptions = {}) =>
    request(
      t,
      'POST',
      '/device/heartbeat',
      {
        device_time: new Date().toISOString(),
        snapshot_version: null,
        last_local_seq: 0,
        pending_operations: 0,
        pending_exposure: 0,
        battery_percent: 71,
        app_version: '1.0.0-test',
      },
      proofs,
    );
  const tap = (t: TestTerminal, proofs: ProofOptions = {}) =>
    request(t, 'POST', '/taps', tapBody(media, next()), proofs);
  const admin = () => asPerson(server, w.operatorAdminA.token);
  const transition = async (
    t: TestTerminal,
    verb: 'suspend' | 'reactivate' | 'revoke',
    reason: string,
  ) => {
    const requestId = randomUUID();
    const res = await admin().post(
      `/devices/${t.deviceId}/${verb}`,
      { reason },
      { requestId, from: adminAddress },
    );
    if (res.status === 200) transitionRequests.push(requestId);
    return res;
  };
  const device = async (deviceId: string): Promise<DeviceRow> =>
    (
      await rows<DeviceRow>(
        `SELECT status, last_seq::text AS last_seq, last_seen_at, app_version
           FROM device WHERE id = $1`,
        [deviceId],
      )
    )[0]!;
  const tapsOf = async (deviceId: string): Promise<number> =>
    (
      await rows<{ n: number }>('SELECT count(*)::int AS n FROM media_tap WHERE device_id = $1', [
        deviceId,
      ])
    )[0]!.n;
  const servedConfigs = async (deviceId: string): Promise<number> =>
    (
      await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_config_served WHERE device_id = $1',
        [deviceId],
      )
    )[0]!.n;
  const liveRefreshTokens = async (deviceId: string): Promise<number> =>
    (
      await rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM device_refresh_token
          WHERE device_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [deviceId],
      )
    )[0]!.n;

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
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      [media] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
    });
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    attestation?.dispose();
  });

  it('1. émettre un code par terminal ; enrôler un Android et un iPhone par la route', async () => {
    for (const t of [android, iphone]) {
      const { code } = await issueCode(server, w.operatorAdminA.token, {
        event_id: w.ids.eventA,
      });
      const res = await enrollFrom(server, t, code, enrollFromAddress, {
        androidPki: attestation.androidPki,
        iosPki: attestation.iosPki,
      });
      expect([t.os, res.status]).toEqual([t.os, 201]);
      expect(res.body).toMatchObject({ serial: t.serial, next_seq: 1, token_type: 'Bearer' });
      expect([t.operatorId, t.eventId]).toEqual([w.ops.a, w.ids.eventA]);
      expect((await device(t.deviceId)).status).toBe('ACTIVE');
    }
    const kinds = await rows<{ id: string; attestation_kind: string }>(
      'SELECT id, attestation_kind FROM device WHERE id = ANY($1) ORDER BY attestation_kind',
      [[android.deviceId, iphone.deviceId]],
    );
    expect(kinds).toEqual([
      { id: android.deviceId, attestation_kind: 'ANDROID_KEY_ATTESTATION' },
      { id: iphone.deviceId, attestation_kind: 'IOS_APP_ATTEST' },
    ]);
  });

  it('2. configuration et battement de cœur, pour les deux terminaux', async () => {
    for (const t of [android, iphone]) {
      const conf = await config(t);
      expect([t.os, conf.status]).toEqual([t.os, 200]);
      expect(contractViolations('DeviceConfig', conf.body)).toEqual([]);
      expect(conf.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
      const beat = await heartbeat(t);
      expect([t.os, beat.status]).toEqual([t.os, 200]);
      expect(contractViolations('HeartbeatResponse', beat.body)).toEqual([]);
      expect(beat.body.config_etag).toBe(conf.headers.etag);
      const row = await device(t.deviceId);
      expect(row.last_seen_at).not.toBeNull();
      expect(row.app_version).toBe('1.0.0-test');
    }
  });

  it('3. le caissier active un bracelet avec l’Android, qui le lit (POST /taps)', async () => {
    const activation = await android.request(
      api.baseUrl,
      api.tls.serverCaPem,
      {
        method: 'POST',
        path: '/media/activations',
        body: {
          tap: tapBody(media, next()),
          channel: 'DESK',
          occurred_at: new Date().toISOString(),
        },
        idempotencyKey: randomUUID(),
      },
      { headers: { 'x-staff-authorization': `Bearer ${w.cashierA.token}` } },
    );
    expect(activation.status).toBe(201);
    expect(activation.body).toMatchObject({ media_id: media.id, media_status: 'ACTIVE' });
    const res = await tap(android);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'OK', media: { media_id: media.id } });
    expect(await tapsOf(android.deviceId)).toBeGreaterThanOrEqual(1);
  });

  it('4. rafraîchir : nouvelle paire de la même famille, servie par la garde', async () => {
    const family = android.familyId;
    const oldRefresh = android.refreshToken;
    const res = await refresh(server, android);
    adoptRefresh(android, res);
    expect(android.refreshToken).not.toBe(oldRefresh);
    expect(claimsOf(android.token)).toMatchObject({ sub: android.deviceId, fid: family });
    expect((await config(android)).status).toBe(200);
    expect(await liveRefreshTokens(android.deviceId)).toBe(1);
  });

  it('5. suspendre : configuration, battement servis ; lecture, rafraîchissement refusés', async () => {
    const res = await transition(android, 'suspend', SUSPEND_REASON);
    expect([res.status, res.body.status]).toEqual([200, 'SUSPENDED']);
    expect((await config(android)).status).toBe(200);
    expect((await heartbeat(android)).status).toBe(200);
    const taps = await tapsOf(android.deviceId);
    const refused = await tap(android);
    expect([refused.status, refused.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    expect(await tapsOf(android.deviceId)).toBe(taps);
    const renewal = await refresh(server, android);
    expect([renewal.status, renewal.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    expect(await liveRefreshTokens(android.deviceId)).toBe(1);
  });

  it('6. réactiver (back-office) : la lecture est de nouveau servie', async () => {
    const res = await transition(android, 'reactivate', REACTIVATE_REASON);
    expect([res.status, res.body.status]).toEqual([200, 'ACTIVE']);
    expect((await tap(android)).status).toBe(200);
  });

  it('7. révoquer : 403 avec des preuves valides, 401 avec une fausse, rien écrit', async () => {
    const res = await transition(android, 'revoke', REVOKE_REASON);
    expect([res.status, res.body.status]).toEqual([200, 'REVOKED']);
    const before = {
      row: await device(android.deviceId),
      nonces: await noncesOf(android.deviceId),
      taps: await tapsOf(android.deviceId),
      configs: await servedConfigs(android.deviceId),
    };
    // Le jeton d'appareil est encore dans sa validité : seule la révocation le prive de tout.
    expect(Number(claimsOf(android.token).exp) * 1000).toBeGreaterThan(Date.now());
    const forged = { signature: { privateKey: iphone.signing.privateKey } };
    for (const [name, send] of [
      ['configuration', (p: ProofOptions) => config(android, p)],
      ['battement de cœur', (p: ProofOptions) => heartbeat(android, p)],
      ['lecture', (p: ProofOptions) => tap(android, p)],
    ] as const) {
      const valid = await send({});
      expect([name, valid.status, valid.body.code]).toEqual([name, 403, 'DEVICE_REVOKED']);
      const fake = await send(forged);
      expect([name, fake.status]).toEqual([name, 401]);
    }
    const renewal = await refresh(server, android);
    expect([renewal.status, renewal.body.code]).toEqual([403, 'DEVICE_REVOKED']);
    const stolen = await refresh(server, android, { signingKey: iphone.signing.privateKey });
    expect([stolen.status, stolen.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    expect({
      row: await device(android.deviceId),
      nonces: await noncesOf(android.deviceId),
      taps: await tapsOf(android.deviceId),
      configs: await servedConfigs(android.deviceId),
    }).toEqual(before);
    expect(await liveRefreshTokens(android.deviceId)).toBe(0);
    // L'iPhone n'est pas touché.
    expect((await config(iphone)).status).toBe(200);
  });

  it('8. ré-enrôler le même serial : nouveau terminal, next_seq suivant', async () => {
    const old = await device(android.deviceId);
    const renewed = new TestTerminal('ANDROID', android.serial);
    const { code } = await issueCode(server, w.operatorAdminA.token, { event_id: w.ids.eventA });
    const res = await enrollFrom(server, renewed, code, enrollFromAddress, {
      androidPki: attestation.androidPki,
    });
    expect(res.status).toBe(201);
    expect(res.body.next_seq).toBe(Number(old.last_seq) + 1);
    expect(renewed.deviceId).not.toBe(android.deviceId);
    expect((await config(renewed)).status).toBe(200);
    expect((await tap(renewed)).status).toBe(200);
    // L'ancien terminal reste révoqué, avec ses anciennes preuves.
    expect((await config(android)).status).toBe(403);
  });

  it('9. historique ; FR-025 : audit des transitions avec adresse et X-Request-Id', async () => {
    const detail = await admin().get(`/devices/${android.deviceId}`);
    expect(detail.status).toBe(200);
    expect(
      (detail.body.status_history as Array<{ to_status: string }>).map((h) => h.to_status),
    ).toEqual(['REVOKED', 'ACTIVE', 'SUSPENDED', 'ACTIVE']);
    const audit = await rows<{
      action: string;
      actor_id: string;
      actor_role: string;
      origin: string;
      request_id: string;
      after: { status: string; reason: string };
    }>(
      `SELECT action, actor_id, actor_role, origin, request_id::text AS request_id, after
         FROM audit_log
        WHERE operator_id = $1 AND object_type = 'device' AND object_id = $2
          AND action IN ('DEVICE_SUSPENDED', 'DEVICE_REACTIVATED', 'DEVICE_REVOKED')
        ORDER BY seq`,
      [w.ops.a, android.deviceId],
    );
    expect(audit).toEqual(
      [
        ['DEVICE_SUSPENDED', 'SUSPENDED', SUSPEND_REASON],
        ['DEVICE_REACTIVATED', 'ACTIVE', REACTIVATE_REASON],
        ['DEVICE_REVOKED', 'REVOKED', REVOKE_REASON],
      ].map(([action, status, reason], i) => ({
        action,
        actor_id: w.operatorAdminA.userId,
        actor_role: 'OPERATOR_ADMIN',
        origin: adminAddress,
        request_id: transitionRequests[i],
        after: { status, reason },
      })),
    );
  });
});
