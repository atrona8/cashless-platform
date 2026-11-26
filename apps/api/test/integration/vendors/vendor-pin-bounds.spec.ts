// Tests de borne des écarts acceptés de la mission 11a (règle 3 du projet, décision du porteur du
// 19/11/2026) : chaque limite acceptée a un test qui ÉCHOUE si elle s'élargit.
//   - OP-N151 : le PIN transite par l'API mais n'y est ni gardé, ni journalisé, ni écrit en base.
//   - OP-N158 : session ouverte par le processus hors de la transaction de l'API ; renvoi de la clé
//     après une API tombée = 409 sans rouvrir de session, nouvel essai compté.
//   - OP-N159 (a) : 23505 du processus vers 409 CONCURRENT, que l'API traduit en 429.
// Vrai processus `vendor-pin` (base `cashless_pin`), vraie API en HTTPS (trois preuves du terminal) et
// API de back-office pour la création et le changement de PIN. Aucune écriture directe hors amorçage.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { VendorPinDigester } from '../../../src/vendor-pin/vendor-pin.digester';
import { OPEN_SESSION_INDEX } from '../../../src/vendor-pin/vendor-pin-open.service';
import { VendorSessionsService } from '../../../src/vendors/vendor-sessions.service';
import {
  createTestApp,
  startHttpsApp,
  startVendorPinServer,
  testPinDigester,
  type HttpsTestApp,
} from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';
import { seedPos, seedVendor, type SeededPos } from './vendor-fixtures';

jest.setTimeout(180_000);

// PIN reconnaissables (aucun ne figure dans une valeur fixe du code ni d'un test voisin).
const OPEN_PIN = '418263';
const REFUSED_PIN = '905174';
const CREATED_PIN = '630852';
const CHANGED_PIN = '274619';
const CRASH_PIN = '857031';
const ALL_PINS = [OPEN_PIN, REFUSED_PIN, CREATED_PIN, CHANGED_PIN, CRASH_PIN];

describe('Bornes des écarts de la mission 11a (OP-N151, OP-N158, OP-N159)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let backOffice: INestApplication;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let pin: Awaited<ReturnType<typeof startVendorPinServer>>;
  let pinDigester: VendorPinDigester;
  let digester: VendorPinDigester;
  let posA: SeededPos;

  const enrolled = async (): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        posId: posA.posId,
        mode: 'CATALOG_POS',
        ca,
      }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const vendor = async (pinValue: string): Promise<string> => {
    const pinHash = await digester.hash(pinValue);
    return withOwner((db) =>
      seedVendor(db, {
        operatorId: w.ops.a,
        merchantId: posA.merchantId,
        actorId: w.operatorAdminA.userId,
        displayName: `Vendeur ${randomUUID().slice(0, 8)}`,
        pinHash,
      }),
    );
  };
  const open = (t: TestTerminal, vendorId: string, pinValue: string, key = randomUUID()) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/vendor-sessions',
      body: { vendor_id: vendorId, pin: pinValue },
      idempotencyKey: key,
    });
  const admin = (path: string, body: unknown) =>
    request(backOffice.getHttpServer())
      .post(`/v1${path}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body as object);

  const vendorRow = async (id: string) =>
    (
      await ownerRows<{ failed_attempts: number }>(
        'SELECT failed_attempts FROM vendor WHERE id = $1',
        [id],
      )
    )[0]!;
  const sessionsOf = (deviceId: string) =>
    ownerRows<{ id: string; closed_reason: string | null }>(
      'SELECT id, closed_reason FROM vendor_session WHERE device_id = $1 ORDER BY opened_at, id',
      [deviceId],
    );
  const checksOf = async (vendorId: string): Promise<number> =>
    Number(
      (
        await ownerRows<{ n: string }>(
          'SELECT count(*) AS n FROM vendor_pin_check WHERE vendor_id = $1',
          [vendorId],
        )
      )[0]!.n,
    );

  /** Fait échouer la 2e transaction du processus (celle de `open_vendor_session`) par `error`. */
  const failOpenSession = (error: Error) => {
    const tx = pin.app.get(TenantTx, { strict: false });
    const original = tx.run.bind(tx);
    let n = 0;
    return jest.spyOn(tx, 'run').mockImplementation(((...args: Parameters<typeof tx.run>) => {
      n += 1;
      return n === 2 ? Promise.reject(error) : original(...args);
    }) as typeof tx.run);
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    posA = await withOwner((db) =>
      seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA, name: 'Commerçant bornes' }),
    );
    pin = await startVendorPinServer();
    pinDigester = pin.app.get(VendorPinDigester, { strict: false });
    digester = testPinDigester();
    api = await startHttpsApp(undefined, { identity: w.idp, vendorPinUrl: pin.url });
    backOffice = await createTestApp({ identity: w.idp, vendorPin: true });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
  });

  afterAll(async () => {
    await backOffice?.close();
    await api?.close();
    await pin?.close();
  });

  // ------------------------------------------------------------------ OP-N151

  describe('OP-N151 : l’API ne retient pas le PIN', () => {
    /** Colonnes texte, json, jsonb, tableau et octets de toutes les tables des schémas applicatifs. */
    const textColumns = () =>
      ownerRows<{ schema: string; tbl: string; col: string; type: string }>(
        `SELECT c.table_schema AS schema, c.table_name AS tbl, c.column_name AS col, c.data_type AS type
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE t.table_type = 'BASE TABLE'
            AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb',
                                'ARRAY', 'bytea', 'USER-DEFINED')`,
      );
    const asText = (col: string, type: string): string =>
      type === 'bytea' ? `encode("${col}", 'escape')` : `"${col}"::text`;

    /**
     * Occurrences de chacun des PIN dans toute la base : `schema.table.colonne` → PIN.
     * Une valeur faite seulement de 32 chiffres hexadécimaux ou plus (empreinte ou HMAC, ex.
     * `api_idempotency.request_hash`) est écartée : elle contient une suite de 6 chiffres par hasard
     * (faux positif vu en CI le 26/11/2026), jamais un PIN en clair.
     */
    async function findInDatabase(pins: string[]): Promise<string[]> {
      const found: string[] = [];
      for (const { schema, tbl, col, type } of await textColumns()) {
        const expr = asText(col, type);
        const hits = await ownerRows<{ n: string }>(
          `SELECT count(*) AS n FROM "${schema}"."${tbl}"
            WHERE (${pins.map((_, i) => `${expr} LIKE $${i + 1}`).join(' OR ')})
              AND ${expr} !~ '^[0-9a-f]{32,}$'`,
          pins.map((p) => `%${p}%`),
        );
        if (Number(hits[0]!.n) > 0) found.push(`${schema}.${tbl}.${col}`);
      }
      return found;
    }

    /** Capture tout ce que l'API et le processus écrivent sur la sortie et l'erreur standard. */
    function captureLogs(): { text: () => string; restore: () => void } {
      const chunks: string[] = [];
      const grab = (chunk: unknown): void => {
        chunks.push(
          typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString(),
        );
      };
      const stdout = process.stdout.write.bind(process.stdout);
      const stderr = process.stderr.write.bind(process.stderr);
      const spies = [
        jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
          grab(chunk);
          return true;
        }) as typeof process.stdout.write),
        jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
          grab(chunk);
          return true;
        }) as typeof process.stderr.write),
        ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
          jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            grab(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
          }),
        ),
      ];
      return {
        text: () => chunks.join('\n'),
        restore: () => {
          for (const spy of spies) spy.mockRestore();
          void stdout;
          void stderr;
        },
      };
    }

    it('ouverture réussie, refusée, plantée, création et changement de PIN : le PIN n’est ni en base ni dans un journal', async () => {
      const logs = captureLogs();
      let displayName = '';
      let openedDevice = '';
      try {
        const t = await enrolled();
        openedDevice = t.deviceId;
        const good = await vendor(OPEN_PIN);
        const goodRow = await ownerRows<{ display_name: string }>(
          'SELECT display_name FROM vendor WHERE id = $1',
          [good],
        );
        displayName = goodRow[0]!.display_name;
        // Réussite, refus, et ouverture plantée dans le processus (500 journalisé côté API).
        expect((await open(t, good, OPEN_PIN)).status).toBe(201);
        expect((await open(t, good, REFUSED_PIN)).status).toBe(401);
        const spy = jest.spyOn(pinDigester, 'verify').mockRejectedValueOnce(new Error('panne'));
        try {
          expect((await open(t, good, CRASH_PIN)).status).toBe(500);
        } finally {
          spy.mockRestore();
        }
        // Création de vendeur (corps portant le PIN, empreinte du processus) puis changement de PIN.
        const created = await admin(`/merchants/${posA.merchantId}/vendors`, {
          display_name: 'Vendeur créé',
          pin: CREATED_PIN,
        });
        expect(created.status).toBe(201);
        const changed = await admin(`/vendors/${created.body.vendor_id as string}/pin`, {
          pin: CHANGED_PIN,
        });
        expect(changed.status).toBe(200);
        // Corps de la création et du changement : jamais le PIN rendu au client.
        expect(created.text + changed.text).not.toMatch(new RegExp(ALL_PINS.join('|')));
      } finally {
        logs.restore();
      }
      const captured = logs.text();
      // Témoin : la capture voit bien les journaux de l'API (ligne de requête et erreur 5xx).
      expect(captured).toContain('/v1/vendor-sessions');
      expect(captured).toContain('INTERNAL_ERROR');
      expect(captured).toContain('/v1/internal/vendor-pin/open');
      for (const p of ALL_PINS) expect([p, captured.includes(p)]).toEqual([p, false]);

      // Témoin : la recherche en base atteint bien les données (nom du vendeur, motif du PIN absent).
      expect(await findInDatabase([displayName])).toContain('public.vendor.display_name');
      expect((await sessionsOf(openedDevice)).length).toBeGreaterThan(0);
      // Aucune table texte, json ou jsonb ne contient un PIN (audit_log, api_idempotency, …).
      expect(await findInDatabase(ALL_PINS)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ OP-N158

  describe('OP-N158 : renvoi après une API tombée avant la réponse', () => {
    it('la session est ouverte par le processus ; le renvoi de la clé rend 409 SANS rouvrir de session ; un nouvel essai est compté', async () => {
      const t = await enrolled();
      const v = await vendor(OPEN_PIN);
      const service = api.app.get(VendorSessionsService, { strict: false });
      const original = service.open.bind(service);
      const verify = jest.spyOn(pinDigester, 'verify');
      // L'API « tombe » APRÈS l'appel du processus (session ouverte et clé enregistrée) : la réponse
      // de succès n'atteint jamais le terminal.
      const crash = jest.spyOn(service, 'open').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('API tombée avant la réponse');
      });
      const key = randomUUID();
      try {
        const first = await open(t, v, OPEN_PIN, key);
        expect(first.status).not.toBe(201);
        expect(first.text).not.toMatch(/vendor_session_id/);
        const [opened] = await sessionsOf(t.deviceId);
        expect(await sessionsOf(t.deviceId)).toHaveLength(1);
        expect(opened!.closed_reason).toBeNull();
        expect(verify).toHaveBeenCalledTimes(1);
        expect(await checksOf(v)).toBe(1);

        // Renvoi de la MÊME clé : 409, rejeu de l'enregistrement, aucun appel au processus.
        const replay = await open(t, v, OPEN_PIN, key);
        expect([replay.status, replay.body.code, replay.headers['idempotency-replayed']]).toEqual([
          409,
          'CONFLICT_STATE',
          'true',
        ]);
        expect(replay.text).not.toContain(opened!.id);
        expect(verify).toHaveBeenCalledTimes(1);
        // Le renvoi n'a PAS rouvert de session : toujours la même, ouverte, seule.
        expect(await sessionsOf(t.deviceId)).toEqual([{ id: opened!.id, closed_reason: null }]);
        expect(await checksOf(v)).toBe(1);

        // Nouvel essai (autre clé) : compté, la session précédente est remplacée.
        const retry = await open(t, v, OPEN_PIN);
        expect(retry.status).toBe(201);
        expect(verify).toHaveBeenCalledTimes(2);
        expect(await checksOf(v)).toBe(2);
        expect(await sessionsOf(t.deviceId)).toEqual([
          { id: opened!.id, closed_reason: 'REPLACED' },
          { id: retry.body.vendor_session_id, closed_reason: null },
        ]);
      } finally {
        crash.mockRestore();
        verify.mockRestore();
      }
    });
  });

  // ------------------------------------------------------------------ OP-N159 (a)

  describe('OP-N159 (a) : 23505 du processus, traduit en 429 par l’API', () => {
    it('23505 sur l’index « une session par terminal » : 429 RATE_LIMITED + Retry-After, aucune session, clé rejouable', async () => {
      const t = await enrolled();
      const v = await vendor(OPEN_PIN);
      const spy = failOpenSession(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: OPEN_SESSION_INDEX,
        }),
      );
      const key = randomUUID();
      try {
        const res = await open(t, v, OPEN_PIN, key);
        expect([res.status, res.body.code, res.headers['retry-after']]).toEqual([
          429,
          'RATE_LIMITED',
          '1',
        ]);
        expect(res.text).not.toMatch(new RegExp(`${OPEN_PIN}|23505|CONCURRENT|duplicate`));
      } finally {
        spy.mockRestore();
      }
      expect(await sessionsOf(t.deviceId)).toEqual([]);
      // Essai compté (échec sûr) ; le 429 n'est pas enregistré : la même clé est un nouvel essai.
      expect((await vendorRow(v)).failed_attempts).toBe(1);
      const retry = await open(t, v, OPEN_PIN, key);
      expect([retry.status, retry.headers['idempotency-replayed']]).toEqual([201, undefined]);
    });
  });
});
