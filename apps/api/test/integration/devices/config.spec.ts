// Configuration servie aux terminaux en HTTPS (lot WP17, T079, T080, T082 ; FR-018, NFR-009 ;
// contracts/device-lifecycle.md ; research R-10, R-14). Terminaux enrôlés en propriétaire
// (`TestTerminal.enroll`), jamais par la route. Contenu conforme au schéma `DeviceConfig` relu dans
// `openapi.yaml`, rien d'inventé (snapshot_keys vide, autorité CENTRAL d'époque 0, catalogue
// vide) ; `config_id` = ligne de `device_config_served` ; ETag stable sans changement réel,
// `304` sur `If-None-Match` ; nouvel ETag après un changement de réglage de l'événement ;
// téléphone personnel jamais hors ligne ; suspendu servi, révoqué refusé (`403 DEVICE_REVOKED`,
// étape 6 bis, ADR-115, sans nonce consommé ni configuration enregistrée), y compris révoqué
// pendant la requête ;
// isolation à deux prestataires ; p95 ≤ 200 ms sur 200 lectures (mesure indicative en local).
//
// Statuts : posés par `set_device_status` en propriétaire (`TestTerminal.setStatus`) ; la route du
// back-office (`POST /v1/devices/:id/revoke`, lot WP16) n'est pas dans cette lane. Écritures
// directes en base : amorçage (politique hors ligne, événement et point de vente) et réglage de
// l'événement modifié.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { components } from '@cashless/contracts';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  TestTerminal,
  type EnrollmentInput,
  type ProofOptions,
  type TerminalResponse,
} from '../../support/test-terminal';

type DeviceConfig = components['schemas']['DeviceConfig'];

const LATENCY_CALLS = 200;
const P95_MS = 200;
/** `SKIP_LATENCY=1` (passe parallèle) : mesure écartée, lancée seule ensuite (jest.config.cjs). */
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;

describe('configuration servie aux terminaux (T079, T080, T082)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;
  let config: AppConfig;
  let eventB: string;
  let ledgerB: string;
  let posA: string;

  const enrolled = async (
    input: Partial<Omit<EnrollmentInput, 'ca'>> = {},
    os: 'ANDROID' | 'IOS' = 'ANDROID',
  ): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal(os).enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        ...input,
        ca,
      }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const getConfig = (
    t: TestTerminal,
    headers: Record<string, string> = {},
    proofs: ProofOptions = {},
  ): Promise<TerminalResponse> =>
    t.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'GET', path: '/device/config' },
      { ...proofs, headers: { ...headers, ...proofs.headers } },
    );
  const served = async (deviceId: string) =>
    ownerRows<{ id: string; operator_id: string }>(
      `SELECT id::text AS id, operator_id FROM device_config_served
        WHERE device_id = $1 ORDER BY id`,
      [deviceId],
    );
  const nonces = async (deviceId: string) =>
    (
      await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = $1',
        [deviceId],
      )
    )[0]!.n;
  /** Politique hors ligne propre au terminal (portée DEVICE), hors ligne demandé. */
  const offlinePolicy = (operatorId: string, deviceId: string) =>
    withOwner((db) =>
      db.query(
        `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled,
           max_per_sale, max_per_media_per_device, max_total_per_device, cash_topup_offline)
         VALUES ($1, 'DEVICE', $2, true, 5000, 20000, 300000, true)`,
        [operatorId, deviceId],
      ),
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    config = api.app.get<AppConfig>(APP_CONFIG, { strict: false });
    eventB = randomUUID();
    posA = randomUUID();
    await withOwner(async (db) => {
      const { rows } = await db.query<{ jurisdiction_id: string }>(
        'SELECT jurisdiction_id FROM event WHERE id = $1',
        [w.ids.eventA],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, w.ops.b, w.ids.organizerB, rows[0]!.jurisdiction_id],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      ledgerB = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
      ).rows[0]!.ledger;
      const merchant = randomUUID();
      const participation = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name)
         VALUES ($1, 'MERCHANT', $2, 'Food truck A')`,
        [merchant, w.ops.a],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type)
         VALUES ($1, $2, $3, $4, 'EXTERNAL')`,
        [participation, w.ops.a, w.ids.eventA, merchant],
      );
      await db.query(
        `INSERT INTO point_of_sale (id, operator_id, participation_id, name)
         VALUES ($1, $2, $3, 'Comptoir 2')`,
        [posA, w.ops.a, participation],
      );
    });
  });

  afterAll(async () => {
    await api?.close();
  });

  it('DeviceConfig conforme ; config_id = ligne de device_config_served ; R-10', async () => {
    const t = await enrolled({ posId: posA });
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    const body = res.body as unknown as DeviceConfig;
    const rows = await served(t.deviceId);
    expect(rows).toHaveLength(1);
    expect(body.config_id).toBe(Number(rows[0]!.id));
    expect(rows[0]!.operator_id).toBe(w.ops.a);
    expect(body.device).toEqual({
      device_id: t.deviceId,
      serial: t.serial,
      kind: 'POS',
      app_mode: 'CATALOG_POS',
      os: 'ANDROID',
      nfc_enabled: true,
      status: 'ACTIVE',
      station_name: null,
    });
    expect(body.event).toMatchObject({
      event_id: w.ids.eventA,
      name: 'Événement A',
      currency: 'XOF',
      minor_units: 0,
      timezone: 'Africa/Dakar',
      status: 'DRAFT',
      activation_modes: ['DESK'],
    });
    expect(body.pos).toEqual({ pos_id: posA, name: 'Comptoir 2', merchant_name: 'Food truck A' });
    // Réglages de l'événement : valeurs par défaut de la base (ADR-61).
    expect(body.terminal_settings).toEqual({
      online_connect_timeout_ms: 2000,
      online_total_timeout_ms: 3000,
      online_retries: 2,
      pending_sync_seconds: 30,
      reconcile_sync_seconds: 300,
      heartbeat_seconds: 60,
      reversal_window_minutes: 15,
      local_retention_days: 7,
      tap_replay_window_seconds: 120,
    });
    // Parties des missions suivantes : forme minimale, rien d'inventé (R-10).
    expect(body.snapshot_keys).toEqual([]);
    expect(body.catalog).toEqual({ version: 0, items: [] }); // point de vente sans catalogue (WP10)
    expect(body.debit_authority).toEqual({
      ledger_id: w.ids.ledgerA,
      authority: 'CENTRAL',
      epoch: 0,
      edge_gateway_id: null,
      edge_base_url: null,
    });
    // Sans politique : hors ligne interdit (défaut du schéma).
    expect(body.offline_policy).toEqual({
      offline_enabled: false,
      max_per_sale: 0,
      max_per_media_per_device: 0,
      max_total_per_device: 0,
      max_snapshot_age_seconds: 900,
      cash_topup_offline: false,
      capped: false,
    });
    expect(body.seq).toEqual({ next_seq_floor: 1, contiguous_acked_seq: 0 });
    expect(body.clock_tolerance_seconds).toBe(config.clockToleranceSeconds);
    expect(Number.isNaN(Date.parse(body.server_time))).toBe(false);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('ETag stable ; If-None-Match égal → 304 sans corps ni nouvelle configuration', async () => {
    const t = await enrolled({ mode: 'TOPUP_DESK' });
    const first = await getConfig(t);
    const second = await getConfig(t);
    expect(second.status).toBe(200);
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(second.body.config_id).toBe(first.body.config_id);
    // Mode sans catalogue : `null` (contrat).
    expect(second.body.catalog).toBeNull();
    const etag = String(first.headers.etag);
    const notModified = await getConfig(t, { 'if-none-match': etag });
    expect(notModified.status).toBe(304);
    expect(notModified.text).toBe('');
    expect(notModified.headers.etag).toBe(etag);
    // Liste, forme faible et `*` : même effet ; autre valeur : 200.
    expect((await getConfig(t, { 'if-none-match': `"autre", W/${etag}` })).status).toBe(304);
    expect((await getConfig(t, { 'if-none-match': '*' })).status).toBe(304);
    expect((await getConfig(t, { 'if-none-match': '"autre"' })).status).toBe(200);
    expect(await served(t.deviceId)).toHaveLength(1);
  });

  it('changement d’un réglage de l’événement → 200, nouvel ETag et nouveau config_id', async () => {
    const t = await enrolled();
    const before = await getConfig(t);
    const etag = String(before.headers.etag);
    const { rows } = await withOwner((db) =>
      db.query<{ heartbeat_seconds: number }>('SELECT heartbeat_seconds FROM event WHERE id = $1', [
        w.ids.eventA,
      ]),
    );
    const next = rows[0]!.heartbeat_seconds === 90 ? 120 : 90;
    await withOwner((db) =>
      db.query('UPDATE event SET heartbeat_seconds = $2 WHERE id = $1', [w.ids.eventA, next]),
    );
    const after = await getConfig(t, { 'if-none-match': etag });
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(etag);
    expect(after.body.config_id).not.toBe(before.body.config_id);
    expect((after.body as unknown as DeviceConfig).terminal_settings.heartbeat_seconds).toBe(next);
    expect(await served(t.deviceId)).toHaveLength(2);
    // Puis stable de nouveau.
    const again = await getConfig(t, { 'if-none-match': String(after.headers.etag) });
    expect(again.status).toBe(304);
  });

  it('téléphone personnel : jamais hors ligne, même si sa politique le demande', async () => {
    const phone = await enrolled({ mode: 'KEYPAD_TPE', personalPhone: true });
    const keypad = await enrolled({ mode: 'KEYPAD_TPE' });
    await offlinePolicy(w.ops.a, phone.deviceId);
    await offlinePolicy(w.ops.a, keypad.deviceId);
    const own = (await getConfig(keypad)).body as unknown as DeviceConfig;
    expect(own.offline_policy).toMatchObject({
      offline_enabled: true,
      max_per_sale: 5000,
      cash_topup_offline: true,
    });
    const res = await getConfig(phone);
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    const body = res.body as unknown as DeviceConfig;
    expect(body.offline_policy.offline_enabled).toBe(false);
    expect(body.offline_policy.cash_topup_offline).toBe(false);
    expect(body.catalog).toBeNull();
  });

  it('terminal iOS : servi, sans NFC', async () => {
    const t = await enrolled({}, 'IOS');
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    expect(res.body.device).toMatchObject({ os: 'IOS', nfc_enabled: false });
  });

  it('suspendu : configuration servie ; une route sans allowSuspended refusée', async () => {
    const t = await enrolled();
    const before = await getConfig(t);
    await withOwner((db) => t.setStatus(db, 'SUSPENDED'));
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({ status: 'SUSPENDED' });
    // Le statut fait partie du contenu servi : l'ETag change.
    expect(res.headers.etag).not.toBe(before.headers.etag);
    const tap = await t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/taps',
      body: {},
    });
    expect(tap.status).toBe(403);
    expect(tap.body.code).toBe('DEVICE_SUSPENDED');
  });

  it('révoqué (actif ou suspendu) : 403 DEVICE_REVOKED, ni nonce ni configuration', async () => {
    for (const path of [['REVOKED'], ['SUSPENDED', 'REVOKED']] as const) {
      const t = await enrolled();
      await getConfig(t);
      for (const status of path) await withOwner((db) => t.setStatus(db, status));
      const rowsBefore = (await served(t.deviceId)).length;
      const noncesBefore = await nonces(t.deviceId);
      const res = await getConfig(t);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DEVICE_REVOKED');
      expect(await served(t.deviceId)).toHaveLength(rowsBefore);
      expect(await nonces(t.deviceId)).toBe(noncesBefore);
    }
  });

  it('révoqué pendant la requête, après la garde : refusé, rien enregistré (R-14)', async () => {
    const t = await enrolled();
    // Révocation tenue ouverte : la garde lit encore ACTIVE (lecture sans verrou), la route attend
    // le verrou du terminal puis relit REVOKED. UPDATE direct en propriétaire : seul effet utile
    // ici de set_device_status, et verrou sans conflit avec la clé étrangère du nonce (KEY SHARE).
    const res = await commitWhileWaiting(
      { sql: "UPDATE device SET status = 'REVOKED' WHERE id = $1", params: [t.deviceId] },
      { role: 'cashless_app', statement: 'FOR NO KEY UPDATE' },
      () => getConfig(t),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEVICE_REVOKED');
    expect(await served(t.deviceId)).toHaveLength(0);
  });

  it('isolation : chaque prestataire reçoit sa configuration, sur son grand livre', async () => {
    const a = await enrolled();
    const b = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId: w.ops.b, eventId: eventB, ca }),
    );
    await b.issueToken(tokens);
    const resB = await getConfig(b);
    expect(resB.status).toBe(200);
    const bodyB = resB.body as unknown as DeviceConfig;
    expect(bodyB.event.event_id).toBe(eventB);
    expect(bodyB.debit_authority.ledger_id).toBe(ledgerB);
    expect((await served(b.deviceId)).map((row) => row.operator_id)).toEqual([w.ops.b]);
    const bodyA = (await getConfig(a)).body as unknown as DeviceConfig;
    expect(bodyA.event.event_id).toBe(w.ids.eventA);
    expect(bodyA.debit_authority.ledger_id).toBe(w.ids.ledgerA);
    // Le certificat de A avec le jeton de B : refusé (preuves d'un autre terminal).
    expect((await getConfig(b, {}, { certificate: a })).status).toBe(401);
  });

  latency(
    `NFR-009 : p95 ≤ ${P95_MS} ms sur ${LATENCY_CALLS} lectures (indicatif, local)`,
    async () => {
      const t = await enrolled();
      await getConfig(t);
      const durations: number[] = [];
      for (let i = 0; i < LATENCY_CALLS; i += 1) {
        const started = process.hrtime.bigint();
        const res = await getConfig(t);
        durations.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(res.status).toBe(200);
      }
      expect(p95(durations)).toBeLessThanOrEqual(P95_MS);
    },
  );
});
