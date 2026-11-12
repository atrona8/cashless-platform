// WP19 / T086 : getDeviceConfig, postDeviceHeartbeat, getDeviceSeqStatus, servis depuis la copie
// locale. `ETag`, `304`, `edge_base_url`, accusé jamais provisoire, terminal suspendu servi.
import { randomUUID } from 'node:crypto';
import { makeBench, type Bench, type TestDevice } from './_support/harness';

let b: Bench;
let d: TestDevice;

beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5, withKeys: true });
  d = await b.newDevice();
});
afterAll(async () => b.close());

const config = (device: TestDevice, headers: Record<string, string> = {}) =>
  b.request(device, { path: '/v1/device/config', headers });
const beat = (device: TestDevice, body: unknown) =>
  b.request(device, { method: 'POST', path: '/v1/device/heartbeat', body });
const goodBeat = {
  device_time: new Date().toISOString(),
  last_local_seq: 4,
  pending_operations: 2,
  snapshot_version: 9,
  app_version: '1.4.2',
};

describe('getDeviceConfig', () => {
  it('200 depuis la copie : config_id du central, blocs device, event, pos, politique', async () => {
    const r = await config(d);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, any>;
    expect(body.config_id).toBe(7);
    expect(body.device).toMatchObject({
      device_id: d.deviceId,
      serial: d.serial,
      kind: 'POS',
      app_mode: 'CATALOG_POS',
      os: 'ANDROID',
      nfc_enabled: true,
      status: 'ACTIVE',
      station_name: 'Bar 1',
    });
    expect(body.event).toMatchObject({ name: 'Festival test', currency: 'XOF', status: 'LIVE' });
    expect(body.event.event_id).toBe(b.ids.event);
    expect(body.pos).toMatchObject({ name: 'Bar central', merchant_name: 'Marchand SA' });
    expect(body.offline_policy).toMatchObject({ max_per_sale: 5000, cash_topup_offline: false });
    expect(body.clock_tolerance_seconds).toBe(120);
    expect(body.terminal_settings.heartbeat_seconds).toBe(60);
    expect(body.catalog).toEqual({ version: 0, items: [] });
  });

  it('hors ligne refusé par défaut tant que la passerelle n’a pas sa clé de snapshot', async () => {
    expect(((await config(d)).json as any).offline_policy.offline_enabled).toBe(false);
    b.snapshotKeys.push({
      key_id: 'edge-snap-1',
      algorithm: 'ECDSA_P256_SHA256',
      public_key: Buffer.alloc(91, 1).toString('base64'),
      not_after: null,
    });
    try {
      const r = (await config(d)).json as any;
      expect(r.offline_policy.offline_enabled).toBe(true);
      expect(r.snapshot_keys).toHaveLength(1);
    } finally {
      b.snapshotKeys.length = 0;
    }
  });

  it('edge_base_url = adresse de la passerelle quand elle est ACTIVE ; sinon CENTRAL sans adresse', async () => {
    const active = (await config(d)).json as any;
    expect(active.debit_authority).toEqual({
      ledger_id: b.ids.ledger,
      authority: 'EDGE',
      epoch: 3,
      edge_gateway_id: b.gatewayId,
      edge_base_url: expect.stringMatching(/^https:\/\/.+/),
    });
    b.authorityState.state = 'RELEASING';
    try {
      const moving = (await config(d)).json as any;
      expect(moving.debit_authority).toMatchObject({
        authority: 'CENTRAL',
        edge_gateway_id: null,
        edge_base_url: null,
      });
    } finally {
      b.authorityState.state = 'ACTIVE';
    }
  });

  it('ETag fort ; 304 sur If-None-Match ; l’ETag change quand l’autorité change', async () => {
    const first = await config(d);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const cached = await config(d, { 'if-none-match': etag });
    expect(cached.status).toBe(304);
    expect(cached.text).toBe('');
    expect((await config(d, { 'if-none-match': 'W/"autre"' })).status).toBe(200);
    expect((await config(d, { 'if-none-match': etag })).headers.etag).toBe(etag); // stable
    b.authorityState.state = 'STALE';
    try {
      const after = await config(d, { 'if-none-match': etag });
      expect(after.status).toBe(200);
      expect(after.headers.etag).not.toBe(etag);
    } finally {
      b.authorityState.state = 'ACTIVE';
    }
  });

  it('catalogue du point de vente, dans la langue demandée', async () => {
    const dev = await b.newDevice();
    const pos = (await b.q<{ pos_id: string }>('SELECT pos_id FROM edge_device WHERE device_id = $1', [dev.deviceId]))[0]!.pos_id;
    const product = randomUUID();
    await b.q('INSERT INTO edge_catalog_item (pos_id, item_id, version, price, lines) VALUES ($1, $2, 4, 1500, $3)', [
      pos,
      product,
      JSON.stringify({ name_fr: 'Bière', name_en: 'Beer', category_fr: 'Boissons', category_en: 'Drinks', vat_rate_bps: 1800 }),
    ]);
    const fr = (await config(dev)).json as any;
    expect(fr.catalog).toEqual({
      version: 4,
      items: [{ product_id: product, name: 'Bière', unit_price: 1500, category: 'Boissons', vat_rate_bps: 1800 }],
    });
    const en = (await b.request(dev, { path: '/v1/device/config', headers: { 'accept-language': 'en' } })).json as any;
    expect(en.catalog.items[0].name).toBe('Beer');
    expect((await config(dev)).headers.etag).not.toBe((await b.request(dev, { path: '/v1/device/config', headers: { 'accept-language': 'en' } })).headers.etag);
  });

  it('heure servie = horloge de la passerelle (server_time et en-tête Date)', async () => {
    b.clock.advance(3_600_000);
    try {
      const r = await config(d);
      const served = Date.parse((r.json as any).server_time);
      expect(Math.abs(served - b.clock.now().getTime())).toBeLessThan(2000);
      expect(Math.abs(Date.parse(r.headers.date as string) - b.clock.now().getTime())).toBeLessThan(2500);
      expect(served - Date.now()).toBeGreaterThan(3_000_000);
    } finally {
      b.clock.advance(-3_600_000);
    }
  });

  it('copie incomplète (os absent) : 409 CONFLICT_STATE, jamais une valeur inventée', async () => {
    const dev = await b.newDevice({ os: null });
    const r = await config(dev);
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe('CONFLICT_STATE');
  });

  it('terminal SUSPENDED servi', async () => {
    const dev = await b.newDevice({ status: 'SUSPENDED' });
    const r = await config(dev);
    expect(r.status).toBe(200);
    expect((r.json as any).device.status).toBe('SUSPENDED');
  });
});

describe('postDeviceHeartbeat', () => {
  it('200 : état local du terminal mis à jour, ETag de la configuration, autorité', async () => {
    const r = await beat(d, goodBeat);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, any>;
    expect(Object.keys(body).sort()).toEqual([
      'config_etag',
      'debit_authority',
      'latest_snapshot_version',
      'server_time',
      'sync_requested',
    ]);
    expect(body.config_etag).toBe((await config(d)).headers.etag);
    expect(body.debit_authority.authority).toBe('EDGE');
    expect(body.latest_snapshot_version).toBeNull();
    expect(body.sync_requested).toBe(false);
    const row = (await b.q<any>('SELECT * FROM edge_device WHERE device_id = $1', [d.deviceId]))[0];
    expect(row.app_version).toBe('1.4.2');
    expect(Number(row.reported_snapshot_version)).toBe(9);
    expect(Number(row.reported_local_seq)).toBe(4);
    expect(Number(row.pending_operations)).toBe(2);
    expect(row.last_heartbeat_at).toBeInstanceOf(Date);
  });

  it('latest_snapshot_version fourni par WP23 ; sync_requested quand l’événement est CLOSING', async () => {
    b.snapshotVersion.value = 12;
    await b.q("UPDATE edge_event_setting SET status = 'CLOSING'");
    try {
      const body = (await beat(d, goodBeat)).json as any;
      expect(body.latest_snapshot_version).toBe(12);
      expect(body.sync_requested).toBe(true);
    } finally {
      b.snapshotVersion.value = null;
      await b.q("UPDATE edge_event_setting SET status = 'LIVE'");
    }
  });

  it('corps invalide : 400 VALIDATION_FAILED, rien n’est écrit', async () => {
    const dev = await b.newDevice();
    for (const body of [
      {},
      { ...goodBeat, device_time: 'hier' },
      { ...goodBeat, last_local_seq: -1 },
      { ...goodBeat, pending_operations: 'x' },
      { ...goodBeat, battery_percent: 101 },
      { ...goodBeat, app_version: 'x'.repeat(65) },
    ]) {
      const r = await beat(dev, body);
      expect({ body, status: r.status, code: r.json?.code }).toEqual({
        body,
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    }
    const row = (await b.q<any>('SELECT last_heartbeat_at FROM edge_device WHERE device_id = $1', [dev.deviceId]))[0];
    expect(row.last_heartbeat_at).toBeNull();
  });

  it('terminal SUSPENDED servi, REVOKED refusé', async () => {
    expect((await beat(await b.newDevice({ status: 'SUSPENDED' }), goodBeat)).status).toBe(200);
    const revoked = await beat(await b.newDevice({ status: 'REVOKED' }), goodBeat);
    expect([revoked.status, revoked.json?.code]).toEqual([403, 'DEVICE_REVOKED']);
  });
});

describe('getDeviceSeqStatus', () => {
  const setSeq = (dev: TestDevice, local: number, acked: number, known: boolean) =>
    b.q(
      `INSERT INTO edge_device_seq (device_id, contiguous_local_seq, central_acked_seq, acked_known)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id) DO UPDATE SET contiguous_local_seq = $2, central_acked_seq = $3, acked_known = $4`,
      [dev.deviceId, local, acked, known],
    );
  const status = (dev: TestDevice) => b.request(dev, { path: '/v1/device/seq-status' });

  it('aucune passe : accusé 0 (inconnu), jamais un accusé local', async () => {
    const dev = await b.newDevice();
    await setSeq(dev, 12, 0, false);
    const r = (await status(dev)).json as any;
    expect(r).toEqual({
      device_serial: dev.serial,
      contiguous_acked_seq: 0,
      max_seen_seq: 12,
      missing_seqs: [],
      next_seq_floor: 13,
    });
  });

  it('accusé connu : la dernière valeur du central, même périmée, jamais le numéro local', async () => {
    const dev = await b.newDevice();
    await setSeq(dev, 12, 7, true);
    const r = (await status(dev)).json as any;
    expect(r.contiguous_acked_seq).toBe(7);
    expect(r.max_seen_seq).toBe(12);
    // Le numéro local avance (nouvelles écritures), l'accusé du central ne bouge pas.
    await setSeq(dev, 20, 7, true);
    expect(((await status(dev)).json as any).contiguous_acked_seq).toBe(7);
  });

  it('terminal sans ligne de séquence : zéros, plancher 1', async () => {
    const dev = await b.newDevice();
    const r = (await status(dev)).json as any;
    expect([r.contiguous_acked_seq, r.max_seen_seq, r.next_seq_floor]).toEqual([0, 0, 1]);
  });

  it('terminal SUSPENDED servi ; REVOKED : 403 DEVICE_REVOKED', async () => {
    expect((await status(await b.newDevice({ status: 'SUSPENDED' }))).status).toBe(200);
    const revoked = await status(await b.newDevice({ status: 'REVOKED' }));
    expect([revoked.status, revoked.json?.code]).toEqual([403, 'DEVICE_REVOKED']);
  });

  it('un terminal ne lit que ses propres numéros', async () => {
    const other = await b.newDevice();
    await setSeq(other, 99, 98, true);
    const mine = (await status(d)).json as any;
    expect(mine.device_serial).toBe(d.serial);
    expect(mine.max_seen_seq).not.toBe(99);
  });
});
