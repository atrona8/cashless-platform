// Latence de l'ouverture de session de vendeur par le processus `vendor-pin` (mission 11a, lot
// WP07 ; NFR-001) : 200 ouvertures en série (bon PIN ; chaque ouverture remplace la précédente,
// `REPLACED`), HTTPS réel vers l'API, VRAI processus `vendor-pin` (HTTP local, base `cashless_pin`),
// mesure p95 et p99 du temps de la route vu du terminal.
// Attendu (research R-N76-N79 §4) : ≈ 80-120 ms (argon2id ≈ 60 ms + saut local + audit). Seuils de
// NFR-001 : p95 ≤ 300 ms, p99 ≤ 600 ms. Mesure indicative en local, écartée de la passe parallèle
// (`SKIP_LATENCY=1`, jest.config.cjs) et lancée seule : `npx jest
// test/integration/vendors/vendor-pin-latency.spec.ts --runInBand --forceExit`.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, testPinDigester, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';
import { seedPos, seedVendor } from './vendor-fixtures';

jest.setTimeout(300_000);

const CALLS = 200;
const P95_MS = 300;
const P99_MS = 600;
const PIN = '314159';
/** `SKIP_LATENCY=1` (passe parallèle) : mesure écartée, lancée seule ensuite. */
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const percentile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;

describe('Latence des sessions de vendeur par le processus (NFR-001)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
  });
  afterAll(async () => {
    await api?.close();
  });

  latency('200 ouvertures en série : p95 ≤ 300 ms, p99 ≤ 600 ms', async () => {
    const ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    const pos = await withOwner((db) =>
      seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA, name: 'Latence' }),
    );
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        posId: pos.posId,
        mode: 'CATALOG_POS',
        ca,
      }),
    );
    await t.issueToken(api.app.get(DeviceTokenService, { strict: false }));
    const pinHash = await testPinDigester().hash(PIN);
    const vendorId = await withOwner((db) =>
      seedVendor(db, {
        operatorId: w.ops.a,
        merchantId: pos.merchantId,
        actorId: w.operatorAdminA.userId,
        displayName: 'Latence',
        pinHash,
      }),
    );
    const open = () =>
      t.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'POST',
        path: '/vendor-sessions',
        body: { vendor_id: vendorId, pin: PIN },
        idempotencyKey: randomUUID(),
      });
    expect((await open()).status).toBe(201); // échauffement (connexions, JIT)
    const durations: number[] = [];
    for (let i = 0; i < CALLS; i += 1) {
      const started = process.hrtime.bigint();
      const res = await open();
      durations.push(Number(process.hrtime.bigint() - started) / 1e6);
      expect(res.status).toBe(201);
    }
    durations.sort((a, b) => a - b);
    const p95 = percentile(durations, 0.95);
    const p99 = percentile(durations, 0.99);
    process.stdout.write(
      `NFR-001 vendor-pin : ${CALLS} ouvertures, p50=${percentile(durations, 0.5).toFixed(1)} ms ` +
        `p95=${p95.toFixed(1)} ms p99=${p99.toFixed(1)} ms max=${durations.at(-1)!.toFixed(1)} ms\n`,
    );
    const replaced = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM vendor_session WHERE device_id = $1 AND closed_reason = 'REPLACED'`,
      [t.deviceId],
    );
    expect(Number(replaced[0]!.n)).toBe(CALLS);
    expect(p95).toBeLessThanOrEqual(P95_MS);
    expect(p99).toBeLessThanOrEqual(P99_MS);
  });
});
