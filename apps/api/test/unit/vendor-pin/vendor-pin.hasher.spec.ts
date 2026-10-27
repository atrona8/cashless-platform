// Empreinte du PIN des vendeurs et test d'argon2 au démarrage (mission 5b, lot WP08, T033 ; FR-003,
// NFR-002, NFR-004, NFR-009 ; A16 ; contracts/vendors.md). Vrai binaire argon2 ; binaires faux
// simulés pour prouver que le test au démarrage refuse le démarrage.
import * as argon2 from 'argon2';
import { loadConfig } from '../../../src/config/config';
import { ProblemException } from '../../../src/errors/problem';
import {
  Argon2SelfTestError,
  checkRfc9106Vector,
  RFC9106_ARGON2ID_TAG,
  runArgon2SelfTest,
} from '../../../src/vendor-pin/argon2-self-test';
import { VendorPinModule } from '../../../src/vendor-pin/vendor-pin.module';
import {
  PIN_PATTERN,
  VendorPinHasher,
  VendorPinHashError,
  type Argon2Impl,
} from '../../../src/vendor-pin/vendor-pin.hasher';

jest.setTimeout(60_000);

const SECRET = Buffer.alloc(32, 0x5a);
const IDEM_SECRET = Buffer.alloc(32, 0x6b);
const PIN = '246813';

describe('VendorPinHasher', () => {
  const hasher = new VendorPinHasher(SECRET, IDEM_SECRET);

  it('empreinte PHC argon2id, paramètres figés lus dans l’empreinte, sel de 16 octets', async () => {
    const digest = await hasher.hash(PIN);
    const match = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      digest,
    );
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(match![2]!, 'base64')).toHaveLength(32);
    expect(digest).not.toContain(PIN);
    // Deux empreintes du même PIN diffèrent (sel aléatoire).
    expect(await hasher.hash(PIN)).not.toBe(digest);
  });

  it('verify : bon PIN vrai, autre PIN faux, autre secret faux', async () => {
    const digest = await hasher.hash(PIN);
    expect(await hasher.verify(digest, PIN)).toBe(true);
    expect(await hasher.verify(digest, '135792')).toBe(false);
    expect(await new VendorPinHasher(Buffer.alloc(32, 0x5b), IDEM_SECRET).verify(digest, PIN)).toBe(
      false,
    );
  });

  it('le secret est appliqué : une empreinte calculée sans secret est refusée', async () => {
    const withoutSecret = await argon2.hash(PIN, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(await hasher.verify(withoutSecret, PIN)).toBe(false);
  });

  it.each(['12345', '1234567', 'abcdef', '12 456', '١٢٣٤٥٦', '', '123456\n'])(
    'PIN hors motif %p : 422 VALIDATION_FAILED, sans écho de la valeur',
    async (pin) => {
      expect(PIN_PATTERN.test(pin)).toBe(false);
      const error = (await hasher.hash(pin).catch((e: unknown) => e)) as ProblemException;
      expect(error).toBeInstanceOf(ProblemException);
      expect([error.status, error.code]).toEqual([422, 'VALIDATION_FAILED']);
      if (pin.length > 0) expect(`${error.message} ${error.detail}`).not.toContain(pin);
    },
  );

  it('verify d’un PIN hors motif : faux, après un vrai calcul', async () => {
    const impl = spyImpl();
    const spied = new VendorPinHasher(SECRET, IDEM_SECRET, impl);
    const digest = await spied.hash(PIN);
    expect(await spied.verify(digest, '12345')).toBe(false);
    expect(impl.verify).toHaveBeenCalled();
  });

  it('NFR-004 : verify(null, …) faux, toujours calculé contre l’empreinte factice, et non instantané', async () => {
    const impl = spyImpl();
    const spied = new VendorPinHasher(SECRET, IDEM_SECRET, impl);
    await spied.ready();
    const digest = await spied.hash(PIN);
    // L'empreinte factice : mêmes paramètres, même secret, entrée de 32 octets (jamais un PIN).
    const dummyCall = impl.hash.mock.calls[0]!;
    expect(Buffer.isBuffer(dummyCall[0]) && dummyCall[0].length).toBe(32);
    expect(dummyCall[1]).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    expect((dummyCall[1] as { secret: Buffer }).secret.equals(SECRET)).toBe(true);
    impl.verify.mockClear();
    for (const pin of [PIN, '000000', 'abc']) expect(await spied.verify(null, pin)).toBe(false);
    expect(impl.verify).toHaveBeenCalledTimes(3);
    const dummyDigest = impl.verify.mock.calls[0]![0];
    expect(dummyDigest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(dummyDigest).not.toBe(digest);
    // Durée : marge large (pas une mesure fine) — le refus sans empreinte coûte au moins le tiers
    // d'une vraie vérification.
    const time = async (fn: () => Promise<unknown>) => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 3; i += 1) await fn();
      return Number(process.hrtime.bigint() - start);
    };
    const real = await time(() => hasher.verify(digest, '135792'));
    const unknown = await time(() => hasher.verify(null, '135792'));
    expect(unknown).toBeGreaterThan(real / 3);
  });

  it('erreur d’argon2 : relancée sans son message (qui pourrait citer l’entrée)', async () => {
    const failing: Argon2Impl = {
      hash: (async () => {
        throw new Error(`entrée ${PIN} refusée`);
      }) as Argon2Impl['hash'],
      verify: async () => {
        throw new Error('empreinte $argon2id$v=19$secret');
      },
    };
    const broken = new VendorPinHasher(SECRET, IDEM_SECRET, failing);
    const hashError = (await broken.hash(PIN).catch((e: unknown) => e)) as Error;
    expect(hashError).toBeInstanceOf(VendorPinHashError);
    expect(hashError.message).not.toContain(PIN);
    const verifyError = (await broken
      .verify('$argon2id$v=19$x', PIN)
      .catch((e: unknown) => e)) as Error;
    expect(verifyError).toBeInstanceOf(VendorPinHashError);
    expect(verifyError.message).not.toMatch(/argon2id\$|246813/);
  });

  it('secret de moins de 32 octets refusé', () => {
    expect(() => new VendorPinHasher(Buffer.alloc(31), IDEM_SECRET)).toThrow(/32 octets/);
    expect(() => new VendorPinHasher(SECRET, Buffer.alloc(31))).toThrow(
      /VENDOR_PIN_IDEMPOTENCY_SECRET : 32 octets/,
    );
    expect(() => new VendorPinHasher(SECRET, Buffer.from(SECRET))).toThrow(/secrets distincts/);
  });
});

/** Vrai argon2 observé. */
function spyImpl() {
  return {
    hash: jest.fn((password: Buffer | string, options?: argon2.Options & { raw?: boolean }) =>
      argon2.hash(password, options as argon2.Options),
    ),
    verify: jest.fn((digest: string, password: Buffer | string, options?: { secret?: Buffer }) =>
      argon2.verify(digest, password, options),
    ),
  } as unknown as Argon2Impl & {
    hash: jest.Mock<Promise<string>, [Buffer | string, argon2.Options?]>;
    verify: jest.Mock<Promise<boolean>, [string, Buffer | string, { secret?: Buffer }?]>;
  };
}

describe('test d’argon2 au démarrage (A16, NFR-009)', () => {
  it('vecteur RFC 9106 §5.3 : étiquette recopiée de la RFC, retrouvée par le binaire chargé', async () => {
    expect(RFC9106_ARGON2ID_TAG.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
    await expect(checkRfc9106Vector()).resolves.toBeUndefined();
  });

  it('auto-test complet avec le vrai binaire et le secret de test : passe', async () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    await expect(
      runArgon2SelfTest(
        new VendorPinHasher(config.vendorPinSecret, config.vendorPinIdempotencySecret),
      ),
    ).resolves.toBeUndefined();
  });

  it('binaire faux (autre étiquette) : démarrage refusé', async () => {
    const wrong: Argon2Impl = {
      hash: (async (password: Buffer | string, options?: argon2.Options & { raw?: boolean }) =>
        options?.raw
          ? Buffer.alloc(32, 0)
          : argon2.hash(password, options as argon2.Options)) as Argon2Impl['hash'],
      verify: argon2.verify,
    };
    await expect(checkRfc9106Vector(wrong)).rejects.toBeInstanceOf(Argon2SelfTestError);
    await expect(
      runArgon2SelfTest(new VendorPinHasher(SECRET, IDEM_SECRET, wrong), wrong),
    ).rejects.toBeInstanceOf(Argon2SelfTestError);
  });

  it('binaire qui ignore le secret : démarrage refusé (vecteur RFC et aller-retour)', async () => {
    const strip = <T extends { secret?: Buffer }>(options?: T) => {
      if (!options) return options;
      const { secret: _s, ...rest } = options;
      return rest as T;
    };
    const ignoresSecret: Argon2Impl = {
      hash: ((password: Buffer | string, options?: argon2.Options & { raw?: boolean }) =>
        argon2.hash(password, strip(options) as argon2.Options)) as Argon2Impl['hash'],
      verify: (digest, password, options) => argon2.verify(digest, password, strip(options)),
    };
    await expect(checkRfc9106Vector(ignoresSecret)).rejects.toThrow(/RFC 9106/);
    // Même avec un vecteur RFC accepté, l'aller-retour détecte le secret ignoré.
    const passesVector: Argon2Impl = {
      hash: ((password: Buffer | string, options?: argon2.Options & { raw?: boolean }) =>
        options?.raw
          ? argon2.hash(password, options as argon2.Options & { raw: true })
          : ignoresSecret.hash(password, options as argon2.Options)) as Argon2Impl['hash'],
      verify: ignoresSecret.verify,
    };
    await expect(
      runArgon2SelfTest(new VendorPinHasher(SECRET, IDEM_SECRET, passesVector), passesVector),
    ).rejects.toThrow(/empreinte sans secret acceptée/);
  });

  it('binaire qui accepte tout : démarrage refusé', async () => {
    const acceptsAll: Argon2Impl = {
      hash: argon2.hash as Argon2Impl['hash'],
      verify: async () => true,
    };
    await expect(
      runArgon2SelfTest(new VendorPinHasher(SECRET, IDEM_SECRET, acceptsAll), acceptsAll),
    ).rejects.toThrow(/autre PIN accepté/);
  });

  it('VendorPinModule.onModuleInit : échec du test → exception (démarrage refusé)', async () => {
    const wrong: Argon2Impl = {
      hash: (async () => '$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA') as unknown as Argon2Impl['hash'],
      verify: async () => false,
    };
    await expect(
      new VendorPinModule(new VendorPinHasher(SECRET, IDEM_SECRET, wrong)).onModuleInit(),
    ).rejects.toBeInstanceOf(Argon2SelfTestError);
    await expect(
      new VendorPinModule(new VendorPinHasher(SECRET, IDEM_SECRET)).onModuleInit(),
    ).resolves.toBeUndefined();
  });

  // ADR-126 : le PIN n'entre dans l'empreinte d'idempotence que sous un dérivé argon2 déterministe.
  describe('idempotencyBody (ADR-126)', () => {
    const hasher = new VendorPinHasher(SECRET, IDEM_SECRET);
    const body = { vendor_id: 'v', pin: PIN };

    it('remplace le PIN par un dérivé argon2 déterministe, sans le PIN en clair', async () => {
      const a = await hasher.idempotencyBody(body, ['pin'], 'device:d:', 'cle-1');
      const b = await hasher.idempotencyBody(body, ['pin'], 'device:d:', 'cle-1');
      expect(a).toEqual(b);
      expect(JSON.stringify(a)).not.toContain(PIN);
      expect(a).toMatchObject({
        vendor_id: 'v',
        pin: expect.stringMatching(/^argon2id:[0-9a-f]{64}$/),
      });
      expect(body.pin).toBe(PIN);
    });

    it('le dérivé change avec le PIN, la clé, la portée et le secret', async () => {
      const pinOf = async (h: VendorPinHasher, pin: string, scope: string, key: string) =>
        ((await h.idempotencyBody({ pin }, ['pin'], scope, key)) as { pin: string }).pin;
      const ref = await pinOf(hasher, PIN, 'bo:', 'k');
      expect(await pinOf(hasher, '000000', 'bo:', 'k')).not.toBe(ref);
      expect(await pinOf(hasher, PIN, 'bo:', 'k2')).not.toBe(ref);
      expect(await pinOf(hasher, PIN, 'device:d:', 'k')).not.toBe(ref);
      expect(
        await pinOf(new VendorPinHasher(SECRET, Buffer.alloc(32, 0x01)), PIN, 'bo:', 'k'),
      ).not.toBe(ref);
    });

    it('le dérivé dépend de VENDOR_PIN_IDEMPOTENCY_SECRET et pas de VENDOR_PIN_SECRET', async () => {
      const derived = async (secret: Buffer, idempotencySecret: Buffer) =>
        (
          (await new VendorPinHasher(secret, idempotencySecret).idempotencyBody(
            { pin: PIN },
            ['pin'],
            'bo:',
            'k',
          )) as { pin: string }
        ).pin;
      const ref = await derived(SECRET, IDEM_SECRET);
      // Autre VENDOR_PIN_SECRET, même secret d'idempotence : dérivé inchangé.
      expect(await derived(Buffer.alloc(32, 0x7c), IDEM_SECRET)).toBe(ref);
      // Autre secret d'idempotence : dérivé différent.
      expect(await derived(SECRET, Buffer.alloc(32, 0x7d))).not.toBe(ref);
      // Et l'empreinte du PIN (hash/verify) ne dépend, elle, que de VENDOR_PIN_SECRET.
      const phc = await new VendorPinHasher(SECRET, IDEM_SECRET).hash(PIN);
      expect(await new VendorPinHasher(SECRET, Buffer.alloc(32, 0x7d)).verify(phc, PIN)).toBe(true);
      expect(await new VendorPinHasher(Buffer.alloc(32, 0x7c), IDEM_SECRET).verify(phc, PIN)).toBe(
        false,
      );
    });

    it('valeur qui n’est pas un PIN : repère constant sans argon2 ; corps non objet inchangé', async () => {
      const impl = { hash: jest.fn(), verify: jest.fn() } as unknown as Argon2Impl;
      const guarded = new VendorPinHasher(SECRET, IDEM_SECRET, impl);
      expect(await guarded.idempotencyBody({ pin: '12' }, ['pin'], 's', 'k')).toEqual({
        pin: 'pin-invalide',
      });
      expect(await guarded.idempotencyBody({ pin: 123456 }, ['pin'], 's', 'k')).toEqual({
        pin: 'pin-invalide',
      });
      expect(await guarded.idempotencyBody({ autre: 1 }, ['pin'], 's', 'k')).toEqual({ autre: 1 });
      expect(await guarded.idempotencyBody(null, ['pin'], 's', 'k')).toBeNull();
      expect(impl.hash).not.toHaveBeenCalled();
    });
  });
});
