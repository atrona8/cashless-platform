// Configuration et battement de cœur servis avec les snapshots (lot WP15 ; T062, T063 ; R-30.9) :
// `snapshot_keys`, `offline_enabled`, `cash_topup_offline`, ETag de configuration,
// `latest_snapshot_version`, `sync_requested`. Clés et versions posées par les fonctions SQL de la
// mission (propriétaire). Pensé pour une base remise à zéro (aucune clé ACTIVE au départ).
import 'reflect-metadata';
import type { components } from '@cashless/contracts';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';
import { platformKeyExists, publishVersion, rotateOwnKey, seedEntry } from './snapshots-seed';

jest.setTimeout(120_000);
type DeviceConfig = components['schemas']['DeviceConfig'];

describe('configuration et battement avec snapshots (T062, T063)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let t: TestTerminal;
  // Sans clé propre, un prestataire reçoit la clé de la plateforme si elle existe : jamais créée ici.
  let noPlatformKey = true;

  const config = async () => {
    const res = await t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    return { body: res.body as unknown as DeviceConfig, etag: String(res.headers.etag) };
  };
  const beat = async () => {
    const res = await t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/device/heartbeat',
      body: {
        device_time: new Date().toISOString(),
        snapshot_version: null,
        last_local_seq: 0,
        pending_operations: 0,
        app_version: '1.0.0-test',
      },
    });
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    const ca: DeviceCaPort = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    const tokens = api.app.get(DeviceTokenService, { strict: false });
    noPlatformKey = !(await withOwner(platformKeyExists));
    t = await withOwner((db) =>
      new TestTerminal('ANDROID').enroll(db, { operatorId: w.ops.a, eventId: w.ids.eventA, ca }),
    );
    await t.issueToken(tokens);
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled,
           max_per_sale, max_per_media_per_device, max_total_per_device)
         VALUES ($1, 'EVENT', $2, true, 5000, 20000, 300000)`,
        [w.ops.a, w.ids.eventA],
      ),
    );
  });
  afterAll(async () => {
    await api?.close();
  });

  it('sans clé ACTIVE : snapshot_keys vide et offline_enabled faux malgré la politique', async () => {
    if (!noPlatformKey) return; // une clé de la plateforme existe : état « sans clé » inobservable
    const { body } = await config();
    expect(body.snapshot_keys).toEqual([]);
    expect(body.offline_policy.offline_enabled).toBe(false);
    expect(body.offline_policy.max_per_sale).toBe(5000);
    expect(body.offline_policy.cash_topup_offline).toBe(false);
  });

  it('battement : aucune version, aucun CLOSING', async () => {
    const hb = await beat();
    expect(hb.latest_snapshot_version).toBeNull();
    expect(hb.sync_requested).toBe(false);
  });

  it('avec une clé ACTIVE : offline_enabled vrai, une clé (not_after null), ETag changé', async () => {
    const before = await config();
    const keyA = await withOwner((db) => rotateOwnKey(db, w.ops.a, 'ca'));
    const after = await config();
    expect(after.etag).not.toBe(before.etag);
    expect(after.body.offline_policy.offline_enabled).toBe(true);
    expect(after.body.offline_policy.cash_topup_offline).toBe(false);
    expect(after.body.snapshot_keys).toHaveLength(1);
    expect(after.body.snapshot_keys[0]).toMatchObject({
      key_id: keyA,
      algorithm: 'ECDSA_P256_SHA256',
      not_after: null,
    });
    expect(Buffer.from(after.body.snapshot_keys[0]!.public_key, 'base64')).toHaveLength(91);
    // Base64 standard sur une ligne (openapi.yaml) : aucun blanc, jamais de coupure à 76 colonnes.
    expect(after.body.snapshot_keys[0]!.public_key).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect((await beat()).config_etag).toBe(after.etag);
  });

  it('rotation : deux clés au plus (ACTIVE puis RETIRED datée), troisième jamais ; ETag change', async () => {
    const before = await config();
    const keyB = await withOwner((db) => rotateOwnKey(db, w.ops.a, 'cb'));
    const two = await config();
    expect(two.etag).not.toBe(before.etag);
    expect(two.body.snapshot_keys).toHaveLength(2);
    expect(two.body.snapshot_keys[0]).toMatchObject({ key_id: keyB, not_after: null });
    expect(two.body.snapshot_keys[1]!.not_after).not.toBeNull();
    await withOwner((db) => rotateOwnKey(db, w.ops.a, 'cc'));
    const still = await config();
    expect(still.body.snapshot_keys).toHaveLength(2);
    expect(still.etag).not.toBe(two.etag);
  });

  it('battement : latest_snapshot_version après publication ; sync_requested si CLOSING', async () => {
    const v = await withOwner((db) =>
      publishVersion(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        kind: 'FULL',
        entries: [seedEntry(1, false)],
      }),
    );
    expect(Number(v.version)).toBe(1);
    const hb = await beat();
    expect(hb.latest_snapshot_version).toBe(1);
    expect(hb.sync_requested).toBe(false);
    await withOwner(async (db) => {
      await db.query("SELECT set_config('app.operator_id', $1, false)", [w.ops.a]);
      for (const status of ['LIVE', 'CLOSING'])
        await db.query('SELECT set_event_status($1, $2, $3)', [
          w.ids.eventA,
          status,
          w.operatorAdminA.userId,
        ]);
    });
    expect((await beat()).sync_requested).toBe(true);
  });
});
