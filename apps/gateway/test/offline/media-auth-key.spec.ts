// getMediaAuthKey sur la passerelle (WP23, T106/T107) : colis rescellé pour le terminal.
import { deviceAad, fromWrappedKey, openForRecipient } from '@cashless/tag-format';
import { makeBench, type Bench, type OfflineDevice, type SeedMediaResult } from './_support/bench';
import type { Loose } from '../support/loose';

let b: Bench;
let dev: OfflineDevice;
let media: SeedMediaResult;

async function setup(options: Parameters<typeof makeBench>[0] = {}): Promise<void> {
  b = await makeBench({ media: { floorMs: 150, perMinute: 60 }, ...options });
  dev = await b.newDevice();
  media = await b.seedMedia({ balancePaid: 100, pwdPack: Buffer.from('PWD1PK') });
  await b.setPackKey();
}
afterEach(async () => {
  await b.close();
});

const ask = (d: OfflineDevice, uid: Buffer, keyIndex = 0) =>
  b.request(d, {
    method: 'POST',
    path: '/v1/media/auth-keys',
    body: { nfc_uid: uid.toString('hex'), key_index: keyIndex },
    idempotencyKey: undefined,
  });
const open = (d: OfflineDevice, enc: Loose, uid: Buffer): Buffer =>
  openForRecipient({
    recipientPrivateKey: d.agreement.privateScalar,
    blob: enc.alg === undefined ? fromWrappedKey(enc) : enc,
    aad: deviceAad(d.deviceId, uid),
  });

describe('getMediaAuthKey', () => {
  it('le terminal retrouve le PWD||PACK ; ttl 60 s ; jamais de cache', async () => {
    await setup();
    const res = await ask(dev, media.uid);
    expect(res.status).toBe(200);
    const body = res.json as Record<string, Loose>;
    expect(body).toMatchObject({
      nfc_uid: media.uid.toString('hex'),
      key_index: 0,
      ttl_seconds: 60,
    });
    expect(open(dev, body.enc, media.uid).toString()).toBe('PWD1PK');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('PWD1PK');
  });

  it('un autre terminal (mauvaise clé d’accord) ne peut pas ouvrir le colis', async () => {
    await setup();
    const other = await b.newDevice();
    const body = (await ask(dev, media.uid)).json as Record<string, Loose>;
    expect(() => open(other, body.enc, media.uid)).toThrow();
  });

  it('MEDIA_UNKNOWN : 404 au même délai plancher qu’un succès, même corps pour toutes les causes', async () => {
    await setup();
    const ok = await ask(dev, media.uid);
    const unknown = await ask(dev, Buffer.alloc(7, 9));
    const wrongIndex = await ask(dev, media.uid, 5);
    expect(unknown.status).toBe(404);
    expect((unknown.json as Loose).code).toBe('MEDIA_UNKNOWN');
    expect(Math.abs(unknown.elapsedMs - ok.elapsedMs)).toBeLessThan(80);
    expect(unknown.elapsedMs).toBeGreaterThanOrEqual(140);
    expect(ok.elapsedMs).toBeGreaterThanOrEqual(140);
    expect((wrongIndex.json as Loose).code).toBe('MEDIA_UNKNOWN');
  });

  it('429 au-delà de la limite par terminal ; un autre terminal n’est pas touché', async () => {
    await setup({ media: { floorMs: 0, perMinute: 3 } });
    for (let i = 0; i < 3; i += 1) expect((await ask(dev, media.uid)).status).toBe(200);
    const limited = await ask(dev, media.uid);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    const other = await b.newDevice();
    expect((await ask(other, media.uid)).status).toBe(200);
  });

  it('STANDBY non promue (ni clé de contenu ni colis) : 404, sans détail', async () => {
    await setup();
    await b.q('DELETE FROM edge_pwd_pack_key');
    const res = await ask(dev, media.uid);
    expect(res.status).toBe(404);
    expect((res.json as Loose).code).toBe('MEDIA_UNKNOWN');
    await b.setPackKey();
    await b.q('UPDATE edge_media SET pwd_pack_enc = NULL');
    expect((await ask(dev, media.uid)).status).toBe(404);
  });

  it('clé d’accord détruite (purge) : 404 sans détail, aucun secret dans la réponse', async () => {
    await setup();
    await b.keystore.destroy('agreement');
    const res = await ask(dev, media.uid);
    expect(res.status).toBe(404);
    expect((res.json as Loose).code).toBe('MEDIA_UNKNOWN');
    expect(res.text).not.toMatch(/PWD1PK|stack|Error/);
  });

  it('requête mal formée : 400', async () => {
    await setup();
    const res = await b.request(dev, {
      method: 'POST',
      path: '/v1/media/auth-keys',
      body: { nfc_uid: 'zz', key_index: 0 },
    });
    expect(res.status).toBe(400);
  });
});
