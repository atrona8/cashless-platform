// Sessions de vendeur sur un terminal (mission 5b, lot WP09, T040 à T043 ; FR-003 à FR-006,
// FR-026, NFR-002 à NFR-004, NFR-007 ; contracts/vendors.md ; research R-11 A6, A7, A22).
// Terminaux de test enrôlés par les fonctions de la base, requêtes HTTPS signées (trois preuves,
// identité réelle). Back-office (nouveau PIN, statut du vendeur, suspension et révocation du
// terminal par la route de la 5a) servi à une personne par l'application en clair.
//
// Écritures directes en base (amorçage, signalées) : commerçants, points de vente, vendeurs par
// `create_vendor` ; expiration d'une session simulée en reculant `opened_at`/`expires_at` (12 h) ;
// verrou d'essai tenu par le propriétaire pour prouver le `429` sans dépendre du hasard.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/config';
import { requestHash } from '../../../src/idempotency/request-hash';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from 'pg';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { VendorPinHasher } from '../../../src/vendor-pin/vendor-pin.hasher';
import { PIN_ATTEMPT_LOCK_KEY } from '../../../src/vendors/pin-attempt-lock';
import { VendorSessionGuard } from '../../../src/vendors/vendor-session-guard';
import { createTestApp, startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { connect, OWNER_URL, withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  TestTerminal,
  type TerminalMode,
  type TerminalResponse,
} from '../../support/test-terminal';
import { seedPos, seedVendor, type SeededPos } from './vendor-fixtures';

jest.setTimeout(120_000);

const PIN = '314159';
const WRONG = '000000';
const NEW_PIN = '271828';
const REASON = 'Terminal signalé perdu par le commerçant, en recherche.';

/** Problème sans ce qui varie d'une requête à l'autre (NFR-004). */
const stable = (body: Record<string, unknown>) => {
  const { instance: _i, request_id: _r, ...rest } = body;
  return rest;
};

describe('Sessions de vendeur (WP09, T040 à T043)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let app: INestApplication;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let hasher: VendorPinHasher;
  let posA: SeededPos;
  let posA2: SeededPos;

  const enrolled = async (
    options: { posId?: string | null; mode?: TerminalMode } = {},
  ): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        posId: options.posId === undefined ? posA.posId : options.posId,
        mode: options.mode ?? 'CATALOG_POS',
        ca,
      }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const vendor = async (
    merchantId = posA.merchantId,
    displayName = `Vendeur ${randomUUID().slice(0, 8)}`,
    pin = PIN,
  ): Promise<string> => {
    const pinHash = await hasher.hash(pin);
    return withOwner((db) =>
      seedVendor(db, {
        operatorId: w.ops.a,
        merchantId,
        actorId: w.operatorAdminA.userId,
        displayName,
        pinHash,
      }),
    );
  };

  // ----- Terminal (HTTPS, trois preuves) -----
  const open = (t: TestTerminal, vendorId: string, pin: unknown = PIN, key = randomUUID()) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/vendor-sessions',
      body: { vendor_id: vendorId, pin },
      idempotencyKey: key,
    });
  const close = (t: TestTerminal, key = randomUUID()) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'DELETE',
      path: '/vendor-sessions/current',
      idempotencyKey: key,
    });
  const list = (t: TestTerminal) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'GET',
      path: '/vendor-sessions/vendors',
    });

  // ----- Back-office (personne) -----
  const asAdmin = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`/v1${path}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body as object);

  // ----- Lectures du propriétaire -----
  const vendorRow = async (id: string) =>
    (
      await ownerRows<{ failed_attempts: number; locked: boolean; status: string }>(
        `SELECT failed_attempts, locked_at IS NOT NULL AS locked, status FROM vendor WHERE id = $1`,
        [id],
      )
    )[0]!;
  const sessionsOf = (deviceId: string) =>
    ownerRows<{ id: string; vendor_id: string; closed_reason: string | null; ttl: string }>(
      `SELECT id, vendor_id, closed_reason, (expires_at - opened_at)::text AS ttl
         FROM vendor_session WHERE device_id = $1 ORDER BY opened_at, id`,
      [deviceId],
    );
  const vendorAudit = (vendorId: string) =>
    ownerRows<{ action: string; origin: string; after: unknown }>(
      `SELECT action, origin, after FROM audit_log
        WHERE object_type = 'vendor' AND object_id = $1 ORDER BY seq`,
      [vendorId],
    );
  const failedAudits = async (vendorId: string) =>
    (await vendorAudit(vendorId)).filter((a) => a.action === 'VENDOR_PIN_FAILED').length;

  /** Garde de session appelée dans une transaction du prestataire du terminal. */
  const guard = (t: TestTerminal, sessionId: string) =>
    api.app.get(TenantTx, { strict: false }).run(w.ops.a, (client) =>
      api.app.get(VendorSessionGuard, { strict: false }).assert(
        client,
        {
          deviceId: t.deviceId,
          operatorId: w.ops.a,
          eventId: null,
          posId: null,
          agreementPublicKey: null,
        },
        sessionId,
      ),
    );
  const guardStatus = async (t: TestTerminal, sessionId: string): Promise<string> => {
    try {
      return `ok:${await guard(t, sessionId)}`;
    } catch (error) {
      return String((error as { code?: string }).code);
    }
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      posA = await seedPos(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        name: 'Commerçant A',
      });
      posA2 = await seedPos(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        name: 'Commerçant A2',
      });
    });
    api = await startHttpsApp(undefined, { identity: w.idp });
    app = await createTestApp({ identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    hasher = api.app.get(VendorPinHasher, { strict: false });
  });

  afterAll(async () => {
    await app?.close();
    await api?.close();
  });

  // ------------------------------------------------------------------ T041 : ouverture

  it('FR-003 : bon PIN → 201 VendorSession (12 h), compteur à 0, audit VENDOR_SESSION_OPENED', async () => {
    const t = await enrolled();
    const v = await vendor(posA.merchantId, 'Awa (bar)');
    await open(t, v, WRONG);
    expect((await vendorRow(v)).failed_attempts).toBe(1);
    const res = await open(t, v);
    expect(res.status).toBe(201);
    expect(contractViolations('VendorSession', res.body)).toEqual([]);
    expect(res.body).toMatchObject({ vendor_id: v, vendor_display_name: 'Awa (bar)' });
    expect(res.text).not.toMatch(new RegExp(`${PIN}|\\$argon2|pin`));
    const sessions = await sessionsOf(t.deviceId);
    expect(sessions).toEqual([
      {
        id: res.body.vendor_session_id as string,
        vendor_id: v,
        closed_reason: null,
        ttl: '12:00:00',
      },
    ]);
    expect((await vendorRow(v)).failed_attempts).toBe(0);
    const opened = await ownerRows<{ action: string; origin: string; actor_id: string | null }>(
      `SELECT action, origin, actor_id FROM audit_log WHERE object_id = $1`,
      [res.body.vendor_session_id as string],
    );
    expect(opened).toEqual([
      { action: 'VENDOR_SESSION_OPENED', origin: `device:${t.deviceId}`, actor_id: null },
    ]);
    expect(await guardStatus(t, res.body.vendor_session_id as string)).toBe(`ok:${v}`);
  });

  it('NFR-004 : PIN faux, inconnu, autre commerçant, désactivé, bloqué → même statut, même corps', async () => {
    const t = await enrolled();
    const good = await vendor();
    const foreign = await vendor(posA2.merchantId);
    const disabled = await vendor();
    const locked = await vendor();
    await asAdmin(`/vendors/${disabled}/status`, { status: 'DISABLED' }).expect(200);
    await withOwner((db) =>
      db.query(`UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = $1`, [locked]),
    );
    // Un essai à la fois par terminal : les cas partent l'un après l'autre.
    const cases: Array<[string, () => Promise<TerminalResponse>]> = [
      ['PIN faux', () => open(t, good, WRONG)],
      ['vendeur inconnu', () => open(t, randomUUID())],
      ['autre commerçant, bon PIN', () => open(t, foreign)],
      ['désactivé, bon PIN', () => open(t, disabled)],
      ['bloqué, bon PIN', () => open(t, locked)],
    ];
    const bodies = new Set<string>();
    for (const [name, send] of cases) {
      const res = await send();
      expect([name, res.status, res.body.code]).toEqual([name, 401, 'VENDOR_PIN_INVALID']);
      expect(res.text).not.toMatch(new RegExp(`${PIN}|${WRONG}|\\$argon2`));
      bodies.add(JSON.stringify(stable(res.body)));
    }
    expect(bodies.size).toBe(1);
    // Seul l'essai sur le bon vendeur est compté et audité ; un vendeur d'un autre commerçant
    // n'est jamais compté ; aucune session.
    expect((await vendorRow(good)).failed_attempts).toBe(1);
    expect(await failedAudits(good)).toBe(1);
    expect((await vendorRow(foreign)).failed_attempts).toBe(0);
    expect(await vendorAudit(foreign)).toEqual([]);
    expect((await vendorRow(disabled)).failed_attempts).toBe(0);
    expect((await vendorRow(locked)).failed_attempts).toBe(5);
    expect(await sessionsOf(t.deviceId)).toEqual([]);
  });

  it('NFR-002 : PIN mal formé → 422 sans écho, aucun essai compté', async () => {
    const t = await enrolled();
    const v = await vendor();
    for (const pin of ['12345', '1234567', 'abcdef', 314159]) {
      const res = await open(t, v, pin);
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
      expect(res.text).not.toContain(String(pin));
    }
    expect((await vendorRow(v)).failed_attempts).toBe(0);
  });

  it('FR-004, NFR-003 : 5 échecs → bloqué (VENDOR_LOCKED) ; 6e bon PIN refusé sur deux terminaux ; nouveau PIN débloque', async () => {
    const t1 = await enrolled();
    const t2 = await enrolled({ mode: 'KEYPAD_TPE' });
    const v = await vendor();
    for (let i = 0; i < 5; i += 1) expect((await open(t1, v, WRONG)).status).toBe(401);
    expect(await vendorRow(v)).toEqual({ failed_attempts: 5, locked: true, status: 'ACTIVE' });
    const audit = await vendorAudit(v);
    expect(audit.filter((a) => a.action === 'VENDOR_PIN_FAILED')).toHaveLength(5);
    expect(audit.filter((a) => a.action === 'VENDOR_LOCKED')).toHaveLength(1);
    expect(
      audit.every((a) => a.origin === `device:${t1.deviceId}` || a.action === 'VENDOR_CREATED'),
    ).toBe(true);
    for (const t of [t1, t2]) {
      const res = await open(t, v);
      expect([res.status, res.body.code]).toEqual([401, 'VENDOR_PIN_INVALID']);
    }
    expect((await vendorRow(v)).failed_attempts).toBe(5);
    // Bloqué : absent de la liste du terminal.
    const listed = (await list(t1)).body.data as Array<{ vendor_id: string }>;
    expect(listed.map((x) => x.vendor_id)).not.toContain(v);
    await asAdmin(`/vendors/${v}/pin`, { pin: NEW_PIN }).expect(200);
    expect((await open(t2, v, PIN)).status).toBe(401);
    expect((await open(t2, v, NEW_PIN)).status).toBe(201);
  });

  it('compter d’abord : 4 PIN faux puis le bon PIN bloquent le vendeur (5e essai bloqué avant vérification)', async () => {
    const t = await enrolled();
    const v = await vendor();
    for (let i = 0; i < 4; i += 1) await open(t, v, WRONG);
    const res = await open(t, v);
    expect([res.status, res.body.code]).toEqual([401, 'VENDOR_PIN_INVALID']);
    expect(await vendorRow(v)).toMatchObject({ failed_attempts: 5, locked: true });
    expect(await sessionsOf(t.deviceId)).toEqual([]);
  });

  it('un essai à la fois par terminal : verrou tenu → 429 RATE_LIMITED + Retry-After, rien compté', async () => {
    const t = await enrolled();
    const v = await vendor();
    const holder: Client = await connect(OWNER_URL);
    try {
      await holder.query(`SELECT pg_advisory_lock(${PIN_ATTEMPT_LOCK_KEY})`, [t.deviceId]);
      const derive = jest.spyOn(hasher, 'idempotencyBody');
      const verify = jest.spyOn(hasher, 'verify');
      const res = await open(t, v);
      // Refusé avant tout argon2 : ni dérivé d'empreinte ni vérification du PIN.
      expect([derive.mock.calls.length, verify.mock.calls.length]).toEqual([0, 0]);
      derive.mockRestore();
      verify.mockRestore();
      expect([res.status, res.body.code, res.headers['retry-after']]).toEqual([
        429,
        'RATE_LIMITED',
        '1',
      ]);
      // Un autre terminal n'est pas gêné.
      expect((await open(await enrolled(), v, WRONG)).status).toBe(401);
    } finally {
      await holder.end();
    }
    expect((await vendorRow(v)).failed_attempts).toBe(1);
    expect((await open(t, v)).status).toBe(201);
  });

  /** Vrai si aucune session n'avait le verrou d'essai du terminal (pris puis rendu depuis une autre connexion). */
  const attemptLockFree = async (t: TestTerminal): Promise<boolean> => {
    const probe: Client = await connect(OWNER_URL);
    try {
      const { rows } = await probe.query<{ taken: boolean }>(
        `SELECT pg_try_advisory_lock(${PIN_ATTEMPT_LOCK_KEY}) AS taken`,
        [t.deviceId],
      );
      if (rows[0]?.taken)
        await probe.query(`SELECT pg_advisory_unlock(${PIN_ATTEMPT_LOCK_KEY})`, [t.deviceId]);
      return rows[0]?.taken === true;
    } finally {
      await probe.end();
    }
  };

  it('un essai à la fois par terminal : un essai en cours retenu dans argon2 → le second reçoit 429, la clé du 429 reste rejouable', async () => {
    const t = await enrolled();
    const v = await vendor();
    const original = hasher.verify.bind(hasher);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const spy = jest.spyOn(hasher, 'verify').mockImplementationOnce(async (digest, pin) => {
      entered();
      await gate;
      return original(digest, pin);
    });
    const derive = jest.spyOn(hasher, 'idempotencyBody');
    try {
      const first = open(t, v, WRONG);
      await inside; // le premier essai tient le verrou et attend dans argon2
      expect([derive.mock.calls.length, spy.mock.calls.length]).toEqual([1, 1]);
      const busyKey = randomUUID();
      const second = await open(t, v, WRONG, busyKey);
      expect([second.status, second.body.code, second.headers['retry-after']]).toEqual([
        429,
        'RATE_LIMITED',
        '1',
      ]);
      // Le second essai n'a payé aucun argon2 : ni dérivé d'empreinte, ni vérification du PIN.
      expect([derive.mock.calls.length, spy.mock.calls.length]).toEqual([1, 1]);
      expect((await vendorRow(v)).failed_attempts).toBe(1); // seul l'essai en cours est compté
      release();
      expect((await first).status).toBe(401);
      expect((await vendorRow(v)).failed_attempts).toBe(1);
      // Le 429 n'est pas enregistré : la même clé, rejouée, est un nouvel essai (compté), pas un rejeu.
      const retry = await open(t, v, WRONG, busyKey);
      expect([retry.status, retry.headers['idempotency-replayed']]).toEqual([401, undefined]);
      expect((await vendorRow(v)).failed_attempts).toBe(2);
    } finally {
      release();
      spy.mockRestore();
      derive.mockRestore();
    }
  });

  it('le verrou est pris AVANT le dérivé d’empreinte : un essai retenu dans ce dérivé fait refuser le second sans argon2', async () => {
    const t = await enrolled();
    const v = await vendor();
    const original = hasher.idempotencyBody.bind(hasher);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const derive = jest
      .spyOn(hasher, 'idempotencyBody')
      .mockImplementationOnce(async (body, fields, scope, key) => {
        entered();
        await gate;
        return original(body, fields, scope, key);
      });
    const verify = jest.spyOn(hasher, 'verify');
    try {
      const first = open(t, v, WRONG);
      await inside; // le premier essai attend DANS le calcul du dérivé de l'empreinte
      const second = await open(t, v, WRONG);
      expect([second.status, second.body.code]).toEqual([429, 'RATE_LIMITED']);
      expect([derive.mock.calls.length, verify.mock.calls.length]).toEqual([1, 0]);
      release();
      expect((await first).status).toBe(401);
      expect((await vendorRow(v)).failed_attempts).toBe(1);
    } finally {
      release();
      derive.mockRestore();
      verify.mockRestore();
    }
    expect(await attemptLockFree(t)).toBe(true);
  });

  it('le verrou d’essai du terminal est libre après un succès, un refus de PIN et une erreur', async () => {
    const t = await enrolled();
    const v = await vendor();
    expect((await open(t, v, WRONG)).status).toBe(401);
    expect(await attemptLockFree(t)).toBe(true);
    const spy = jest.spyOn(hasher, 'verify').mockRejectedValueOnce(new Error('argon2 en panne'));
    try {
      expect((await open(t, v)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await attemptLockFree(t)).toBe(true);
    expect((await open(t, v)).status).toBe(201);
    expect(await attemptLockFree(t)).toBe(true);
    // Erreur dans le dérivé d'empreinte (avant le contrôleur) : 500, verrou rendu.
    const derive = jest
      .spyOn(hasher, 'idempotencyBody')
      .mockRejectedValueOnce(new Error('argon2 en panne'));
    try {
      expect((await open(t, v)).status).toBe(500);
    } finally {
      derive.mockRestore();
    }
    expect(await attemptLockFree(t)).toBe(true);
    // Clé réutilisée avec un autre PIN (409 avant le contrôleur) : verrou rendu, rien compté de plus.
    const key = randomUUID();
    expect((await open(t, v, WRONG, key)).status).toBe(401);
    const counted = (await vendorRow(v)).failed_attempts;
    expect((await open(t, v, PIN, key)).status).toBe(409);
    expect(await attemptLockFree(t)).toBe(true);
    expect((await vendorRow(v)).failed_attempts).toBe(counted);
    // Essai refusé par le contrôle de forme (422) : essai non compté, verrou rendu.
    expect((await open(t, v, '12')).status).toBe(422);
    expect(await attemptLockFree(t)).toBe(true);
  });

  it('NFR-003 : 20 essais simultanés de PIN faux, même terminal → 401 ou 429, au plus 5 comptés', async () => {
    const t = await enrolled();
    const v = await vendor();
    const results = await Promise.all(Array.from({ length: 20 }, () => open(t, v, WRONG)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    const row = await vendorRow(v);
    expect(row.failed_attempts).toBeLessThanOrEqual(5);
    expect(await failedAudits(v)).toBe(row.failed_attempts);
    expect(await sessionsOf(t.deviceId)).toEqual([]);
  });

  it('NFR-003 : essais simultanés depuis 5 terminaux (4 chacun) → bloqué à 5 exactement, aucune session', async () => {
    const terminals = await Promise.all(Array.from({ length: 5 }, () => enrolled()));
    const v = await vendor();
    const results = await Promise.all(
      terminals.flatMap((t) => Array.from({ length: 4 }, () => open(t, v, WRONG))),
    );
    expect(results.map((r) => r.status).filter((s) => s !== 401 && s !== 429)).toEqual([]);
    const row = await vendorRow(v);
    expect(row.failed_attempts).toBeLessThanOrEqual(5);
    expect(await failedAudits(v)).toBe(row.failed_attempts);
    // Bon PIN ensuite, essais simultanés : jamais plus de 5, aucune session si bloqué.
    await Promise.all(terminals.map((t) => open(t, v)));
    const after = await vendorRow(v);
    expect(after.failed_attempts).toBeLessThanOrEqual(5);
    if (after.locked)
      for (const t of terminals)
        expect((await sessionsOf(t.deviceId)).filter((s) => s.closed_reason === null)).toEqual([]);
  });

  it('renvoi de la même clé : succès → 409 CONFLICT_STATE ; échec → 401 rejoué ; jamais recompté', async () => {
    const t = await enrolled();
    const v = await vendor();
    const failKey = randomUUID();
    expect((await open(t, v, WRONG, failKey)).status).toBe(401);
    const again = await open(t, v, WRONG, failKey);
    expect([again.status, again.headers['idempotency-replayed']]).toEqual([401, 'true']);
    expect((await vendorRow(v)).failed_attempts).toBe(1);
    const key = randomUUID();
    const first = await open(t, v, PIN, key);
    expect(first.status).toBe(201);
    const replay = await open(t, v, PIN, key);
    expect([replay.status, replay.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(replay.text).not.toContain(first.body.vendor_session_id as string);
    expect((await sessionsOf(t.deviceId)).filter((s) => s.closed_reason === null)).toHaveLength(1);
    expect((await vendorRow(v)).failed_attempts).toBe(0);
    const stored = await ownerRows<{ text: string }>(
      `SELECT row_to_json(i)::text AS text FROM api_idempotency i
        WHERE idempotency_key IN ($1, $2)`,
      [key, failKey],
    );
    expect(stored).toHaveLength(2);
    for (const row of stored) expect(row.text).not.toMatch(new RegExp(`${PIN}|${WRONG}|\\$argon2`));
  });

  // ------------------------------------------------------------------ ADR-126 : PIN et empreinte

  const storedHash = async (key: string) =>
    (
      await ownerRows<{ request_hash: string }>(
        `SELECT request_hash FROM api_idempotency WHERE idempotency_key = $1`,
        [key],
      )
    )[0]?.request_hash;
  const clearHash = (path: string, caller: object, body: unknown) =>
    requestHash('POST', path, caller, body, loadConfig({ NODE_ENV: 'test' }).idempotencyHmacKey);
  const adminWithKey = (path: string, key: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`/v1${path}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .set('Idempotency-Key', key)
      .send(body as object);

  it('ADR-126 : l’empreinte (ouverture, nouveau PIN, création de vendeur) n’est pas le HMAC du corps en clair mais celui du corps dérivé', async () => {
    const t = await enrolled();
    const v = await vendor();
    const hmacKey = loadConfig({ NODE_ENV: 'test' }).idempotencyHmacKey;
    const derivedHash = async (
      path: string,
      caller: object,
      body: object,
      scope: string,
      key: string,
    ) =>
      requestHash(
        'POST',
        path,
        caller,
        await hasher.idempotencyBody(body, ['pin'], scope, key),
        hmacKey,
      );
    const person = { person: w.operatorAdminA.userId };
    const cases: Array<{
      name: string;
      key: string;
      path: string;
      caller: object;
      scope: string;
      body: { pin: string };
      send: () => Promise<unknown>;
    }> = [];
    const openKey = randomUUID();
    const openBody = { vendor_id: v, pin: WRONG };
    cases.push({
      name: 'ouverture de session',
      key: openKey,
      path: '/v1/vendor-sessions',
      caller: { device: t.deviceId },
      scope: `device:${t.deviceId}:`,
      body: openBody,
      send: () => open(t, v, WRONG, openKey),
    });
    const pinKey = randomUUID();
    const pinBody = { pin: NEW_PIN };
    cases.push({
      name: 'nouveau PIN',
      key: pinKey,
      path: `/v1/vendors/${v}/pin`,
      caller: person,
      scope: 'bo:',
      body: pinBody,
      send: () => adminWithKey(`/vendors/${v}/pin`, pinKey, pinBody).expect(200),
    });
    const createKey = randomUUID();
    const createBody = { display_name: 'Témoin', pin: '161803' };
    cases.push({
      name: 'création de vendeur',
      key: createKey,
      path: `/v1/merchants/${posA.merchantId}/vendors`,
      caller: person,
      scope: 'bo:',
      body: createBody,
      send: () =>
        adminWithKey(`/merchants/${posA.merchantId}/vendors`, createKey, createBody).expect(201),
    });
    for (const c of cases) {
      await c.send();
      const stored = await storedHash(c.key);
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      // Jamais l'empreinte du corps en clair (ni avec le chemin sans préfixe, au cas où).
      for (const path of [c.path, c.path.replace(/^\/v1/, '')])
        expect([c.name, stored === clearHash(path, c.caller, c.body)]).toEqual([c.name, false]);
      // Témoin d'égalité : c'est exactement le HMAC du corps dérivé (la formule est la bonne).
      expect([c.name, stored]).toEqual([
        c.name,
        await derivedHash(c.path, c.caller, c.body, c.scope, c.key),
      ]);
    }
  });

  it('ADR-126 : même clé, autre PIN → 409 IDEMPOTENCY_KEY_REUSED, jamais un rejeu ; même PIN → rejeu', async () => {
    const t = await enrolled();
    const v = await vendor();
    // Ouverture de session (terminal).
    const key = randomUUID();
    expect((await open(t, v, WRONG, key)).status).toBe(401);
    const other = await open(t, v, PIN, key);
    expect([other.status, other.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(other.headers['idempotency-replayed']).toBeUndefined();
    expect(await sessionsOf(t.deviceId)).toEqual([]);
    const same = await open(t, v, WRONG, key);
    expect([same.status, same.headers['idempotency-replayed']]).toEqual([401, 'true']);
    // Nouveau PIN (back-office).
    const pinKey = randomUUID();
    const done = await adminWithKey(`/vendors/${v}/pin`, pinKey, { pin: NEW_PIN }).expect(200);
    const reused = await adminWithKey(`/vendors/${v}/pin`, pinKey, { pin: '111111' });
    expect([reused.status, reused.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    const replay = await adminWithKey(`/vendors/${v}/pin`, pinKey, { pin: NEW_PIN }).expect(200);
    expect([replay.headers['idempotency-replayed'], replay.body]).toEqual(['true', done.body]);
    // Le PIN refusé n'a rien changé : NEW_PIN ouvre toujours.
    expect((await open(await enrolled(), v, NEW_PIN)).status).toBe(201);
    // Création de vendeur (back-office).
    const createKey = randomUUID();
    const create = (pin: string) =>
      adminWithKey(`/merchants/${posA.merchantId}/vendors`, createKey, {
        display_name: 'Awa',
        pin,
      });
    const created = await create(PIN).expect(201);
    const createdAgain = await create('222222');
    expect([createdAgain.status, createdAgain.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    const createdReplay = await create(PIN).expect(201);
    expect(createdReplay.body.vendor_id).toBe(created.body.vendor_id);
  });

  it('Idempotency-Key non UUID sur l’ouverture et la fermeture → 422, rien enregistré ni compté', async () => {
    const t = await enrolled();
    const v = await vendor();
    const bad = 'pas-un-uuid' as ReturnType<typeof randomUUID>;
    for (const call of [open(t, v, WRONG, bad), close(t, bad)]) {
      const res = await call;
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    expect(await storedHash('pas-un-uuid')).toBeUndefined();
    expect((await vendorRow(v)).failed_attempts).toBe(0);
  });

  it('mode TOPUP_DESK → 422 DEVICE_MODE_NOT_ALLOWED, rien compté', async () => {
    const t = await enrolled({ mode: 'TOPUP_DESK' });
    const v = await vendor();
    const res = await open(t, v, WRONG);
    expect([res.status, res.body.code]).toEqual([422, 'DEVICE_MODE_NOT_ALLOWED']);
    expect((await vendorRow(v)).failed_attempts).toBe(0);
  });

  it('FR-003 : seconde ouverture → la première REPLACED, garde 409 sur l’ancienne', async () => {
    const t = await enrolled();
    const v1 = await vendor();
    const v2 = await vendor();
    const first = await open(t, v1);
    const second = await open(t, v2);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect((await sessionsOf(t.deviceId)).map((s) => [s.vendor_id, s.closed_reason])).toEqual([
      [v1, 'REPLACED'],
      [v2, null],
    ]);
    expect(await guardStatus(t, first.body.vendor_session_id as string)).toBe('CL032');
    expect(await guardStatus(t, second.body.vendor_session_id as string)).toBe(`ok:${v2}`);
  });

  // ------------------------------------------------------------------ T042 : fermetures et garde

  it('FR-005 : désactivation, nouveau PIN, suspension et révocation du terminal → garde 409', async () => {
    const reasons: Array<[string, (t: TestTerminal, v: string) => Promise<unknown>, string]> = [
      [
        'désactivation',
        (_t, v) => asAdmin(`/vendors/${v}/status`, { status: 'DISABLED' }).expect(200),
        'VENDOR_DISABLED',
      ],
      [
        'nouveau PIN',
        (_t, v) => asAdmin(`/vendors/${v}/pin`, { pin: NEW_PIN }).expect(200),
        'PIN_CHANGED',
      ],
      [
        'suspension',
        (t) => asAdmin(`/devices/${t.deviceId}/suspend`, { reason: REASON }).expect(200),
        'DEVICE_SUSPENDED',
      ],
      [
        'révocation',
        (t) => asAdmin(`/devices/${t.deviceId}/revoke`, { reason: REASON }).expect(200),
        'DEVICE_REVOKED',
      ],
    ];
    for (const [name, act, closedReason] of reasons) {
      const t = await enrolled();
      const v = await vendor();
      const session = await open(t, v);
      expect([name, session.status]).toEqual([name, 201]);
      await act(t, v);
      expect([name, (await sessionsOf(t.deviceId))[0]!.closed_reason]).toEqual([
        name,
        closedReason,
      ]);
      expect([name, await guardStatus(t, session.body.vendor_session_id as string)]).toEqual([
        name,
        'CL032',
      ]);
    }
  });

  it('FR-005 : session expirée (12 h, amorçage du propriétaire) → garde 409', async () => {
    const t = await enrolled();
    const v = await vendor();
    const session = await open(t, v);
    // Amorçage signalé : la session est reculée de 13 h (contrainte :
    // expires_at = opened_at + 12 h).
    await withOwner((db) =>
      db.query(
        `UPDATE vendor_session SET opened_at = opened_at - interval '13 hours',
                                   expires_at = expires_at - interval '13 hours'
          WHERE id = $1`,
        [session.body.vendor_session_id as string],
      ),
    );
    expect(await guardStatus(t, session.body.vendor_session_id as string)).toBe('CL032');
  });

  it('garde : autre identifiant, session d’un autre terminal, session close, non UUID', async () => {
    const t = await enrolled();
    const other = await enrolled();
    const v = await vendor();
    const mine = await open(t, v);
    const theirs = await open(other, await vendor());
    expect(await guardStatus(t, randomUUID())).toBe('CL032');
    expect(await guardStatus(t, theirs.body.vendor_session_id as string)).toBe('CL032');
    expect(await guardStatus(other, mine.body.vendor_session_id as string)).toBe('CL032');
    expect(await guardStatus(t, 'pas-un-uuid')).toBe('VALIDATION_FAILED');
    expect((await close(t)).status).toBe(204);
    expect(await guardStatus(t, mine.body.vendor_session_id as string)).toBe('CL032');
  });

  it('fermeture : 204 et LOGOUT audité ; sans session, 204 sans écriture ; renvoi de la clé → 409', async () => {
    const t = await enrolled();
    const v = await vendor();
    const session = await open(t, v);
    const key = randomUUID();
    const res = await close(t, key);
    expect([res.status, res.text]).toEqual([204, '']);
    expect((await sessionsOf(t.deviceId))[0]!.closed_reason).toBe('LOGOUT');
    const audit = await ownerRows<{ action: string }>(
      `SELECT action FROM audit_log WHERE object_id = $1 ORDER BY seq`,
      [session.body.vendor_session_id as string],
    );
    expect(audit.map((a) => a.action)).toEqual(['VENDOR_SESSION_OPENED', 'VENDOR_SESSION_CLOSED']);
    const replay = await close(t, key);
    expect([replay.status, replay.body.code]).toEqual([409, 'CONFLICT_STATE']);
    const before = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE origin = $1`,
      [`device:${t.deviceId}`],
    );
    expect((await close(t)).status).toBe(204);
    const after = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE origin = $1`,
      [`device:${t.deviceId}`],
    );
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  // ------------------------------------------------------------------ T040 : liste du terminal

  it('A22, NFR-007 : liste = vendeurs actifs non bloqués de SON commerçant, id et nom seulement', async () => {
    const t = await enrolled();
    const t2 = await enrolled({ posId: posA2.posId });
    const active = await vendor(posA.merchantId, 'AAA actif');
    const disabled = await vendor(posA.merchantId, 'AAA désactivé');
    await asAdmin(`/vendors/${disabled}/status`, { status: 'DISABLED' }).expect(200);
    const other = await vendor(posA2.merchantId, 'AAA autre commerçant');
    const res = await list(t);
    expect(res.status).toBe(200);
    expect(contractViolations('TerminalVendorList', res.body)).toEqual([]);
    const data = res.body.data as Array<{ vendor_id: string; display_name: string }>;
    const ids = data.map((x) => x.vendor_id);
    expect(ids).toContain(active);
    expect(ids).not.toContain(disabled);
    expect(ids).not.toContain(other);
    for (const item of data)
      expect(Object.keys(item).sort()).toEqual(['display_name', 'vendor_id']);
    const names = data.map((x) => x.display_name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const ids2 = ((await list(t2)).body.data as Array<{ vendor_id: string }>).map(
      (x) => x.vendor_id,
    );
    expect(ids2).toContain(other);
    expect(ids2).not.toContain(active);
  });

  it('terminal sans point de vente : liste vide, et ouverture refusée (401)', async () => {
    const t = await enrolled({ posId: null });
    const v = await vendor();
    expect((await list(t)).body).toEqual({ data: [] });
    expect((await open(t, v)).status).toBe(401);
    expect((await vendorRow(v)).failed_attempts).toBe(0);
  });
});
