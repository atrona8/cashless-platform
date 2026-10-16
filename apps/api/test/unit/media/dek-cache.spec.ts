// Cache court de la clé de données (décision du porteur n° 5 ; NFR-003) : un déchiffrement pour plusieurs demandes,
// durée bornée comptée depuis le déchiffrement, tampon mis à zéro à chaque sortie du cache.
import { DekCache } from '../../../src/media/keys/dek-cache';

const key = () => Buffer.alloc(32, 7);
const zero = Buffer.alloc(32);

describe('cache de la clé de données', () => {
  afterEach(() => jest.useRealTimers());

  it('un seul déchiffrement sert plusieurs demandes, y compris simultanées', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const load = jest.fn(async () => key());
    const seen = await Promise.all(Array.from({ length: 20 }, () => cache.withKey('dek-1', load, (dek) => dek.toString('hex'))));
    await cache.withKey('dek-1', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(seen)).toEqual(new Set([key().toString('hex')]));
    expect(cache.size()).toBe(1);
    cache.onModuleDestroy();
  });

  it('une entrée par clé de données', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const load = jest.fn(async () => key());
    await cache.withKey('dek-1', load, () => undefined);
    await cache.withKey('dek-2', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
    cache.onModuleDestroy();
  });

  it('à l’expiration, la clé sort du cache et son tampon est à zéro ; la durée ne se prolonge pas à l’usage', async () => {
    jest.useFakeTimers();
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const buffer = key();
    const load = jest.fn(async () => buffer);
    await cache.withKey('dek-1', load, () => undefined);
    jest.advanceTimersByTime(200_000);
    await cache.withKey('dek-1', load, () => undefined);
    jest.advanceTimersByTime(99_999);
    expect(cache.size()).toBe(1);
    jest.advanceTimersByTime(1);
    expect(cache.size()).toBe(0);
    expect(buffer.equals(zero)).toBe(true);
    await cache.withKey('dek-1', async () => key(), () => undefined);
    expect(cache.size()).toBe(1);
    cache.onModuleDestroy();
  });

  it('durée nulle : rien n’est gardé, le tampon est effacé dès la fin de la demande', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 0 });
    const buffers: Buffer[] = [];
    const load = jest.fn(async () => {
      buffers.push(key());
      return buffers.at(-1)!;
    });
    expect(await cache.withKey('dek-1', load, (dek) => dek.equals(key()))).toBe(true);
    await cache.withKey('dek-1', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(0);
    expect(buffers.every((b) => b.equals(zero))).toBe(true);
  });

  it('une éviction pendant une demande attend la fin de celle-ci pour effacer le tampon', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const buffer = key();
    let during = false;
    await cache.withKey('dek-1', async () => buffer, async (dek) => {
      cache.evict('dek-1');
      during = dek.equals(key());
    });
    expect(during).toBe(true);
    expect(buffer.equals(zero)).toBe(true);
    expect(cache.size()).toBe(0);
  });

  it('l’arrêt efface tout ; un échec de déchiffrement ne laisse rien en cache', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const buffer = key();
    await cache.withKey('dek-1', async () => buffer, () => undefined);
    await expect(cache.withKey('dek-2', async () => Promise.reject(new Error('service de clés indisponible')), () => undefined)).rejects.toThrow('indisponible');
    expect(cache.size()).toBe(1);
    cache.onModuleDestroy();
    expect(cache.size()).toBe(0);
    expect(buffer.equals(zero)).toBe(true);
  });

  it('une erreur dans la demande n’empêche pas l’effacement', async () => {
    const cache = new DekCache({ tagDekCacheSeconds: 0 });
    const buffer = key();
    await expect(cache.withKey('dek-1', async () => buffer, () => Promise.reject(new Error('boum')))).rejects.toThrow('boum');
    expect(buffer.equals(zero)).toBe(true);
  });
});
