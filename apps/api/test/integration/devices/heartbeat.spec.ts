// Battement de cœur des terminaux en HTTPS (lot WP17, T081, T082 ; FR-019, NFR-009 ;
// contracts/device-lifecycle.md ; research R-10, R-14). Terminaux enrôlés en propriétaire
// (`TestTerminal.enroll`). Réponse conforme au schéma `HeartbeatResponse` relu dans `openapi.yaml`,
// `config_etag` égal à l'ETag de `GET /device/config` ; `last_seen_at` et `app_version` écrits ;
// aucun numéro de séquence consommé ; suspendu admis, révoqué refusé (`403 DEVICE_REVOKED`), y
// compris révoqué pendant la requête (statut relu par `record_device_heartbeat`, FOR UPDATE) ;
// corps invalide refusé sans écriture ; p95 ≤ 200 ms sur 200 appels (mesure indicative en local).
// Statuts posés par `set_device_status` en propriétaire (la route du back-office, lot WP16, n'est
// pas dans cette lane). Heures comparées entre elles, toutes lues en base (jamais l'heure de Node
// contre `now()`).
import 'reflect-metadata';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal, type TerminalResponse } from '../../support/test-terminal';

const LATENCY_CALLS = 200;
const P95_MS = 200;
/** `SKIP_LATENCY=1` (passe parallèle) : mesure écartée, lancée seule ensuite (jest.config.cjs). */
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;

interface DeviceState {
  last_seen_at: Date | null;
  app_version: string | null;
  last_seq: string;
  contiguous_acked_seq: string;
  next_seq_floor: string;
  registry: number;
}

describe('battement de cœur des terminaux (T081, T082)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;

  const enrolled = async (): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId: w.ops.a, eventId: w.ids.eventA, ca }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const beat = (t: TestTerminal, body: unknown = heartbeatBody()): Promise<TerminalResponse> =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/device/heartbeat',
      body,
    });
  const heartbeatBody = (overrides: Record<string, unknown> = {}) => ({
    device_time: new Date().toISOString(),
    snapshot_version: null,
    last_local_seq: 91,
    pending_operations: 4,
    pending_exposure: 12500,
    battery_percent: 64,
    app_version: '1.4.2',
    ...overrides,
  });
  const state = async (deviceId: string): Promise<DeviceState> =>
    (
      await ownerRows<DeviceState>(
        `SELECT last_seen_at, app_version, last_seq::text AS last_seq,
                contiguous_acked_seq::text AS contiguous_acked_seq,
                next_seq_floor::text AS next_seq_floor,
                (SELECT count(*)::int FROM device_seq_registry r WHERE r.device_id = d.id)
                  AS registry
           FROM device d WHERE d.id = $1`,
        [deviceId],
      )
    )[0]!;

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
  });

  afterAll(async () => {
    await api?.close();
  });

  it('réponse conforme ; config_etag = ETag servi ; last_seen_at, app_version écrits', async () => {
    const t = await enrolled();
    expect((await state(t.deviceId)).last_seen_at).toBeNull();
    const res = await beat(t);
    expect(res.status).toBe(200);
    expect(contractViolations('HeartbeatResponse', res.body)).toEqual([]);
    const config = await t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
    expect(res.body.config_etag).toBe(config.headers.etag);
    expect(res.body.debit_authority).toEqual(config.body.debit_authority);
    expect(res.body.debit_authority).toEqual({
      ledger_id: w.ids.ledgerA,
      authority: 'CENTRAL',
      epoch: 0,
      edge_gateway_id: null,
      edge_base_url: null,
    });
    expect(res.body.latest_snapshot_version).toBeNull();
    expect(res.body.sync_requested).toBe(false);
    expect(Number.isNaN(Date.parse(String(res.body.server_time)))).toBe(false);
    const first = await state(t.deviceId);
    expect(first.last_seen_at).not.toBeNull();
    expect(first.app_version).toBe('1.4.2');

    // Second battement : dernière présence avancée (heures de la base, comparées entre elles) ;
    // app_version absente : gardée.
    const { app_version: _version, ...withoutVersion } = heartbeatBody();
    expect((await beat(t, withoutVersion)).status).toBe(200);
    const second = await state(t.deviceId);
    expect(second.last_seen_at!.getTime()).toBeGreaterThanOrEqual(first.last_seen_at!.getTime());
    expect(second.app_version).toBe('1.4.2');
    // Même configuration : même ETag d'un battement à l'autre.
    expect((await beat(t)).body.config_etag).toBe(res.body.config_etag);
  });

  it('aucun numéro de séquence consommé ni avancé', async () => {
    const t = await enrolled();
    const before = await state(t.deviceId);
    for (let i = 0; i < 3; i += 1)
      expect((await beat(t, heartbeatBody({ last_local_seq: 500 + i }))).status).toBe(200);
    const after = await state(t.deviceId);
    expect({
      last_seq: after.last_seq,
      contiguous_acked_seq: after.contiguous_acked_seq,
      next_seq_floor: after.next_seq_floor,
      registry: after.registry,
    }).toEqual({
      last_seq: before.last_seq,
      contiguous_acked_seq: before.contiguous_acked_seq,
      next_seq_floor: before.next_seq_floor,
      registry: 0,
    });
  });

  it('suspendu : admis (allowSuspended), dernière présence écrite', async () => {
    const t = await enrolled();
    await withOwner((db) => t.setStatus(db, 'SUSPENDED'));
    const res = await beat(t);
    expect(res.status).toBe(200);
    expect(contractViolations('HeartbeatResponse', res.body)).toEqual([]);
    expect((await state(t.deviceId)).last_seen_at).not.toBeNull();
  });

  it('révoqué (actif ou suspendu) : 403 DEVICE_REVOKED, rien écrit', async () => {
    for (const path of [['REVOKED'], ['SUSPENDED', 'REVOKED']] as const) {
      const t = await enrolled();
      expect((await beat(t)).status).toBe(200);
      const before = await state(t.deviceId);
      for (const status of path) await withOwner((db) => t.setStatus(db, status));
      const res = await beat(t, heartbeatBody({ app_version: '9.9.9' }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DEVICE_REVOKED');
      expect(await state(t.deviceId)).toEqual(before);
    }
  });

  it('révoqué pendant la requête (après la garde) : refusé, rien écrit (R-14)', async () => {
    const t = await enrolled();
    const before = await state(t.deviceId);
    // Révocation tenue ouverte : la garde lit encore ACTIVE ; record_device_heartbeat attend le
    // verrou du terminal puis relit REVOKED (UPDATE direct en propriétaire, voir config.spec.ts).
    const res = await commitWhileWaiting(
      { sql: "UPDATE device SET status = 'REVOKED' WHERE id = $1", params: [t.deviceId] },
      { role: 'cashless_app', statement: 'record_device_heartbeat' },
      () => beat(t),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEVICE_REVOKED');
    expect((await state(t.deviceId)).last_seen_at).toEqual(before.last_seen_at);
  });

  it('corps invalide : 400 VALIDATION_FAILED, rien écrit', async () => {
    const t = await enrolled();
    const invalid: unknown[] = [
      [],
      heartbeatBody({ device_time: undefined }),
      heartbeatBody({ device_time: 'hier' }),
      heartbeatBody({ last_local_seq: -1 }),
      heartbeatBody({ pending_operations: 1.5 }),
      heartbeatBody({ battery_percent: 101 }),
      heartbeatBody({ snapshot_version: 'x' }),
      heartbeatBody({ app_version: 'x'.repeat(65) }),
    ];
    for (const body of invalid) {
      const res = await beat(t, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await state(t.deviceId)).last_seen_at).toBeNull();
  });

  latency(
    `NFR-009 : p95 ≤ ${P95_MS} ms sur ${LATENCY_CALLS} battements (indicatif, local)`,
    async () => {
      const t = await enrolled();
      await beat(t);
      const durations: number[] = [];
      for (let i = 0; i < LATENCY_CALLS; i += 1) {
        const started = process.hrtime.bigint();
        const res = await beat(t);
        durations.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(res.status).toBe(200);
      }
      expect(p95(durations)).toBeLessThanOrEqual(P95_MS);
    },
  );
});
