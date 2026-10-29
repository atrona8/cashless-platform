// Intégration : purge des corps bruts des notifications (lot WP12, T063 ; A24). Corps vidé après 400 jours, ligne et
// métadonnées gardées ; au plus un passage par intervalle ; intervalle invalide : démarrage refusé.
import {
  pspPurgeIntervalSeconds,
  PSP_EVENT_BODY_RETENTION_DAYS,
} from '../../../src/topups/poller/psp-event-purge.worker';
import { ownerRows } from '../../support/media-fixtures';
import {
  insertEvent,
  startPoller,
  WebhookWorld,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(60_000);

describe('purge des corps bruts', () => {
  let w: WebhookWorld;
  let proc: PollerProcess;

  beforeAll(async () => {
    w = await WebhookWorld.create();
    proc = await startPoller(w);
  }, 240_000);
  afterAll(async () => {
    await proc.close();
    await w.close();
  });

  const row = (id: string) =>
    ownerRows<{
      body: Buffer | null;
      body_purged_at: Date | null;
      kind: string;
      provider_event_id: string;
      status: string;
    }>(
      'SELECT body, body_purged_at, kind, provider_event_id, status FROM psp_event WHERE psp_event_id = $1',
      [id],
    ).then((rows) => rows[0]!);

  it('un corps de 401 jours est vidé, un de 399 jours reste intact ; la ligne et ses métadonnées restent', async () => {
    const t = await w.p.topup();
    const make = (days: number) =>
      insertEvent({
        configId: t.row.configurationId,
        operatorId: w.p.op,
        notification: w.p.notification(t.row),
        status: 'RECEIVED',
        ageDays: days,
        body: Buffer.from('{"corps":"brut"}'),
      });
    const old = await make(401);
    const recent = await make(399);
    expect(PSP_EVENT_BODY_RETENTION_DAYS).toBe(400);
    expect(await proc.purge.runOnce()).toBeGreaterThanOrEqual(1);
    const purged = await row(old);
    expect(purged.body).toBeNull();
    expect(purged.body_purged_at).not.toBeNull();
    expect(purged.kind).toBe('PAYMENT_SUCCEEDED');
    expect(purged.provider_event_id).toBeTruthy();
    const kept = await row(recent);
    expect(kept.body?.toString()).toBe('{"corps":"brut"}');
    expect(kept.body_purged_at).toBeNull();
  });

  it('au plus un passage par intervalle (horloge de Node simulée)', async () => {
    const t = await w.p.topup();
    const id = await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification: w.p.notification(t.row),
      ageDays: 500,
      body: Buffer.from('x'),
    });
    const start = Date.now() + 10 * 3600_000;
    await proc.purge.runOnce(start);
    expect((await row(id)).body).toBeNull();
    const again = await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification: w.p.notification(t.row),
      ageDays: 500,
      body: Buffer.from('y'),
    });
    expect(await proc.purge.runOnce(start + 1000)).toBe(0);
    expect((await row(again)).body).not.toBeNull();
    expect(
      await proc.purge.runOnce(start + proc.purge.intervalSeconds * 1000 + 1),
    ).toBeGreaterThanOrEqual(1);
    expect((await row(again)).body).toBeNull();
  });

  it('PSP_PURGE_INTERVAL_SECONDS : entier de 60 à 86 400, 3 600 par défaut, sinon message nommant la variable', async () => {
    expect(pspPurgeIntervalSeconds(undefined)).toBe(3600);
    expect(pspPurgeIntervalSeconds('')).toBe(3600);
    expect(pspPurgeIntervalSeconds('60')).toBe(60);
    expect(pspPurgeIntervalSeconds('86400')).toBe(86_400);
    for (const bad of ['59', '86401', 'abc', '1.5', '-1'])
      expect(() => pspPurgeIntervalSeconds(bad)).toThrow(/PSP_PURGE_INTERVAL_SECONDS/);
    // Le démarrage du processus échoue de même.
    process.env.PSP_PURGE_INTERVAL_SECONDS = '5';
    try {
      await expect(startPoller(w)).rejects.toThrow(/PSP_PURGE_INTERVAL_SECONDS/);
    } finally {
      delete process.env.PSP_PURGE_INTERVAL_SECONDS;
    }
  });

  it('--list décrit la purge sans rien écrire', async () => {
    expect(await proc.purge.describe()).toEqual([expect.stringContaining('400 jours')]);
  });
});
