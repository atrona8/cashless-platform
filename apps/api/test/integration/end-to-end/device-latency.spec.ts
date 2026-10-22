// Latence des terminaux (mission 5a, lot WP18, T084 ; NFR-009) et garde de production, un test par
// faux (NFR-001).
//
// NFR-009, mesuré côté serveur sur la même route (`POST /v1/taps`, HTTPS réel) : le temps de
// `identify` du port d'identité, enveloppé pour la mesure, avec l'identité RÉELLE (trois preuves)
// puis avec le faux de la mission 4 (en-têtes de test) sur un second serveur HTTPS de même
// configuration ; surcoût des trois preuves = p95(réel) − p95(faux) ≤ 20 ms. Enrôlement par la
// route (vérificateur d'attestation réel) p95 ≤ 1 s ; configuration et battement de cœur
// p95 ≤ 200 ms. Mesures indicatives en local, écartées de la passe parallèle (`SKIP_LATENCY=1`) et
// lancées seules ensuite par la CI (ledger-tests.yml).
//
// NFR-001 : le graphe réel de l'API publique, compilé en configuration de production, refuse de
// démarrer (`assertProcessIsSafe`) pour CHAQUE faux branché seul (identité du terminal, autorité
// des terminaux, signataire des jetons, vérificateur d'attestation, identité du festivalier), et
// démarre sans faux. Le terminal de test et son autorité ne sont atteignables ni par un réglage de
// production (`DEVICE_CA_FAKE_KEY_FILE`, `DEVICE_IDENTITY_FAKE` refusés) ni depuis le code servi
// (aucun fichier de `src/` n'importe `test/`). Complète les tests unitaires de la garde
// (production-guard.spec.ts, processes.spec.ts, device-ca.spec.ts, device-token.spec.ts,
// attestation/android.spec.ts, attestation/ios.spec.ts) et celui du vérificateur d'attestation
// d'enrollment.spec.ts.
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import { FakeAttestation } from '../../../src/attestation/fake-attestation';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../../src/config/config';
import { CUSTOMER_IDENTITY } from '../../../src/customer-identity/customer-identity.port';
import { FakeCustomerIdentity } from '../../../src/customer-identity/fake-customer-identity';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import {
  DEVICE_IDENTITY,
  type DeviceIdentityPort,
} from '../../../src/device-identity/device-identity.port';
import {
  FakeDeviceIdentity,
  TEST_DEVICE_HEADER,
  TEST_DEVICE_OPERATOR_HEADER,
} from '../../../src/device-identity/fake-device-identity';
import { RealDeviceIdentity } from '../../../src/device-identity/real-device-identity';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { FakeTokenSigner } from '../../../src/device-tokens/fake-token-signer';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { PublicProcessModule } from '../../../src/processes/public.module';
import { ATTESTATION_VERIFIER, DEVICE_CA, TOKEN_SIGNER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  enrollFrom,
  issueCode,
  realAttestation,
  testAddress,
  type RealAttestation,
} from '../../support/device-e2e';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import { DEVICE_PRODUCTION } from '../../support/tls';
import { TestTerminal, type ProofOptions } from '../../support/test-terminal';

jest.setTimeout(300_000);

const CALLS = 200;
const ENROLLMENTS = 40;
const PROOFS_OVERHEAD_P95_MS = 20;
const ENROLLMENT_P95_MS = 1000;
const CONFIG_P95_MS = 200;
/** `SKIP_LATENCY=1` (passe parallèle) : mesures écartées, lancées seules ensuite. */
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
const ms = (started: bigint) => Number(process.hrtime.bigint() - started) / 1e6;

/** Enveloppe `identify` du port d'identité de l'application : chaque durée est relevée. */
function timeIdentify(app: HttpsTestApp): number[] {
  const port = app.app.get<DeviceIdentityPort>(DEVICE_IDENTITY, { strict: false });
  const original = port.identify.bind(port);
  const durations: number[] = [];
  port.identify = async (req: Request) => {
    const started = process.hrtime.bigint();
    try {
      return await original(req);
    } finally {
      durations.push(ms(started));
    }
  };
  return durations;
}

describe('NFR-009 : latence des terminaux (indicatif, local)', () => {
  let w: MediaWorld;
  let real: HttpsTestApp;
  let fake: HttpsTestApp;
  let attestation: RealAttestation;
  let ca: DeviceCaPort;
  let terminal: TestTerminal;
  let media: SeededMedia;
  let counter = 0;
  const next = () => (counter += 1);

  const tap = (app: HttpsTestApp, proofs: ProofOptions = {}) =>
    terminal.request(
      app.baseUrl,
      app.tls.serverCaPem,
      { method: 'POST', path: '/taps', body: tapBody(media, next()) },
      proofs,
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    attestation = await realAttestation();
    real = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: ATTESTATION_VERIFIER, useValue: attestation.verifier }],
      trustProxyHops: 1,
    });
    // Même serveur HTTPS, faux de la mission 4 à la place de l'identité réelle (référence).
    fake = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: DEVICE_IDENTITY, useValue: new FakeDeviceIdentity() }],
    });
    ca = await FakeDeviceCa.fromFiles({
      certFile: real.tls.deviceCaCertFile,
      keyFile: real.tls.deviceCaFakeKeyFile,
    });
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
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [media.id],
      });
    });
    terminal = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId: w.ops.a, eventId: w.ids.eventA, ca }),
    );
    await terminal.issueToken(real.app.get(DeviceTokenService, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    await real?.close();
    await fake?.close();
    attestation?.dispose();
  });

  it('les deux serveurs portent l’identité attendue (réelle, faux de référence)', () => {
    expect(real.app.get(DEVICE_IDENTITY, { strict: false })).toBeInstanceOf(RealDeviceIdentity);
    expect(fake.app.get(DEVICE_IDENTITY, { strict: false })).toBeInstanceOf(FakeDeviceIdentity);
  });

  latency(
    `surcoût des trois preuves côté serveur : p95 ≤ ${PROOFS_OVERHEAD_P95_MS} ms (${CALLS} appels)`,
    async () => {
      const realTimes = timeIdentify(real);
      const fakeTimes = timeIdentify(fake);
      const fakeHeaders = {
        headers: {
          [TEST_DEVICE_HEADER]: terminal.deviceId,
          [TEST_DEVICE_OPERATOR_HEADER]: w.ops.a,
        },
      };
      // Mise en route, puis appels alternés (même charge de la base pour les deux).
      expect((await tap(real)).status).toBe(200);
      expect((await tap(fake, fakeHeaders)).status).toBe(200);
      realTimes.length = 0;
      fakeTimes.length = 0;
      for (let i = 0; i < CALLS; i += 1) {
        expect((await tap(real)).status).toBe(200);
        expect((await tap(fake, fakeHeaders)).status).toBe(200);
      }
      expect([realTimes.length, fakeTimes.length]).toEqual([CALLS, CALLS]);
      const overhead = p95(realTimes) - p95(fakeTimes);
      process.stdout.write(
        `NFR-009 : identify p95 réel ${p95(realTimes).toFixed(2)} ms, faux ` +
          `${p95(fakeTimes).toFixed(2)} ms, surcoût ${overhead.toFixed(2)} ms\n`,
      );
      expect(overhead).toBeLessThanOrEqual(PROOFS_OVERHEAD_P95_MS);
    },
  );

  latency(
    `enrôlement par la route : p95 ≤ ${ENROLLMENT_P95_MS} ms (${ENROLLMENTS} enrôlements)`,
    async () => {
      const server = { baseUrl: real.baseUrl, serverCaPem: real.tls.serverCaPem };
      const address = testAddress();
      const durations: number[] = [];
      for (let i = 0; i < ENROLLMENTS; i += 1) {
        const { code } = await issueCode(server, w.operatorAdminA.token, {
          event_id: w.ids.eventA,
        });
        const t = new TestTerminal(i % 4 === 3 ? 'IOS' : 'ANDROID');
        // Corps (clés, attestations de test, CSR) préparé avant la mesure : seul le serveur compte.
        const body = await t.enrollmentBody(code, {
          androidPki: attestation.androidPki,
          iosPki: attestation.iosPki,
        });
        const started = process.hrtime.bigint();
        const res = await enrollFrom(server, t, code, address, { prebuilt: body });
        durations.push(ms(started));
        expect(res.status).toBe(201);
      }
      process.stdout.write(`NFR-009 : enrôlement p95 ${p95(durations).toFixed(1)} ms\n`);
      expect(p95(durations)).toBeLessThanOrEqual(ENROLLMENT_P95_MS);
    },
  );

  latency(
    `configuration et battement de cœur : p95 ≤ ${CONFIG_P95_MS} ms (${CALLS} appels)`,
    async () => {
      const results: Record<string, number[]> = { config: [], heartbeat: [] };
      const call = (kind: 'config' | 'heartbeat') =>
        kind === 'config'
          ? terminal.request(real.baseUrl, real.tls.serverCaPem, {
              method: 'GET',
              path: '/device/config',
            })
          : terminal.request(real.baseUrl, real.tls.serverCaPem, {
              method: 'POST',
              path: '/device/heartbeat',
              body: {
                device_time: new Date().toISOString(),
                snapshot_version: null,
                last_local_seq: 0,
                pending_operations: 0,
                pending_exposure: 0,
                battery_percent: 90,
              },
            });
      for (const kind of ['config', 'heartbeat'] as const) {
        expect((await call(kind)).status).toBe(200);
        for (let i = 0; i < CALLS; i += 1) {
          const started = process.hrtime.bigint();
          const res = await call(kind);
          results[kind]!.push(ms(started));
          expect(res.status).toBe(200);
        }
      }
      process.stdout.write(
        `NFR-009 : configuration p95 ${p95(results.config!).toFixed(1)} ms, battement ` +
          `${p95(results.heartbeat!).toFixed(1)} ms\n`,
      );
      expect(p95(results.config!)).toBeLessThanOrEqual(CONFIG_P95_MS);
      expect(p95(results.heartbeat!)).toBeLessThanOrEqual(CONFIG_P95_MS);
    },
  );
});

describe('NFR-001 : aucun faux en production, un test par faux sur le graphe réel', () => {
  /** Ports sans adaptateur réel dans la mission : fournisseurs « réels » neutres (non appelés). */
  const realLike = {
    [DEVICE_CA]: {
      issue: () => Promise.reject(new Error('non appelé')),
      caCertificatesPem: () => [],
    },
    [TOKEN_SIGNER]: {
      kid: 'k',
      sign: () => Promise.reject(new Error('non appelé')),
      publicJwk: () => ({}),
    },
    [CUSTOMER_IDENTITY]: { identify: () => Promise.reject(new Error('non appelé')) },
    [ATTESTATION_VERIFIER]: { verify: () => Promise.reject(new Error('non appelé')) },
  };
  const saved = process.env.DEVICE_IDENTITY_FAKE;
  beforeEach(() => delete process.env.DEVICE_IDENTITY_FAKE);
  afterAll(() => {
    if (saved === undefined) delete process.env.DEVICE_IDENTITY_FAKE;
    else process.env.DEVICE_IDENTITY_FAKE = saved;
  });

  /** API publique en production : chaque port réel-neutre, sauf `fake` posé sur son jeton. */
  const compile = (fake?: { token: symbol; provider: object }) => {
    const config: AppConfig = { ...loadConfig(), production: true };
    const builder = Test.createTestingModule({ imports: [PublicProcessModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config);
    for (const token of [DEVICE_CA, TOKEN_SIGNER, CUSTOMER_IDENTITY, ATTESTATION_VERIFIER])
      builder.overrideProvider(token).useValue(realLike[token as keyof typeof realLike]);
    if (fake) builder.overrideProvider(fake.token).useValue(fake.provider);
    return builder.compile();
  };

  it('sans faux : la garde de démarrage laisse passer (identité réelle du terminal)', async () => {
    const app = await compile();
    try {
      expect(app.get(DEVICE_IDENTITY, { strict: false })).toBeInstanceOf(RealDeviceIdentity);
      expect(() => assertProcessIsSafe(app)).not.toThrow();
    } finally {
      await app.close();
    }
  });

  it.each<[string, symbol, () => Promise<object> | object]>([
    ['l’identité du terminal', DEVICE_IDENTITY, () => new FakeDeviceIdentity()],
    ['l’autorité des terminaux', DEVICE_CA, () => FakeDeviceCa.inMemory()],
    ['le signataire des jetons d’appareil', TOKEN_SIGNER, () => FakeTokenSigner.create()],
    ['le vérificateur d’attestation', ATTESTATION_VERIFIER, () => new FakeAttestation()],
    ['l’identité du festivalier', CUSTOMER_IDENTITY, () => new FakeCustomerIdentity()],
  ])('faux de %s seul : démarrage refusé, et seul ce faux est nommé', async (name, token, make) => {
    const app = await compile({ token, provider: await make() });
    try {
      let error: unknown;
      try {
        assertProcessIsSafe(app);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(FakeInProductionError);
      expect((error as FakeInProductionError).names).toEqual([name]);
    } finally {
      await app.close();
    }
  });

  it('DEVICE_IDENTITY_FAKE=1 en production : la construction de l’API est refusée', async () => {
    process.env.DEVICE_IDENTITY_FAKE = '1';
    await expect(compile()).rejects.toThrow(FakeInProductionError);
  });

  it('terminal de test : son autorité (DEVICE_CA_FAKE_KEY_FILE) refusée en production', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL_APP: 'postgres://cashless_app:s@db:5432/c',
      DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@db:5432/c',
      OIDC_ISSUER: 'https://id.example',
      OIDC_AUDIENCE: 'a',
      OIDC_APPROVAL_AUDIENCE: 'b',
      OIDC_JWKS_URI: 'https://id.example/jwks.json',
      CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
      TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
      CLAIM_CODE_DOMAIN: 'pay.example.org',
      TRUST_PROXY_HOPS: '0',
      ...DEVICE_PRODUCTION,
    };
    expect(() => loadConfig(production)).not.toThrow();
    expect(() =>
      loadConfig({ ...production, DEVICE_CA_FAKE_KEY_FILE: '/tmp/device-ca.key' }),
    ).toThrow(/DEVICE_CA_FAKE_KEY_FILE/);
  });

  it('terminal de test : aucun fichier servi (src/) n’importe le code de test', () => {
    const SRC = join(__dirname, '../../../src');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
      });
    const offenders = files(SRC).filter((file) =>
      /from\s+['"][^'"]*\/test\/|require\(\s*['"][^'"]*\/test\//.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
