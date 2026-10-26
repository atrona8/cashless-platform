// Retouche hors carte du lot WP11 (report de la relecture WP10, cycle 1) : le battement de cœur construit la
// configuration dans la langue de `Accept-Language`, comme `GET /device/config`. Sans cela, un terminal non
// francophone voyait un `config_etag` différent à chaque battement (catalogue en français contre en anglais) et
// relisait sa configuration. Le battement n'écrit toujours rien dans `device_catalog_served`.
import 'reflect-metadata';
import { ownerRows } from '../../support/media-fixtures';
import { PaymentWorld } from './payments-fixtures';

jest.setTimeout(120_000);

describe('config_etag du battement de cœur, terminal non francophone', () => {
  let pw: PaymentWorld;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
  });
  afterAll(async () => {
    await pw?.close();
  });

  it('Accept-Language: en → config_etag stable d’un battement à l’autre, égal à l’ETag de GET /device/config', async () => {
    const term = await pw.terminal({ mode: 'CATALOG_POS', session: false });
    const call = (method: 'GET' | 'POST', path: string, body?: unknown, language = 'en') =>
      term.t.request(
        pw.api.baseUrl,
        pw.api.tls.serverCaPem,
        { method, path, body },
        { headers: { 'accept-language': language } },
      );
    const beat = (language = 'en') =>
      call(
        'POST',
        '/device/heartbeat',
        {
          device_time: new Date().toISOString(),
          snapshot_version: null,
          last_local_seq: 0,
          pending_operations: 0,
          pending_exposure: 0,
          battery_percent: 80,
          app_version: '1.0.0-test',
        },
        language,
      );
    const config = await call('GET', '/device/config');
    expect(config.status).toBe(200);
    const etag = String(config.headers.etag);
    const served = () =>
      ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_catalog_served WHERE device_id = $1',
        [term.t.deviceId],
      );
    const before = await served();
    const first = await beat();
    const second = await beat();
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.config_etag).toBe(etag);
    expect(second.body.config_etag).toBe(etag);
    // Le français reste le défaut : son ETag est celui du catalogue en français, différent de l'anglais.
    const french = await beat('fr');
    expect(french.body.config_etag).not.toBe(etag);
    expect(await served()).toEqual(before);
  });
});
