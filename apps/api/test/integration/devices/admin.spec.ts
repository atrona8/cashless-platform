// Back-office des terminaux (mission 5a, lot WP16, T078 ; FR-015 à FR-017, FR-025, NFR-003,
// NFR-007 ; contracts/device-lifecycle.md ; research R-14 ; hypothèse A2). Routes `listDevices`,
// `getDevice`, `suspendDevice`, `reactivateDevice`, `revokeDevice` servies à une personne
// (`FakeIdp`, vraie garde) ; effet sur le terminal prouvé en HTTPS par le terminal de test
// (identité réelle, trois preuves) : `POST /v1/taps` (API publique), `POST /v1/media/auth-keys`
// (processus des clés de bracelet) et une route de guichet (`GET /v1/media/{media_id}`).
//
// Révocation et suspension PENDANT une requête déjà passée par la garde (R-14, relecture de WP12) :
// la lecture du terminal par la garde (`DEVICE_DIRECTORY.find`) est enveloppée pour que la route
// du back-office valide la transition juste après que la garde a lu `ACTIVE` ; la requête n'est
// alors refusée que par `assert_device_active`, relu dans la transaction métier (`tap.service.ts`,
// `counter-access.ts`). Sans cet appel, la lecture serait enregistrée (taps) ou servie (guichet) :
// ces tests échouent.
//
// Écritures directes en base : amorçage seulement (organisateurs, événements, point de vente,
// personnes, bracelet), terminaux enrôlés par les fonctions de la base (test-terminal.ts).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import {
  DEVICE_DIRECTORY,
  type DeviceDirectory,
} from '../../../src/device-identity/device-identity.port';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { TagKeysProcessModule } from '../../../src/processes/tag-keys.module';
import { createTestApp, startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  MEDIA_KEY_INDEX,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import { TestTerminal, type TerminalMode } from '../../support/test-terminal';

const REASON = 'Terminal signalé perdu par le commerçant, en recherche.';
const SECRET_FIELDS = ['public_key', 'agreement_public_key', 'cert_sha256', 'token', 'refresh'];

describe('Back-office des terminaux (WP16)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let api: HttpsTestApp;
  let keys: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;
  let media: SeededMedia;
  const ids = {
    organizerA2: randomUUID(),
    eventA2: randomUUID(),
    eventB: randomUUID(),
    merchantA: randomUUID(),
    participationA: randomUUID(),
    posA: randomUUID(),
  };
  let organizerAdminA2: TestPerson;
  let operatorAdminB: TestPerson;
  let counter = 0;
  const next = () => (counter += 1);

  // ----- Personnes : routes du back-office (application en clair, vraie garde des personnes) -----
  const asPerson = (person: { token: string }) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${person.token}`),
    post: (path: string, body: unknown, key: string | null = randomUUID()) => {
      const req = request(app.getHttpServer())
        .post(`/v1${path}`)
        .set('Authorization', `Bearer ${person.token}`);
      if (key !== null) req.set('Idempotency-Key', key);
      return req.send(body as object);
    },
  });
  const change = (
    person: { token: string },
    deviceId: string,
    verb: 'suspend' | 'reactivate' | 'revoke',
    reason = REASON,
  ) => asPerson(person).post(`/devices/${deviceId}/${verb}`, { reason });

  // ----- Terminaux : enrôlés par les fonctions de la base, requêtes HTTPS (identité réelle) -----
  const enrolled = async (
    operatorId: string,
    eventId: string,
    options: { posId?: string; mode?: TerminalMode } = {},
  ): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId, eventId, ca, ...options }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const tap = (who: TestTerminal) =>
    who.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/taps',
      body: tapBody(media, next()),
    });
  const authKeys = (who: TestTerminal) =>
    who.request(keys.baseUrl, keys.tls.serverCaPem, {
      method: 'POST',
      path: '/media/auth-keys',
      body: { nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX },
    });
  const counterRead = (who: TestTerminal) =>
    who.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'GET', path: `/media/${media.id}` },
      { headers: { 'X-Staff-Authorization': `Bearer ${w.cashierA.token}` } },
    );
  const tapsOf = async (deviceId: string): Promise<number> =>
    (
      await rows<{ n: number }>('SELECT count(*)::int AS n FROM media_tap WHERE device_id = $1', [
        deviceId,
      ])
    )[0]!.n;
  const noncesOf = async (deviceId: string): Promise<number> =>
    (
      await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = $1',
        [deviceId],
      )
    )[0]!.n;
  const statusOf = async (deviceId: string): Promise<string> =>
    (await rows<{ status: string }>('SELECT status FROM device WHERE id = $1', [deviceId]))[0]!
      .status;

  /**
   * Exécute `send` en validant `between` juste après la lecture du terminal par la garde (qui a lu
   * `ACTIVE`) et avant le travail de la route : la requête est « déjà passée par la garde ».
   */
  async function afterGuard<T>(
    victim: TestTerminal,
    between: () => Promise<void>,
    send: () => Promise<T>,
  ): Promise<T> {
    const directory = api.app.get<DeviceDirectory>(DEVICE_DIRECTORY, { strict: false });
    const original = directory.find;
    let guardSaw: string | null = null;
    directory.find = async (operatorId, deviceId) => {
      const found = await original.call(directory, operatorId, deviceId);
      if (guardSaw === null && deviceId === victim.deviceId) {
        guardSaw = found?.status ?? 'NONE';
        await between();
      }
      return found;
    };
    try {
      const result = await send();
      expect(guardSaw).toBe('ACTIVE');
      return result;
    } finally {
      directory.find = original;
    }
  }

  let t1: TestTerminal; // événement A, point de vente A, CATALOG_POS
  let t2: TestTerminal; // événement A, KEYPAD_TPE
  let a2: TestTerminal[]; // événement A2 (autre organisateur du même prestataire)
  let tb: TestTerminal; // prestataire B

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      const { rows: event } = await db.query<{ jurisdiction_id: string }>(
        'SELECT jurisdiction_id FROM event WHERE id = $1',
        [w.ids.eventA],
      );
      const jurisdiction = event[0]!.jurisdiction_id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $3, 'Organisateur A2', 'SN'),
           ($2, 'MERCHANT', $3, 'Commerçant A', 'SN')`,
        [ids.organizerA2, ids.merchantA, w.ops.a],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder) VALUES
           ($1, $3, $4, 'Événement A2', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER'),
           ($2, $5, $7, 'Événement B', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER')`,
        [
          ids.eventA2,
          ids.eventB,
          w.ops.a,
          ids.organizerA2,
          w.ops.b,
          jurisdiction,
          w.ids.organizerB,
        ],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                             payout_to)
         VALUES ($1, $2, $3, $4, 'EXTERNAL', $4)`,
        [ids.participationA, w.ops.a, w.ids.eventA, ids.merchantA],
      );
      await db.query(
        `INSERT INTO point_of_sale (id, operator_id, participation_id, name)
         VALUES ($1, $2, $3, 'Buvette A')`,
        [ids.posA, w.ops.a, ids.participationA],
      );
      organizerAdminA2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.organizerA2 }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
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
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [media.id],
      });
    });
    app = await createTestApp({ identity: w.idp });
    api = await startHttpsApp(undefined, { identity: w.idp });
    keys = await startHttpsApp(TagKeysProcessModule);
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    t1 = await enrolled(w.ops.a, w.ids.eventA, { posId: ids.posA, mode: 'CATALOG_POS' });
    t2 = await enrolled(w.ops.a, w.ids.eventA, { mode: 'KEYPAD_TPE' });
    a2 = [
      await enrolled(w.ops.a, ids.eventA2),
      await enrolled(w.ops.a, ids.eventA2),
      await enrolled(w.ops.a, ids.eventA2),
    ];
    tb = await enrolled(w.ops.b, ids.eventB);
  });

  afterAll(async () => {
    await app?.close();
    await api?.close();
    await keys?.close();
  });

  // ------------------------------------------------------------------ T075 : liste et fiche

  describe('liste (listDevices)', () => {
    const idsOf = (body: { data: Array<{ device_id: string }> }) =>
      body.data.map((d) => d.device_id).sort();

    it('OPERATOR_ADMIN : tous les terminaux de son prestataire, aucun d’un autre', async () => {
      const res = await asPerson(w.operatorAdminA).get('/devices?limit=200');
      expect(res.status).toBe(200);
      const seen = idsOf(res.body);
      for (const t of [t1, t2, ...a2]) expect(seen).toContain(t.deviceId);
      expect(seen).not.toContain(tb.deviceId);
      const b = await asPerson(operatorAdminB).get('/devices?limit=200');
      expect(idsOf(b.body)).toEqual([tb.deviceId]);
    });

    it('ORGANIZER_ADMIN : les seuls terminaux des événements de son organisateur', async () => {
      const a = await asPerson(w.organizerAdminA).get('/devices?limit=200');
      expect(a.status).toBe(200);
      expect(idsOf(a.body)).toEqual([t1.deviceId, t2.deviceId].sort());
      const other = await asPerson(organizerAdminA2).get('/devices?limit=200');
      expect(idsOf(other.body)).toEqual(a2.map((t) => t.deviceId).sort());
      // Filtre sur un événement hors de sa portée : rien, sans erreur ni indice.
      const outside = await asPerson(organizerAdminA2).get(`/devices?event_id=${w.ids.eventA}`);
      expect([outside.status, outside.body.data]).toEqual([200, []]);
    });

    it('filtres event_id, pos_id, status, app_mode', async () => {
      const as = asPerson(w.operatorAdminA);
      expect(idsOf((await as.get(`/devices?event_id=${w.ids.eventA}`)).body)).toEqual(
        [t1.deviceId, t2.deviceId].sort(),
      );
      expect(idsOf((await as.get(`/devices?pos_id=${ids.posA}`)).body)).toEqual([t1.deviceId]);
      expect(
        idsOf((await as.get(`/devices?event_id=${w.ids.eventA}&app_mode=KEYPAD_TPE`)).body),
      ).toEqual([t2.deviceId]);
      expect(
        idsOf((await as.get(`/devices?event_id=${w.ids.eventA}&status=SUSPENDED`)).body),
      ).toEqual([]);
      for (const bad of ['event_id=x', 'pos_id=1', 'status=LOST', 'app_mode=X', 'limit=0'])
        expect((await as.get(`/devices?${bad}`)).status).toBe(400);
    });

    it('pagination par curseur : pages disjointes, dernière page sans suite', async () => {
      const as = asPerson(w.operatorAdminA);
      const first = await as.get(`/devices?event_id=${ids.eventA2}&limit=2`);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.has_more).toBe(true);
      const second = await as.get(
        `/devices?event_id=${ids.eventA2}&limit=2&cursor=${String(first.body.next_cursor)}`,
      );
      expect(second.body.data).toHaveLength(1);
      expect([second.body.has_more, second.body.next_cursor]).toEqual([false, null]);
      expect([...idsOf(first.body), ...idsOf(second.body)].sort()).toEqual(
        a2.map((t) => t.deviceId).sort(),
      );
      expect((await as.get('/devices?cursor=pas-un-curseur')).status).toBe(400);
    });
  });

  describe('fiche (getDevice)', () => {
    it('statut, affectation, système, attestation, certificat, historique', async () => {
      const res = await asPerson(w.operatorAdminA).get(`/devices/${t1.deviceId}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        device_id: t1.deviceId,
        serial: t1.serial,
        kind: 'POS',
        app_mode: 'CATALOG_POS',
        os: 'ANDROID',
        personal_phone: false,
        nfc_enabled: true,
        status: 'ACTIVE',
        status_reason: null,
        event_id: w.ids.eventA,
        pos_id: ids.posA,
        app_version: '1.0.0-test',
        attestation_kind: 'ANDROID_KEY_ATTESTATION',
        attestation_security_level: 'TRUSTED_ENVIRONMENT',
        enrolled_at: expect.any(String),
        cert_not_after: expect.any(String),
      });
      expect(res.body.status_history).toEqual([
        {
          from_status: null,
          to_status: 'ACTIVE',
          reason: 'ENROLLED',
          actor_id: null,
          at: expect.any(String),
        },
      ]);
    });

    it('jamais de clé, d’empreinte de certificat ni de jeton (noms ni valeurs)', async () => {
      const [secret] = await rows<{
        public_key: Buffer;
        agreement_public_key: Buffer;
        cert_sha256: Buffer;
      }>('SELECT public_key, agreement_public_key, cert_sha256 FROM device WHERE id = $1', [
        t1.deviceId,
      ]);
      const values = Object.values(secret!).flatMap((b) => [
        b.toString('hex'),
        b.toString('base64'),
        b.toString('base64url'),
      ]);
      const responses = [
        await asPerson(w.operatorAdminA).get(`/devices/${t1.deviceId}`),
        await asPerson(w.operatorAdminA).get(`/devices?event_id=${w.ids.eventA}`),
      ];
      for (const res of responses) {
        expect(res.status).toBe(200);
        const keysSeen = new Set<string>();
        JSON.stringify(res.body, (key, value: unknown) => (keysSeen.add(key), value));
        for (const field of SECRET_FIELDS)
          expect([...keysSeen].filter((k) => k.includes(field))).toEqual([]);
        for (const value of values) expect(res.text).not.toContain(value);
        expect(res.text).not.toContain(t1.token);
        expect(res.text).not.toContain(t1.refreshToken);
      }
    });

    it('autre prestataire, autre organisateur, inconnu, mal formé : 404 neutre', async () => {
      const cases: Array<[TestPerson, string]> = [
        [operatorAdminB, t1.deviceId],
        [w.operatorAdminA, tb.deviceId],
        [organizerAdminA2, t1.deviceId],
        [w.organizerAdminA, a2[0]!.deviceId],
        [w.operatorAdminA, randomUUID()],
        [w.operatorAdminA, 'pas-un-uuid'],
      ];
      const bodies = new Set<string>();
      for (const [person, id] of cases) {
        const res = await asPerson(person).get(`/devices/${id}`);
        expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
        const { instance: _instance, ...problem } = res.body as Record<string, unknown>;
        bodies.add(JSON.stringify(problem));
      }
      expect(bodies.size).toBe(1);
    });

    it('rôles : SUPERVISOR, CASHIER, PLATFORM_ADMIN refusés (403) ; sans jeton : 401', async () => {
      for (const person of [w.supervisorA, w.cashierA, w.platformAdmin]) {
        expect((await asPerson(person).get('/devices')).status).toBe(403);
        expect((await asPerson(person).get(`/devices/${t1.deviceId}`)).status).toBe(403);
        expect((await change(person, t1.deviceId, 'suspend')).status).toBe(403);
      }
      expect((await request(app.getHttpServer()).get('/v1/devices')).status).toBe(401);
      expect(await statusOf(t1.deviceId)).toBe('ACTIVE');
    });
  });

  // ------------------------------------------------------------------ T076, T077 : transitions

  describe('transitions (suspendDevice, reactivateDevice, revokeDevice)', () => {
    it('suspendre, réactiver, révoquer : historique, audit, familles ; REVOKED final', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const as = asPerson(w.operatorAdminA);

      const suspended = await change(w.operatorAdminA, t.deviceId, 'suspend');
      expect(suspended.status).toBe(200);
      expect(suspended.body).toMatchObject({ status: 'SUSPENDED', status_reason: REASON });
      expect(suspended.body.status_history[0]).toMatchObject({
        from_status: 'ACTIVE',
        to_status: 'SUSPENDED',
        reason: REASON,
        actor_id: w.operatorAdminA.userId,
      });
      expect((await change(w.operatorAdminA, t.deviceId, 'suspend')).body.code).toBe(
        'CONFLICT_STATE',
      );

      const back = await change(
        w.operatorAdminA,
        t.deviceId,
        'reactivate',
        'Retrouvé et contrôlé sur site.',
      );
      expect([back.status, back.body.status]).toEqual([200, 'ACTIVE']);
      const again = await change(w.operatorAdminA, t.deviceId, 'reactivate');
      expect([again.status, again.body.code]).toEqual([409, 'CONFLICT_STATE']);

      const revoked = await change(
        w.operatorAdminA,
        t.deviceId,
        'revoke',
        'Terminal volé, plainte déposée.',
      );
      expect([revoked.status, revoked.body.status]).toEqual([200, 'REVOKED']);
      expect(revoked.body.status_history.map((h: { to_status: string }) => h.to_status)).toEqual([
        'REVOKED',
        'ACTIVE',
        'SUSPENDED',
        'ACTIVE',
      ]);
      // Familles révoquées dans la même transaction (aucun jeton vivant).
      expect(
        await rows(`SELECT revoked_reason FROM device_refresh_token WHERE device_id = $1`, [
          t.deviceId,
        ]),
      ).toEqual([{ revoked_reason: 'DEVICE_REVOKED' }]);
      // REVOKED est définitif.
      for (const verb of ['reactivate', 'suspend', 'revoke'] as const) {
        const res = await change(w.operatorAdminA, t.deviceId, verb);
        expect([verb, res.status, res.body.code]).toEqual([verb, 409, 'CONFLICT_STATE']);
      }
      expect(await statusOf(t.deviceId)).toBe('REVOKED');

      // Une ligne d'audit par transition validée (acteur, rôle, motif, avant, après), et aucune
      // pour les refus.
      const audit = await rows<{
        action: string;
        actor_id: string;
        actor_role: string;
        before: unknown;
        after: unknown;
        request_id: string | null;
      }>(
        `SELECT action, actor_id, actor_role, before, after, request_id FROM audit_log
          WHERE object_type = 'device' AND object_id = $1 ORDER BY seq`,
        [t.deviceId],
      );
      expect(audit.map(({ request_id: _r, ...entry }) => entry)).toEqual([
        {
          action: 'DEVICE_SUSPENDED',
          actor_id: w.operatorAdminA.userId,
          actor_role: 'OPERATOR_ADMIN',
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED', reason: REASON },
        },
        {
          action: 'DEVICE_REACTIVATED',
          actor_id: w.operatorAdminA.userId,
          actor_role: 'OPERATOR_ADMIN',
          before: { status: 'SUSPENDED' },
          after: { status: 'ACTIVE', reason: 'Retrouvé et contrôlé sur site.' },
        },
        {
          action: 'DEVICE_REVOKED',
          actor_id: w.operatorAdminA.userId,
          actor_role: 'OPERATOR_ADMIN',
          before: { status: 'ACTIVE' },
          after: { status: 'REVOKED', reason: 'Terminal volé, plainte déposée.' },
        },
      ]);
      expect((await as.get(`/devices/${t.deviceId}`)).body.status).toBe('REVOKED');
    });

    it('révocation depuis SUSPENDED permise', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await change(w.operatorAdminA, t.deviceId, 'suspend')).status).toBe(200);
      const res = await change(w.operatorAdminA, t.deviceId, 'revoke');
      expect([res.status, res.body.status]).toEqual([200, 'REVOKED']);
    });

    it('Idempotency-Key obligatoire ; rejeu : même réponse, une seule transition', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const as = asPerson(w.operatorAdminA);
      const missing = await as.post(`/devices/${t.deviceId}/suspend`, { reason: REASON }, null);
      expect([missing.status, missing.body.code]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const key = randomUUID();
      const first = await as.post(`/devices/${t.deviceId}/suspend`, { reason: REASON }, key);
      const replay = await as.post(`/devices/${t.deviceId}/suspend`, { reason: REASON }, key);
      expect([first.status, replay.status]).toEqual([200, 200]);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(
        await rows('SELECT 1 FROM device_status_history WHERE device_id = $1 AND to_status = $2', [
          t.deviceId,
          'SUSPENDED',
        ]),
      ).toHaveLength(1);
    });

    it('ADR-116 : même clé sur deux `:id` → 409 IDEMPOTENCY_KEY_REUSED ; B traité par sa clé', async () => {
      // OP-N71 : l'empreinte prenait le modèle de route ; la révocation de B rejouait le 200 de A.
      const a = await enrolled(w.ops.a, w.ids.eventA);
      const b = await enrolled(w.ops.a, w.ids.eventA);
      const as = asPerson(w.operatorAdminA);
      const body = { reason: 'Terminaux volés ensemble, plainte déposée.' };
      const key = randomUUID();
      const first = await as.post(`/devices/${a.deviceId}/revoke`, body, key);
      expect([first.status, first.body.status, first.body.device_id]).toEqual([
        200,
        'REVOKED',
        a.deviceId,
      ]);
      const other = await as.post(`/devices/${b.deviceId}/revoke`, body, key);
      expect([other.status, other.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(other.headers['idempotency-replayed']).toBeUndefined();
      expect(await statusOf(b.deviceId)).toBe('ACTIVE');
      // Rejeu légitime inchangé : même ressource, même clé, même corps.
      const replay = await as.post(`/devices/${a.deviceId}/revoke`, body, key);
      expect([replay.status, replay.headers['idempotency-replayed']]).toEqual([200, 'true']);
      expect(replay.body).toEqual(first.body);
      // B n'est révoqué que par sa propre clé.
      const own = await as.post(`/devices/${b.deviceId}/revoke`, body, randomUUID());
      expect([own.status, own.body.status, own.body.device_id]).toEqual([
        200,
        'REVOKED',
        b.deviceId,
      ]);
      expect(
        await rows<{ device_id: string }>(
          `SELECT device_id FROM device_status_history
            WHERE device_id = ANY($1) AND to_status = 'REVOKED' ORDER BY device_id`,
          [[a.deviceId, b.deviceId]],
        ),
      ).toHaveLength(2);
    });

    it('ADR-116 : même clé par une autre personne du prestataire → aucune réponse de l’autre', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const key = randomUUID();
      const first = await asPerson(w.operatorAdminA).post(
        `/devices/${t.deviceId}/suspend`,
        { reason: REASON },
        key,
      );
      expect([first.status, first.body.status]).toEqual([200, 'SUSPENDED']);
      // Une collègue qui a droit au terminal et connaît la clé : refus, rien de la réponse.
      const colleague = await asPerson(w.organizerAdminA).post(
        `/devices/${t.deviceId}/suspend`,
        { reason: REASON },
        key,
      );
      expect([colleague.status, colleague.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(colleague.headers['idempotency-replayed']).toBeUndefined();
      expect(colleague.body.status_history).toBeUndefined();
      expect(JSON.stringify(colleague.body)).not.toContain(t.deviceId);
      // La personne d'origine rejoue toujours sa réponse.
      const replay = await asPerson(w.operatorAdminA).post(
        `/devices/${t.deviceId}/suspend`,
        { reason: REASON },
        key,
      );
      expect([replay.status, replay.headers['idempotency-replayed']]).toEqual([200, 'true']);
      expect(replay.body).toEqual(first.body);
      expect(
        await rows('SELECT 1 FROM device_status_history WHERE device_id = $1 AND to_status = $2', [
          t.deviceId,
          'SUSPENDED',
        ]),
      ).toHaveLength(1);
    });

    it('motif de 10 à 500 caractères, aucun autre champ : 400 sans transition', async () => {
      const as = asPerson(w.operatorAdminA);
      for (const body of [
        {},
        { reason: '' },
        { reason: 'court' },
        { reason: 'x'.repeat(501) },
        { reason: 42 },
        { reason: REASON, status: 'ACTIVE' },
      ]) {
        const res = await as.post(`/devices/${t2.deviceId}/suspend`, body);
        expect([JSON.stringify(body).slice(0, 40), res.status]).toEqual([
          JSON.stringify(body).slice(0, 40),
          400,
        ]);
      }
      expect(await statusOf(t2.deviceId)).toBe('ACTIVE');
    });

    it('A2 : ORGANIZER_ADMIN agit seul sur un terminal de son organisateur, audité', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await change(w.organizerAdminA, t.deviceId, 'suspend')).status).toBe(200);
      expect((await change(w.organizerAdminA, t.deviceId, 'reactivate')).status).toBe(200);
      expect((await change(w.organizerAdminA, t.deviceId, 'revoke')).status).toBe(200);
      const roles = await rows<{ actor_role: string }>(
        `SELECT actor_role FROM audit_log WHERE object_type = 'device' AND object_id = $1`,
        [t.deviceId],
      );
      expect(roles.map((r) => r.actor_role)).toEqual([
        'ORGANIZER_ADMIN',
        'ORGANIZER_ADMIN',
        'ORGANIZER_ADMIN',
      ]);
    });

    it('NFR-007 : autre prestataire, autre organisateur : 404, rien changé ni audité', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const cases: Array<[TestPerson, TestTerminal]> = [
        [operatorAdminB, t],
        [organizerAdminA2, t],
        [w.organizerAdminA, a2[0]!],
        [w.operatorAdminA, tb],
      ];
      for (const [person, target] of cases)
        for (const verb of ['suspend', 'revoke'] as const) {
          const res = await change(person, target.deviceId, verb);
          expect([verb, res.status, res.body.code]).toEqual([verb, 404, 'NOT_FOUND']);
        }
      for (const target of [t, a2[0]!, tb]) expect(await statusOf(target.deviceId)).toBe('ACTIVE');
      expect(
        await rows(`SELECT 1 FROM audit_log WHERE object_type = 'device' AND object_id = ANY($1)`, [
          [t.deviceId, a2[0]!.deviceId, tb.deviceId],
        ]),
      ).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ T078 : effet sur le terminal

  describe('effet immédiat sur le terminal (FR-015, FR-016, NFR-003, R-14)', () => {
    it('suspendu : /taps et /media/auth-keys → 403 DEVICE_SUSPENDED ; réactivé : 200', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await tap(t)).status).toBe(200);
      expect((await change(w.operatorAdminA, t.deviceId, 'suspend')).status).toBe(200);
      const taps = await tapsOf(t.deviceId);
      const refusedTap = await tap(t);
      expect([refusedTap.status, refusedTap.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
      const refusedKeys = await authKeys(t);
      expect([refusedKeys.status, refusedKeys.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
      expect(refusedKeys.body.enc).toBeUndefined();
      expect(await tapsOf(t.deviceId)).toBe(taps);
      expect((await change(w.operatorAdminA, t.deviceId, 'reactivate')).status).toBe(200);
      expect((await tap(t)).status).toBe(200);
      expect((await authKeys(t)).status).toBe(200);
    });

    it('FR-016, NFR-003 : révoqué au back-office, requête suivante → 403 DEVICE_REVOKED', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await tap(t)).status).toBe(200);
      expect((await change(w.operatorAdminA, t.deviceId, 'revoke')).status).toBe(200);
      // Le jeton n'est pas expiré (signature et `exp` valides) : seul l'état en base refuse.
      await expect(tokens.verify(t.token)).resolves.toMatchObject({ deviceId: t.deviceId });
      const taps = await tapsOf(t.deviceId);
      const nonces = await noncesOf(t.deviceId);
      // Étape 6 bis de contracts/device-authentication.md (ADR-115) : la famille révoquée avec le
      // terminal n'est pas opposée ; trois preuves valides → 403, sans nonce ni écriture.
      for (const res of [await tap(t), await authKeys(t), await counterRead(t)])
        expect([res.status, res.body.code]).toEqual([403, 'DEVICE_REVOKED']);
      expect(await tapsOf(t.deviceId)).toBe(taps);
      expect(await noncesOf(t.deviceId)).toBe(nonces);
    });

    it('ADR-115 : terminal révoqué, une preuve fausse → 401, aucun nonce', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await change(w.operatorAdminA, t.deviceId, 'revoke')).status).toBe(200);
      const [header, payload] = t.token.split('.');
      const forged = `${header}.${payload}.${t2.token.split('.')[2]}`;
      const nonces = await noncesOf(t.deviceId);
      const spec = { method: 'POST', path: '/taps', body: tapBody(media, next()) } as const;
      for (const proofs of [
        { certificate: t2 },
        { token: forged },
        { signature: { privateKey: t2.signing.privateKey } },
      ]) {
        const res = await t.request(api.baseUrl, api.tls.serverCaPem, spec, proofs);
        expect(res.status).toBe(401);
        expect(res.body.code).not.toBe('DEVICE_REVOKED');
      }
      expect(await noncesOf(t.deviceId)).toBe(nonces);
    });

    it('R-14 : révocation pendant un /taps passé par la garde : 403, rien écrit', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const taps = await tapsOf(t.deviceId);
      const res = await afterGuard(
        t,
        async () => {
          expect((await change(w.operatorAdminA, t.deviceId, 'revoke')).status).toBe(200);
        },
        () => tap(t),
      );
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_REVOKED']);
      expect(await tapsOf(t.deviceId)).toBe(taps);
      expect(await statusOf(t.deviceId)).toBe('REVOKED');
    });

    it('R-14 : suspension pendant un /taps passé par la garde : 403, rien écrit', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const taps = await tapsOf(t.deviceId);
      const res = await afterGuard(
        t,
        async () => {
          expect((await change(w.operatorAdminA, t.deviceId, 'suspend')).status).toBe(200);
        },
        () => tap(t),
      );
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
      expect(await tapsOf(t.deviceId)).toBe(taps);
    });

    it('R-14 : révocation pendant une route de guichet passée par la garde : 403', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      expect((await counterRead(t)).status).toBe(200);
      const res = await afterGuard(
        t,
        async () => {
          expect((await change(w.operatorAdminA, t.deviceId, 'revoke')).status).toBe(200);
        },
        () => counterRead(t),
      );
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_REVOKED']);
      expect(res.body.media_id).toBeUndefined();
    });

    it('R-14 : suspension pendant une route de guichet passée par la garde : 403', async () => {
      const t = await enrolled(w.ops.a, w.ids.eventA);
      const res = await afterGuard(
        t,
        async () => {
          expect((await change(w.operatorAdminA, t.deviceId, 'suspend')).status).toBe(200);
        },
        () => counterRead(t),
      );
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
      expect(res.body.media_id).toBeUndefined();
    });
  });
});
