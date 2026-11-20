// Processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006, C-008, NFR-004 ; OP-N76, ADR-121).
// Vrai module compilé, vrai rôle de base `cashless_pin` (DATABASE_URL_PIN), requêtes HTTP signées par
// `signCall` sur le corps brut. Le client de l'API (WP07) n'existe pas encore : ces tests en tiennent lieu.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { TenantTx } from '../../../src/db/tenant-tx';
import { OPEN_SESSION_INDEX } from '../../../src/vendor-pin/vendor-pin-open.service';
import { signCall } from '../../../src/vendor-pin/vendor-pin-call-signature';
import { PIN_URL, withOwner } from '../../support/db';
import {
  HASH_PATH,
  PIN,
  WRONG,
  auditCount,
  call,
  createPinWorld,
  sessionsOf,
  vendorAudit,
  vendorRow,
  type PinWorld,
} from './vendor-pin-fixtures';

jest.setTimeout(120_000);

describe('Processus vendor-pin (WP06)', () => {
  let world: PinWorld;
  beforeAll(async () => {
    world = await createPinWorld();
  });
  afterAll(async () => {
    await world?.close();
  });

  // ----- T025.1 : authentification de l'appel -----
  describe('signature de l’appel', () => {
    it('refus uniforme (401), base intacte : absente, fausse, autre corps, autre chemin, ±31 s, autre clé', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const body = { vendorId: v, deviceId: t.deviceId, operatorId: world.w.ops.a, pin: PIN };
      const other = { ...body, pin: WRONG };
      const now = Date.now();
      const auditBefore = await auditCount();
      const cases: Array<[string, Parameters<typeof call>[2]]> = [
        ['signature absente', { sig: null }],
        ['horodatage absent', { tsHeader: null }],
        ['signature fausse', { sig: 'a'.repeat(64) }],
        ['signature de longueur différente', { sig: 'ab' }],
        ['signature non hexadécimale', { sig: 'z'.repeat(64) }],
        ['signature d’un autre corps', { signedBody: JSON.stringify(other) }],
        [
          'signature d’un autre chemin',
          { sig: signCall(world.key, now, 'POST', HASH_PATH, JSON.stringify(body)), ts: now },
        ],
        ['horodatage à +31 s', { ts: now + 31_000 }],
        ['horodatage à -31 s', { ts: now - 31_000 }],
        ['horodatage non numérique', { tsHeader: 'hier' }],
        [
          'clé de même préfixe',
          { key: Buffer.concat([world.key.subarray(0, 31), Buffer.from([0])]) },
        ],
        ['autre clé', { key: Buffer.alloc(32, 7) }],
      ];
      const bodies = new Set<string>();
      for (const [name, options] of cases) {
        const res = await call(world, body, options);
        expect([name, res.status]).toEqual([name, 401]);
        const { request_id: _r, instance: _i, ...rest } = res.body as Record<string, unknown>;
        bodies.add(JSON.stringify(rest));
        expect(res.text).not.toMatch(new RegExp(`${PIN}|\\$argon2`));
      }
      expect(bodies.size).toBe(1);
      expect(await vendorRow(v)).toMatchObject({ failed_attempts: 0 });
      expect(await auditCount()).toBe(auditBefore);
      expect(await sessionsOf(t.deviceId)).toEqual([]);
    });

    it('limite de l’horodatage : ±29 s acceptés', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const body = { vendorId: v, deviceId: t.deviceId, operatorId: world.w.ops.a, pin: PIN };
      for (const delta of [29_000, -29_000]) {
        const res = await call(world, body, { ts: Date.now() + delta });
        expect([delta, res.status]).toEqual([delta, 200]);
      }
    });

    // OP-N159 (b) : le processus ne monte que ses deux routes internes ; toute autre route est INCONNUE
    // (`404 NOT_FOUND`, filtre d'erreurs, `problem.filter.ts`) et jamais un `401` : un `401` voudrait dire
    // qu'une garde (ou une route) existe là où le processus ne doit rien servir. Code exact exigé.
    it('route non marquée refusée : 404 NOT_FOUND exact, jamais 401, même signée', async () => {
      for (const path of ['/v1/vendors', '/v1/internal/vendor-pin/inconnue', '/v1/internal/x']) {
        const res = await call(world, {}, { path });
        expect([path, res.status, res.body.code]).toEqual([path, 404, 'NOT_FOUND']);
      }
      const unsigned = await call(world, {}, { path: '/v1/vendors', sig: null });
      expect([unsigned.status, unsigned.body.code]).toEqual([404, 'NOT_FOUND']);
    });
  });

  // ----- T025.2 : ouverture -----
  describe('open', () => {
    it('PIN juste : session, un audit VENDOR_SESSION_OPENED, compteur à 0', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const requestBody = {
        vendorId: v,
        deviceId: t.deviceId,
        operatorId: world.w.ops.a,
        pin: WRONG,
      };
      expect((await call(world, requestBody)).status).toBe(403);
      expect((await vendorRow(v)).failed_attempts).toBe(1);
      const res = await call(world, { ...requestBody, pin: PIN });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'expires_at',
        'vendor_display_name',
        'vendor_id',
        'vendor_session_id',
      ]);
      expect(res.body.vendor_id).toBe(v);
      expect(res.text).not.toMatch(new RegExp(`${PIN}|\\$argon2`));
      expect(await sessionsOf(t.deviceId)).toEqual([
        { id: res.body.vendor_session_id, vendor_id: v, closed_reason: null },
      ]);
      expect((await vendorRow(v)).failed_attempts).toBe(0);
      const rows = await withOwner(
        async (db) =>
          (
            await db.query(
              `SELECT action, origin, actor_id, after FROM audit_log WHERE object_id = $1`,
              [res.body.vendor_session_id],
            )
          ).rows,
      );
      expect(rows).toEqual([
        {
          action: 'VENDOR_SESSION_OPENED',
          origin: `device:${t.deviceId}`,
          actor_id: null,
          after: { vendor_id: v, device_id: t.deviceId },
        },
      ]);
    });

    it('NFR-004 : PIN faux, inconnu, autre commerçant, désactivé, bloqué : même refus, mêmes comptes', async () => {
      const t = await world.terminal();
      const op = world.w.ops.a;
      const good = await world.vendor();
      const foreign = await world.vendor(world.posA2.merchantId);
      const disabled = await world.vendor();
      const locked = await world.vendor();
      await withOwner(async (db) => {
        await db.query(`UPDATE vendor SET status = 'DISABLED' WHERE id = $1`, [disabled]);
        await db.query(`UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = $1`, [
          locked,
        ]);
      });
      const send = (vendorId: string, pin: string) =>
        call(world, { vendorId, deviceId: t.deviceId, operatorId: op, pin });
      const bodies = new Set<string>();
      for (const [name, vendorId, pin] of [
        ['PIN faux', good, WRONG],
        ['inconnu', randomUUID(), PIN],
        ['autre commerçant', foreign, PIN],
        ['désactivé', disabled, PIN],
        ['bloqué', locked, PIN],
      ] as const) {
        const res = await send(vendorId, pin);
        expect([name, res.status, res.body]).toEqual([name, 403, { outcome: 'PIN_REFUSED' }]);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      expect((await vendorRow(good)).failed_attempts).toBe(1);
      expect(
        (await vendorAudit(good)).filter((a) => a.action === 'VENDOR_PIN_FAILED'),
      ).toHaveLength(1);
      expect((await vendorRow(foreign)).failed_attempts).toBe(0);
      expect(await vendorAudit(foreign)).toEqual([]);
      expect((await vendorRow(disabled)).failed_attempts).toBe(0);
      expect((await vendorRow(locked)).failed_attempts).toBe(5);
      expect(await sessionsOf(t.deviceId)).toEqual([]);
    });

    it('5e essai : FAILED x5 et LOCKED x1 ; bon PIN ensuite refusé ; compter d’abord', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const send = (pin: string) =>
        call(world, { vendorId: v, deviceId: t.deviceId, operatorId: world.w.ops.a, pin });
      for (let i = 0; i < 4; i += 1) expect((await send(WRONG)).status).toBe(403);
      // Le 5e essai porte le bon PIN : compté d'abord, donc bloqué avant la vérification.
      expect((await send(PIN)).status).toBe(403);
      expect(await vendorRow(v)).toEqual({ failed_attempts: 5, locked: true, status: 'ACTIVE' });
      const audit = await vendorAudit(v);
      expect(audit.filter((a) => a.action === 'VENDOR_PIN_FAILED')).toHaveLength(5);
      expect(audit.filter((a) => a.action === 'VENDOR_LOCKED')).toHaveLength(1);
      expect(
        audit
          .filter((a) => a.action !== 'VENDOR_CREATED')
          .every((a) => a.origin === `device:${t.deviceId}`),
      ).toBe(true);
      expect((await send(PIN)).status).toBe(403);
      expect(await sessionsOf(t.deviceId)).toEqual([]);
    });

    it('charge mal formée : 422 sans écho, aucun essai compté', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const base = { vendorId: v, deviceId: t.deviceId, operatorId: world.w.ops.a };
      for (const body of [
        { ...base, pin: '12345' },
        { ...base, pin: 314159 },
        { ...base, pin: PIN, extra: 1 },
        { ...base, vendorId: 'pas-un-uuid', pin: PIN },
      ]) {
        const res = await call(world, body);
        expect(res.status).toBe(422);
        expect(res.text).not.toContain(PIN);
        expect(res.text).not.toContain('12345');
      }
      expect((await vendorRow(v)).failed_attempts).toBe(0);
    });
  });

  // ----- T024 : hachage -----
  // ----- OP-N159 (a) : deux ouvertures simultanées du terminal, 23505 sur l'index « une session par terminal » -----
  describe('cas concurrent (OP-N159 a)', () => {
    /** Fait échouer la 2e transaction de l'ouverture (celle de `open_vendor_session`) par `error`. */
    const failOpenSession = (error: Error) => {
      const tx = world.app.get(TenantTx, { strict: false });
      const original = tx.run.bind(tx);
      let n = 0;
      return jest.spyOn(tx, 'run').mockImplementation(((...args: Parameters<typeof tx.run>) => {
        n += 1;
        return n === 2 ? Promise.reject(error) : original(...args);
      }) as typeof tx.run);
    };
    const pgError = (constraint: string) =>
      Object.assign(new Error('duplicate key'), { code: '23505', constraint });

    it('23505 sur vendor_session_open_per_device : 409 {outcome:CONCURRENT}, aucune session, essai compté', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const spy = failOpenSession(pgError(OPEN_SESSION_INDEX));
      try {
        const res = await call(world, {
          vendorId: v,
          deviceId: t.deviceId,
          operatorId: world.w.ops.a,
          pin: PIN,
        });
        expect([res.status, res.body]).toEqual([409, { outcome: 'CONCURRENT' }]);
        expect(res.text).not.toMatch(new RegExp(`${PIN}|23505|duplicate`));
      } finally {
        spy.mockRestore();
      }
      expect(await sessionsOf(t.deviceId)).toEqual([]);
      // Essai compté d'abord (échec sûr) et audité comme tout essai sans session.
      expect((await vendorRow(v)).failed_attempts).toBe(1);
    });

    it('un 23505 d\u2019un AUTRE index n\u2019est jamais pris pour un cas concurrent (5xx sans détail)', async () => {
      const t = await world.terminal();
      const v = await world.vendor();
      const spy = failOpenSession(pgError('une_autre_contrainte'));
      try {
        const res = await call(world, {
          vendorId: v,
          deviceId: t.deviceId,
          operatorId: world.w.ops.a,
          pin: PIN,
        });
        expect(res.status).toBe(500);
        expect(res.body).not.toHaveProperty('outcome');
        expect(res.text).not.toMatch(/CONCURRENT|une_autre_contrainte/);
      } finally {
        spy.mockRestore();
      }
      expect(await sessionsOf(t.deviceId)).toEqual([]);
    });
  });

  describe('hash', () => {
    it('rend une empreinte que open vérifie ; PIN de 5 chiffres : 422 sans écho', async () => {
      const t = await world.terminal();
      const res = await call(world, { pin: PIN }, { path: HASH_PATH });
      expect(res.status).toBe(200);
      expect(res.body.pin_hash).toMatch(/^\$argon2id\$v=19\$/);
      const v = await world.vendor();
      await withOwner((db) =>
        db.query('UPDATE vendor SET pin_hash = $1 WHERE id = $2', [res.body.pin_hash, v]),
      );
      const opened = await call(world, {
        vendorId: v,
        deviceId: t.deviceId,
        operatorId: world.w.ops.a,
        pin: PIN,
      });
      expect(opened.status).toBe(200);
      const bad = await call(world, { pin: '12345' }, { path: HASH_PATH });
      expect(bad.status).toBe(422);
      expect(bad.text).not.toContain('12345');
      expect((await call(world, { pin: PIN }, { path: HASH_PATH, sig: null })).status).toBe(401);
    });
  });

  // ----- T025.3 : droits du rôle cashless_pin -----
  describe('rôle cashless_pin', () => {
    let db: Client;
    beforeAll(async () => {
      db = new Client({ connectionString: PIN_URL });
      await db.connect();
    });
    afterAll(async () => {
      await db?.end();
    });

    it('seul EXECUTE de begin_vendor_pin_check et open_vendor_session', async () => {
      const { rows } = await db.query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND has_function_privilege(current_user, p.oid, 'EXECUTE')
            AND p.proname IN ('begin_vendor_pin_check', 'open_vendor_session', 'create_vendor',
                              'set_vendor_pin', 'close_vendor_session', 'set_vendor_status')`,
      );
      expect(rows.map((r) => r.proname).sort()).toEqual([
        'begin_vendor_pin_check',
        'open_vendor_session',
      ]);
    });

    it.each([
      ['SELECT sur vendor', 'SELECT pin_hash FROM vendor LIMIT 1'],
      ['SELECT sur vendor_pin_check', 'SELECT * FROM vendor_pin_check LIMIT 1'],
      ['SELECT sur vendor_session', 'SELECT * FROM vendor_session LIMIT 1'],
      ['INSERT sur sale_attribution', 'INSERT INTO sale_attribution DEFAULT VALUES'],
    ])('%s : refusé (42501)', async (_name, sql) => {
      await expect(db.query(sql)).rejects.toMatchObject({ code: '42501' });
    });
  });
});
