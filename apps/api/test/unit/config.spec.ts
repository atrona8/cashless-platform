// Configuration lue dans l'environnement : pools applicatif et de plateforme (contrat platform-access).
import { claimAdminSettings, loadConfig, vendorPinSettings } from '../../src/config/config';
import { ClaimHasher, assertClaimKeyVersion } from '../../src/kms/claim-hash';
import { DEVICE_PRODUCTION } from '../support/tls';

const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://cashless_app:secret@db.internal:5432/cashless',
  DATABASE_URL_PLATFORM: 'postgres://cashless_platform:secret@db.internal:5432/cashless',
  OIDC_ISSUER: 'https://id.cashless.example',
  OIDC_AUDIENCE: 'cashless-api',
  OIDC_APPROVAL_AUDIENCE: 'cashless-approval',
  OIDC_JWKS_URI: 'https://id.cashless.example/.well-known/jwks.json',
  CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
  TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
  CLAIM_CODE_DOMAIN: 'pay.example.org',
  TRUST_PROXY_HOPS: '1',
  // Mission identite-enrolement-terminaux : réglages obligatoires en production.
  ...DEVICE_PRODUCTION,
};

/** Hors production : `NODE_ENV` reste obligatoire (RISK-3). */
const LOCAL = { NODE_ENV: 'test' };

const PIN_PRODUCTION = {
  NODE_ENV: 'production',
  VENDOR_PIN_SECRET: '04'.repeat(32),
  VENDOR_PIN_CALL_KEY: '3c'.repeat(32),
  DATABASE_URL_PIN: 'postgres://cashless_pin:secret@db.internal:5432/cashless',
};

describe('loadConfig', () => {
  it('hors production : défauts locaux des deux pools', () => {
    const config = loadConfig(LOCAL);
    expect(config.production).toBe(false);
    expect(config.databaseUrl).toBe(
      'postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test',
    );
    expect(config.platformDatabaseUrl).toBe(
      'postgres://cashless_platform:cashless_platform_local@127.0.0.1:5433/cashless_test',
    );
    expect(config.poolSize).toBe(10);
    expect(config.platformPoolSize).toBe(2);
  });

  it('lit DATABASE_URL_PLATFORM et DB_PLATFORM_POOL_SIZE', () => {
    const config = loadConfig({
      ...LOCAL,
      DATABASE_URL_PLATFORM: 'postgres://cashless_platform:x@h:5432/d',
      DB_PLATFORM_POOL_SIZE: '4',
    });
    expect(config.platformDatabaseUrl).toBe('postgres://cashless_platform:x@h:5432/d');
    expect(config.platformPoolSize).toBe(4);
  });

  it('les deux pools restent distincts', () => {
    const config = loadConfig(PRODUCTION);
    expect(config.platformDatabaseUrl).not.toBe(config.databaseUrl);
  });

  it.each(['0', '-1', 'deux'])('DB_PLATFORM_POOL_SIZE invalide (%s) : refus', (value) => {
    expect(() => loadConfig({ ...LOCAL, DB_PLATFORM_POOL_SIZE: value })).toThrow(
      /DB_PLATFORM_POOL_SIZE/,
    );
  });

  it('production : DATABASE_URL_PLATFORM obligatoire', () => {
    const { DATABASE_URL_PLATFORM: _omitted, ...withoutPlatform } = PRODUCTION;
    expect(() => loadConfig(withoutPlatform)).toThrow(/DATABASE_URL_PLATFORM manquant/);
    expect(loadConfig(PRODUCTION).platformDatabaseUrl).toBe(PRODUCTION.DATABASE_URL_PLATFORM);
  });

  it('production : DATABASE_URL_APP toujours obligatoire', () => {
    const { DATABASE_URL_APP: _omitted, ...withoutApp } = PRODUCTION;
    expect(() => loadConfig(withoutApp)).toThrow(/DATABASE_URL_APP manquant/);
  });

  // Mission bracelets-nfc : rôles de base des processus des clés, secret des codes, cache de la clé de données.
  it('hors production : défauts locaux des quatre processus des clés et secret de test', () => {
    const config = loadConfig(LOCAL);
    expect(config.tagKeysDatabaseUrl).toContain('cashless_tagkeys:');
    expect(config.personalizationDatabaseUrl).toContain('cashless_perso:');
    expect(config.tagCheckDatabaseUrl).toContain('cashless_tagcheck:');
    expect(config.keyAdminDatabaseUrl).toContain('cashless_keyadmin:');
    expect(config.maintenanceDatabaseUrl).toContain('cashless_maint:');
    expect(config.claimCodeHmacKey.length).toBeGreaterThanOrEqual(32);
    expect(config.tagDekCacheSeconds).toBe(300);
    expect(config.tagWrappingKeyRef).toBe('fake-kms:wrap:test');
  });

  it('production : secret des codes obligatoire, 32 octets au moins', () => {
    const { CLAIM_CODE_HMAC_KEY: _key, ...withoutKey } = PRODUCTION;
    expect(() => loadConfig(withoutKey)).toThrow(/CLAIM_CODE_HMAC_KEY/);
    expect(() => loadConfig({ ...PRODUCTION, CLAIM_CODE_HMAC_KEY: 'abcd' })).toThrow(/32 octets/);
    expect(
      loadConfig({ ...PRODUCTION, CLAIM_CODE_HMAC_KEY: Buffer.alloc(32, 7).toString('base64') })
        .claimCodeHmacKey,
    ).toHaveLength(32);
    expect(loadConfig(PRODUCTION).claimCodeHmacKey.equals(Buffer.alloc(32, 0xab))).toBe(true);
  });

  it('production : aucune chaîne de connexion par défaut pour les processus des clés', () => {
    const config = loadConfig(PRODUCTION);
    expect([
      config.tagKeysDatabaseUrl,
      config.personalizationDatabaseUrl,
      config.tagCheckDatabaseUrl,
      config.keyAdminDatabaseUrl,
      config.maintenanceDatabaseUrl,
    ]).toEqual(['', '', '', '', '']);
    expect(config.tagWrappingKeyRef).toBe(PRODUCTION.TAG_WRAPPING_KEY_REF);
  });

  it('DATABASE_URL_MAINT : lue telle quelle, vide acceptée au chargement en production', () => {
    const url = 'postgres://cashless_maint:x@h:5432/d';
    expect(loadConfig({ ...LOCAL, DATABASE_URL_MAINT: url }).maintenanceDatabaseUrl).toBe(url);
    expect(loadConfig({ ...PRODUCTION, DATABASE_URL_MAINT: '' }).maintenanceDatabaseUrl).toBe('');
  });

  // Revue post-fusion de bracelets-nfc, RISK-4 : refus au chargement, plus seulement à la première
  // utilisation.
  it('production : clé d’emballage obligatoire, refusée vide au chargement', () => {
    const { TAG_WRAPPING_KEY_REF: _ref, ...withoutRef } = PRODUCTION;
    expect(() => loadConfig(withoutRef)).toThrow(/TAG_WRAPPING_KEY_REF manquant/);
    expect(() => loadConfig({ ...PRODUCTION, TAG_WRAPPING_KEY_REF: '' })).toThrow(
      /TAG_WRAPPING_KEY_REF manquant/,
    );
  });

  // RISK-3 : la garde « aucun faux en production » ne dépend plus d'un NODE_ENV présent et bien
  // écrit.
  it.each([undefined, '', 'prod', 'staging', 'Production', 'PRODUCTION', ' production'])(
    'NODE_ENV absent ou inconnu (%p) : refus de démarrer',
    (value) => {
      const env = value === undefined ? {} : { NODE_ENV: value };
      expect(() => loadConfig(env)).toThrow(/NODE_ENV (manquant|inconnu)/);
      expect(() => loadConfig({ ...PRODUCTION, NODE_ENV: value })).toThrow(/NODE_ENV/);
    },
  );

  it.each(['development', 'test'])('NODE_ENV=%s : hors production, faux permis', (value) => {
    expect(loadConfig({ NODE_ENV: value }).production).toBe(false);
  });

  it('TRUST_PROXY_HOPS (OP-N53) : obligatoire en production, entier de 0 à 5, 0 hors production', () => {
    const { TRUST_PROXY_HOPS: _hops, ...withoutHops } = PRODUCTION;
    expect(() => loadConfig(withoutHops)).toThrow(/TRUST_PROXY_HOPS manquant/);
    expect(() => loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '' })).toThrow(
      /TRUST_PROXY_HOPS manquant/,
    );
    for (const bad of ['true', '-1', '6', '1.5', 'loopback', ' 1'])
      expect(() => loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: bad })).toThrow(/entier de 0 à 5/);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
    expect(loadConfig(LOCAL).trustProxyHops).toBe(0);
    expect(() => loadConfig({ ...LOCAL, TRUST_PROXY_HOPS: '9' })).toThrow(/entier de 0 à 5/);
  });

  it('domaine des liens des bracelets : défaut, minuscules, obligatoire en production', () => {
    expect(loadConfig(LOCAL).claimCodeDomain).toBe('pay.cashless.test');
    expect(loadConfig({ ...LOCAL, CLAIM_CODE_DOMAIN: 'Pay.Example.ORG' }).claimCodeDomain).toBe(
      'pay.example.org',
    );
    expect(loadConfig(PRODUCTION).claimCodeDomain).toBe('pay.example.org');
    const { CLAIM_CODE_DOMAIN: _domain, ...withoutDomain } = PRODUCTION;
    expect(() => loadConfig(withoutDomain)).toThrow(/CLAIM_CODE_DOMAIN manquant/);
  });

  it.each([
    'https://pay.example.org',
    'pay.example.org/c',
    'pay example.org',
    'localhost',
    '-pay.example.org',
  ])('CLAIM_CODE_DOMAIN mal formé (%s) : refus', (value) => {
    expect(() => loadConfig({ ...LOCAL, CLAIM_CODE_DOMAIN: value })).toThrow(/CLAIM_CODE_DOMAIN/);
  });

  it.each(['0', '1', '300'])('TAG_DEK_CACHE_SECONDS valide (%s)', (value) => {
    expect(loadConfig({ ...LOCAL, TAG_DEK_CACHE_SECONDS: value }).tagDekCacheSeconds).toBe(
      Number(value),
    );
  });

  it.each(['-1', '301', '5.5', 'cinq'])(
    'TAG_DEK_CACHE_SECONDS hors bornes (%s) : refus',
    (value) => {
      expect(() => loadConfig({ ...LOCAL, TAG_DEK_CACHE_SECONDS: value })).toThrow(
        /TAG_DEK_CACHE_SECONDS/,
      );
    },
  );

  // ----- Mission identite-enrolement-terminaux (T036) -----

  // `VENDOR_PIN_SECRET` n'est plus exigé de l'API (WP04) : il l'est de `vendorPinSettings`.
  it.each(Object.keys(DEVICE_PRODUCTION).filter((name) => name !== 'VENDOR_PIN_SECRET'))(
    'production : %s obligatoire, absent ou vide refusé',
    (name) => {
      const { [name]: _omitted, ...without } = PRODUCTION as Record<string, string>;
      expect(() => loadConfig(without)).toThrow(new RegExp(`${name} manquant`));
      expect(() => loadConfig({ ...PRODUCTION, [name]: '' })).toThrow(
        new RegExp(`${name} manquant`),
      );
    },
  );

  it('production : réglages complets lus tels quels', () => {
    const config = loadConfig(PRODUCTION);
    expect(config).toMatchObject({
      tlsCertFile: '/etc/cashless/tls/server.crt',
      tlsKeyFile: '/etc/cashless/tls/server.key',
      deviceCaCertFile: '/etc/cashless/tls/device-ca.crt',
      deviceCaFakeKeyFile: null,
      deviceTokenIssuer: 'https://api.cashless.example',
      deviceTokenTtlSeconds: 900,
      deviceRefreshTokenTtlDays: 30,
      deviceCertValidityDays: 365,
      androidAttestationRoots: '/etc/cashless/attestation/google-roots.pem',
      androidAppPackage: 'org.cashless.terminal',
      androidAppSigningDigests: ['cd'.repeat(32)],
      androidMinPatchLevel: 202501,
      iosAppAttestRoot: '/etc/cashless/attestation/apple-app-attest-root.pem',
      iosTeamId: 'ABCDE12345',
      iosBundleId: 'org.cashless.terminal',
      iosAppAttestEnvironment: 'production',
      clockToleranceSeconds: 120,
    });
    expect(config.idempotencyHmacKey.equals(Buffer.alloc(32, 0x01))).toBe(true);
    expect(config.enrollmentCodeHmacKey.equals(Buffer.alloc(32, 0x02))).toBe(true);
    expect(vendorPinSettings(PIN_PRODUCTION).vendorPinSecret.equals(Buffer.alloc(32, 0x04))).toBe(
      true,
    );
  });

  it('hors production : valeurs de test, aucun certificat (écoute en clair permise)', () => {
    const config = loadConfig(LOCAL);
    expect(config).toMatchObject({
      tlsCertFile: null,
      tlsKeyFile: null,
      deviceCaCertFile: null,
      deviceCaFakeKeyFile: null,
      deviceTokenIssuer: 'https://api.cashless.test',
      deviceTokenTtlSeconds: 900,
      deviceRefreshTokenTtlDays: 30,
      deviceCertValidityDays: 365,
      androidAttestationRoots: null,
      iosAppAttestRoot: null,
      iosAppAttestEnvironment: 'development',
      clockToleranceSeconds: 120,
    });
    expect(config.idempotencyHmacKey.length).toBeGreaterThanOrEqual(32);
    expect(config.enrollmentCodeHmacKey.length).toBeGreaterThanOrEqual(32);
    expect(vendorPinSettings(LOCAL).vendorPinSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('production : la clé de l’autorité DE TEST des terminaux fait refuser le démarrage', () => {
    expect(() =>
      loadConfig({ ...PRODUCTION, DEVICE_CA_FAKE_KEY_FILE: '/tmp/device-ca.key' }),
    ).toThrow(/DEVICE_CA_FAKE_KEY_FILE posé/);
    expect(
      loadConfig({ ...LOCAL, DEVICE_CA_FAKE_KEY_FILE: '/tmp/device-ca.key' }).deviceCaFakeKeyFile,
    ).toBe('/tmp/device-ca.key');
  });

  it('TLS : certificat et clé ensemble ; autorité des terminaux exigée dès que TLS est configuré', () => {
    expect(() => loadConfig({ ...LOCAL, TLS_CERT_FILE: '/c.crt' })).toThrow(/les deux ou aucun/);
    expect(() => loadConfig({ ...LOCAL, TLS_KEY_FILE: '/c.key' })).toThrow(/les deux ou aucun/);
    expect(() => loadConfig({ ...LOCAL, TLS_CERT_FILE: '/c.crt', TLS_KEY_FILE: '/c.key' })).toThrow(
      /DEVICE_CA_CERT_FILE manquant/,
    );
    const config = loadConfig({
      ...LOCAL,
      TLS_CERT_FILE: '/c.crt',
      TLS_KEY_FILE: '/c.key',
      DEVICE_CA_CERT_FILE: '/ca.crt',
    });
    expect([config.tlsCertFile, config.tlsKeyFile, config.deviceCaCertFile]).toEqual([
      '/c.crt',
      '/c.key',
      '/ca.crt',
    ]);
  });

  it.each([
    ['DEVICE_TOKEN_TTL_SECONDS', ['59', '901', '3601', '0', '-1', '9.5', 'quinze'], ['60', '900']],
    ['DEVICE_REFRESH_TOKEN_TTL_DAYS', ['0', '91', '1.5', 'trente'], ['1', '90']],
    ['DEVICE_CERT_VALIDITY_DAYS', ['0', '731', '-1', '365 '], ['1', '730']],
    ['CLOCK_TOLERANCE_SECONDS', ['301', '-1', '1e2', 'deux'], ['0', '300']],
  ])('%s : bornes', (name, bad, good) => {
    for (const value of bad)
      expect(() => loadConfig({ ...PRODUCTION, [name]: value })).toThrow(new RegExp(name));
    for (const value of good)
      expect(() => loadConfig({ ...PRODUCTION, [name]: value })).not.toThrow();
  });

  it('DEVICE_TOKEN_TTL_SECONDS : 900 s au plus en production, 3600 s ailleurs (DRIFT-2)', () => {
    expect(() => loadConfig({ ...PRODUCTION, DEVICE_TOKEN_TTL_SECONDS: '901' })).toThrow(
      /DEVICE_TOKEN_TTL_SECONDS : entier de 60 à 900 attendu/,
    );
    expect(() => loadConfig({ ...PRODUCTION, DEVICE_TOKEN_TTL_SECONDS: '3600' })).toThrow(
      /DEVICE_TOKEN_TTL_SECONDS/,
    );
    expect(
      loadConfig({ ...PRODUCTION, DEVICE_TOKEN_TTL_SECONDS: '900' }).deviceTokenTtlSeconds,
    ).toBe(900);
    expect(loadConfig({ ...LOCAL, DEVICE_TOKEN_TTL_SECONDS: '3600' }).deviceTokenTtlSeconds).toBe(
      3600,
    );
    expect(() => loadConfig({ ...LOCAL, DEVICE_TOKEN_TTL_SECONDS: '3601' })).toThrow(
      /DEVICE_TOKEN_TTL_SECONDS/,
    );
    // Défaut inchangé hors production ; en production, la valeur reste obligatoire.
    expect(loadConfig(LOCAL).deviceTokenTtlSeconds).toBe(900);
    const { DEVICE_TOKEN_TTL_SECONDS: _ttl, ...withoutTtl } = PRODUCTION;
    expect(() => loadConfig(withoutTtl)).toThrow(/DEVICE_TOKEN_TTL_SECONDS manquant/);
  });

  it.each([
    'IDEMPOTENCY_HMAC_KEY',
    'ENROLLMENT_CODE_HMAC_KEY',
    'VENDOR_PIN_CALL_KEY',
    'VENDOR_PIN_IDEMPOTENCY_SECRET',
  ])('%s : 32 octets au moins, hexadécimal ou base64', (name) => {
    for (const env of [PRODUCTION, LOCAL]) {
      expect(() => loadConfig({ ...env, [name]: 'abcd' })).toThrow(/32 octets/);
      expect(() => loadConfig({ ...env, [name]: '0f'.repeat(31) })).toThrow(/32 octets/);
    }
    const config = loadConfig({ ...PRODUCTION, [name]: Buffer.alloc(48, 9).toString('base64') });
    const key = {
      IDEMPOTENCY_HMAC_KEY: config.idempotencyHmacKey,
      ENROLLMENT_CODE_HMAC_KEY: config.enrollmentCodeHmacKey,
      VENDOR_PIN_CALL_KEY: config.vendorPinCallKey,
      VENDOR_PIN_IDEMPOTENCY_SECRET: config.vendorPinIdempotencySecret,
    }[name]!;
    expect(key.equals(Buffer.alloc(48, 9))).toBe(true);
  });

  it('les trois secrets HMAC sont distincts deux à deux', () => {
    expect(() =>
      loadConfig({ ...PRODUCTION, IDEMPOTENCY_HMAC_KEY: PRODUCTION.CLAIM_CODE_HMAC_KEY }),
    ).toThrow(/CLAIM_CODE_HMAC_KEY et IDEMPOTENCY_HMAC_KEY : secrets distincts/);
    expect(() =>
      loadConfig({ ...PRODUCTION, ENROLLMENT_CODE_HMAC_KEY: PRODUCTION.CLAIM_CODE_HMAC_KEY }),
    ).toThrow(/CLAIM_CODE_HMAC_KEY et ENROLLMENT_CODE_HMAC_KEY/);
    expect(() =>
      loadConfig({ ...PRODUCTION, ENROLLMENT_CODE_HMAC_KEY: PRODUCTION.IDEMPOTENCY_HMAC_KEY }),
    ).toThrow(/IDEMPOTENCY_HMAC_KEY et ENROLLMENT_CODE_HMAC_KEY/);
    // Même octets écrits autrement (base64 au lieu d'hexadécimal) : toujours refusé.
    expect(() =>
      loadConfig({
        ...PRODUCTION,
        IDEMPOTENCY_HMAC_KEY: Buffer.alloc(32, 0x02).toString('base64'),
      }),
    ).toThrow(/secrets distincts/);
    const local = loadConfig(LOCAL);
    expect(local.idempotencyHmacKey.equals(local.enrollmentCodeHmacKey)).toBe(false);
    expect(local.idempotencyHmacKey.equals(local.claimCodeHmacKey)).toBe(false);
  });

  // ----- Mission 5b (lot WP08, T033 ; NFR-009, research R-10) -----

  it('WP04 : loadConfig de production sans VENDOR_PIN_SECRET réussit, sans substituer le secret de test', () => {
    const { VENDOR_PIN_SECRET: _omitted, ...without } = PRODUCTION;
    const config = loadConfig(without);
    expect(config.production).toBe(true);
    // Le champ n'existe plus dans `AppConfig` (WP07) ; seul `vendorPinSettings` lit le secret.
    expect('vendorPinSecret' in config).toBe(false);
    expect(vendorPinSettings(LOCAL).vendorPinSecret.toString('utf8')).toMatch(/de-test-uniquement/);
  });

  it('VENDOR_PIN_CALL_KEY : manquante en production → refus ; défaut de test hors production, distinct des autres', () => {
    const { VENDOR_PIN_CALL_KEY: _omitted, ...without } = PRODUCTION;
    expect(() => loadConfig(without)).toThrow(/VENDOR_PIN_CALL_KEY manquant/);
    expect(() => loadConfig({ ...PRODUCTION, VENDOR_PIN_CALL_KEY: '' })).toThrow(
      /VENDOR_PIN_CALL_KEY manquant/,
    );
    const local = loadConfig(LOCAL);
    expect(local.vendorPinCallKey.toString('utf8')).toBe(
      'cashless-vendor-pin-call-key-de-test-uniquement-000',
    );
    for (const key of [
      local.claimCodeHmacKey,
      local.idempotencyHmacKey,
      local.enrollmentCodeHmacKey,
      vendorPinSettings(LOCAL).vendorPinSecret,
      local.vendorPinIdempotencySecret,
      local.customerAuthHmacKey,
    ])
      expect(local.vendorPinCallKey.equals(key)).toBe(false);
    expect(loadConfig(PRODUCTION).vendorPinCallKey.equals(Buffer.alloc(32, 0x3c))).toBe(true);
  });

  it('VENDOR_PIN_CALL_KEY : distincte de chaque autre secret, même écrite en base64', () => {
    for (const other of [
      'CLAIM_CODE_HMAC_KEY',
      'IDEMPOTENCY_HMAC_KEY',
      'ENROLLMENT_CODE_HMAC_KEY',
      'CUSTOMER_AUTH_HMAC_KEY',
      'VENDOR_PIN_IDEMPOTENCY_SECRET',
    ]) {
      const value = (PRODUCTION as Record<string, string>)[other]!;
      expect(() => loadConfig({ ...PRODUCTION, VENDOR_PIN_CALL_KEY: value })).toThrow(
        new RegExp(
          `(${other} et VENDOR_PIN_CALL_KEY|VENDOR_PIN_CALL_KEY et ${other}) : secrets distincts`,
        ),
      );
      const asBase64 = Buffer.from(value, 'hex').toString('base64');
      expect(() => loadConfig({ ...PRODUCTION, VENDOR_PIN_CALL_KEY: asBase64 })).toThrow(
        new RegExp(
          `(${other} et VENDOR_PIN_CALL_KEY|VENDOR_PIN_CALL_KEY et ${other}) : secrets distincts`,
        ),
      );
    }
  });

  describe('VENDOR_PIN_URL', () => {
    it('défaut local hors production ; absente en production : chaîne vide', () => {
      expect(loadConfig(LOCAL).vendorPinUrl).toBe('http://127.0.0.1:3003');
      expect(loadConfig(PRODUCTION).vendorPinUrl).toBe('');
      expect(loadConfig({ ...PRODUCTION, VENDOR_PIN_URL: '' }).vendorPinUrl).toBe('');
    });

    it('https accepté en production ; http refusé en production, accepté hors production', () => {
      expect(
        loadConfig({ ...PRODUCTION, VENDOR_PIN_URL: 'https://pin.internal:3003' }).vendorPinUrl,
      ).toBe('https://pin.internal:3003');
      expect(
        loadConfig({ ...PRODUCTION, VENDOR_PIN_URL: 'https://pin.internal:3003/' }).vendorPinUrl,
      ).toBe('https://pin.internal:3003');
      expect(() =>
        loadConfig({ ...PRODUCTION, VENDOR_PIN_URL: 'http://pin.internal:3003' }),
      ).toThrow(/VENDOR_PIN_URL : https obligatoire en production/);
      expect(loadConfig({ ...LOCAL, VENDOR_PIN_URL: 'http://pin:3003' }).vendorPinUrl).toBe(
        'http://pin:3003',
      );
    });

    it.each([
      ['un chemin', 'https://pin.internal/v1/pin'],
      ['une requête', 'https://pin.internal/?a=1'],
      ['une requête vide', 'https://pin.internal/?'],
      ['un fragment', 'https://pin.internal/#x'],
      ['des identifiants', 'https://user:pass@pin.internal'],
      ['un schéma inattendu', 'ftp://pin.internal'],
      ['une URL illisible', 'pas une url'],
    ])('refuse %s, en production comme hors production', (_label, value) => {
      for (const env of [PRODUCTION, LOCAL])
        expect(() => loadConfig({ ...env, VENDOR_PIN_URL: value })).toThrow(/VENDOR_PIN_URL/);
    });

    it('le message ne reproduit pas les identifiants posés', () => {
      let message = '';
      try {
        loadConfig({ ...PRODUCTION, VENDOR_PIN_URL: 'https://user:s3cr3t@pin.internal' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/VENDOR_PIN_URL/);
      expect(message).not.toContain('s3cr3t');
    });
  });

  it('DATABASE_URL_PIN : défaut local hors production, vide en production si absente, sinon lue', () => {
    expect(loadConfig(LOCAL).pinDatabaseUrl).toBe(
      'postgres://cashless_pin:cashless_pin_local@127.0.0.1:5433/cashless_test',
    );
    expect(loadConfig(PRODUCTION).pinDatabaseUrl).toBe('');
    expect(
      loadConfig({ ...PRODUCTION, DATABASE_URL_PIN: 'postgres://cashless_pin:x@db/c' })
        .pinDatabaseUrl,
    ).toBe('postgres://cashless_pin:x@db/c');
  });

  describe('IBAN_KEYRING', () => {
    const key = (byte: number, length = 32): string =>
      Buffer.alloc(length, byte).toString('base64');
    const ring = (value: string, active?: string) => ({
      ...PRODUCTION,
      IBAN_KEYRING: value,
      ...(active === undefined ? {} : { IBAN_ACTIVE_KID: active }),
    });

    it('fixture de production : un kid, clé de 32 octets, kid actif désigné', () => {
      const config = loadConfig(PRODUCTION);
      expect([...config.ibanKeyring.keys()]).toEqual(['k1']);
      expect(config.ibanKeyring.get('k1')!.equals(Buffer.alloc(32, 0x08))).toBe(true);
      expect(config.ibanActiveKid).toBe('k1');
    });

    it('rotation : deux kid, le kid actif est celui désigné', () => {
      const value = `k1:${key(1)},k2:${key(2)}`;
      const first = loadConfig(ring(value, 'k1'));
      const second = loadConfig(ring(value, 'k2'));
      expect([...second.ibanKeyring.keys()]).toEqual(['k1', 'k2']);
      expect(first.ibanActiveKid).toBe('k1');
      expect(second.ibanActiveKid).toBe('k2');
      expect(second.ibanKeyring.get('k2')!.equals(Buffer.alloc(32, 2))).toBe(true);
    });

    it('hors production : sans anneau, clé de test et kid « test »', () => {
      const local = loadConfig(LOCAL);
      expect([...local.ibanKeyring.keys()]).toEqual(['test']);
      expect(local.ibanKeyring.get('test')!.length).toBe(32);
      expect(local.ibanActiveKid).toBe('test');
    });

    it('production sans anneau (absent ou vide) → refus', () => {
      const { IBAN_KEYRING: _omitted, ...without } = PRODUCTION;
      expect(() => loadConfig(without)).toThrow(
        'IBAN_KEYRING manquant : anneau de clés d’IBAN obligatoire en production',
      );
      expect(() => loadConfig({ ...PRODUCTION, IBAN_KEYRING: '' })).toThrow(
        /IBAN_KEYRING manquant/,
      );
    });

    it('clé de test posée en production → refus, même avec une autre clé valide dans l’anneau', () => {
      const testKey = loadConfig(LOCAL).ibanKeyring.get('test')!.toString('base64');
      expect(() => loadConfig(ring(`test:${testKey}`, 'test'))).toThrow(
        'IBAN_KEYRING : clé de test refusée en production',
      );
      expect(() => loadConfig(ring(`k1:${key(1)},k2:${testKey}`, 'k1'))).toThrow(
        'IBAN_KEYRING : clé de test refusée en production',
      );
      // Hors production, la même valeur posée est acceptée.
      expect(
        loadConfig({ NODE_ENV: 'test', IBAN_KEYRING: `test:${testKey}`, IBAN_ACTIVE_KID: 'test' })
          .ibanActiveKid,
      ).toBe('test');
    });

    it.each([
      ['31 octets', `k1:${key(1, 31)}`],
      ['33 octets', `k1:${key(1, 33)}`],
      ['64 octets', `k1:${key(1, 64)}`],
      ['base64 invalide', 'k1:@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@='],
      ['base64 non canonique (bits résiduels)', `k1:${key(1).slice(0, 42)}B=`],
      ['clé vide', 'k1:'],
      ['sans kid', `:${key(1)}`],
      ['sans « : »', key(1)],
      ['élément vide', `k1:${key(1)},`],
      ['kid trop long', `${'a'.repeat(33)}:${key(1)}`],
      ['kid avec un caractère interdit', `k 1:${key(1)}`],
      ['kid en double', `k1:${key(1)},k1:${key(2)}`],
    ])('anneau invalide (%s) → refus, en production comme hors production', (_label, value) => {
      for (const env of [ring(value, 'k1'), { NODE_ENV: 'test', IBAN_KEYRING: value }])
        expect(() => loadConfig({ ...env, IBAN_ACTIVE_KID: 'k1' })).toThrow(/IBAN_KEYRING/);
    });

    it('IBAN_ACTIVE_KID : absent en production, absent de l’anneau, ou sans anneau → refus', () => {
      const { IBAN_ACTIVE_KID: _omitted, ...without } = PRODUCTION;
      expect(() => loadConfig(without)).toThrow(/IBAN_ACTIVE_KID manquant/);
      expect(() => loadConfig({ ...PRODUCTION, IBAN_ACTIVE_KID: 'k9' })).toThrow(
        /IBAN_ACTIVE_KID : doit désigner un kid/,
      );
      expect(() => loadConfig({ NODE_ENV: 'test', IBAN_KEYRING: `k1:${key(1)}` })).toThrow(
        /IBAN_ACTIVE_KID manquant/,
      );
      expect(() => loadConfig({ NODE_ENV: 'test', IBAN_ACTIVE_KID: 'k9' })).toThrow(
        /IBAN_ACTIVE_KID : doit désigner un kid/,
      );
    });

    it('aucun message d’erreur ne contient la clé posée', () => {
      const secret = key(0x5a);
      const secretHex = Buffer.alloc(32, 0x5a).toString('hex');
      const cases = [
        ring(`k1:${key(0x5a, 31)}`, 'k1'),
        ring(`k1:${key(0x5a, 33)}`, 'k1'),
        ring(`${secret}`, 'k1'),
        ring(`k 1:${secret}`, 'k1'),
        ring(`k1:${secret},k1:${secret}`, 'k1'),
        ring(`k1:${secret}`, 'k9'),
        ring(`k1:${secret}@`, 'k1'),
      ];
      for (const env of cases) {
        let message = '';
        try {
          loadConfig(env);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toMatch(/IBAN_/);
        expect(message).not.toContain(secret);
        expect(message).not.toContain(secret.slice(0, 20));
        expect(message).not.toContain(secretHex);
      }
      const testKey = loadConfig(LOCAL).ibanKeyring.get('test')!;
      let message = '';
      try {
        loadConfig(ring(`test:${testKey.toString('base64')}`, 'test'));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(testKey.toString('base64'));
    });
  });

  describe('vendorPinSettings (processus vendor-pin)', () => {
    it('production complète acceptée, sans OIDC, certificats ni anneau d’IBAN', () => {
      const settings = vendorPinSettings(PIN_PRODUCTION);
      expect(settings.production).toBe(true);
      expect(settings.port).toBe(3003);
      expect(settings.vendorPinSecret.equals(Buffer.alloc(32, 0x04))).toBe(true);
      expect(settings.vendorPinCallKey.equals(Buffer.alloc(32, 0x3c))).toBe(true);
      expect(settings.pinDatabaseUrl).toBe(PIN_PRODUCTION.DATABASE_URL_PIN);
      expect(vendorPinSettings({ ...PIN_PRODUCTION, VENDOR_PIN_PORT: '4100' }).port).toBe(4100);
    });

    it('production : sans secret, sans clé d’appel, sans DATABASE_URL_PIN → refus', () => {
      for (const name of ['VENDOR_PIN_SECRET', 'VENDOR_PIN_CALL_KEY', 'DATABASE_URL_PIN']) {
        const without = { ...PIN_PRODUCTION } as Record<string, string>;
        delete without[name];
        expect(() => vendorPinSettings(without)).toThrow(new RegExp(`${name} manquant`));
        expect(() => vendorPinSettings({ ...without, [name]: '' })).toThrow(
          new RegExp(`${name} manquant`),
        );
      }
      expect(() => vendorPinSettings({ ...PIN_PRODUCTION, DATABASE_URL_PIN: '' })).toThrow(
        'DATABASE_URL_PIN manquant : chaîne de connexion du rôle cashless_pin obligatoire en production',
      );
    });

    it('production : secrets de test refusés même posés', () => {
      const local = vendorPinSettings({ NODE_ENV: 'test' });
      expect(() =>
        vendorPinSettings({
          ...PIN_PRODUCTION,
          VENDOR_PIN_SECRET: local.vendorPinSecret.toString('hex'),
        }),
      ).toThrow(/VENDOR_PIN_SECRET : secret de test refusé en production/);
      expect(() =>
        vendorPinSettings({
          ...PIN_PRODUCTION,
          VENDOR_PIN_CALL_KEY: local.vendorPinCallKey.toString('hex'),
        }),
      ).toThrow(/VENDOR_PIN_CALL_KEY : secret de test refusé en production/);
    });

    it('secret égal à la clé d’appel, en hexadécimal comme en base64 → refus', () => {
      expect(() =>
        vendorPinSettings({ ...PIN_PRODUCTION, VENDOR_PIN_SECRET: '3c'.repeat(32) }),
      ).toThrow(/VENDOR_PIN_SECRET et VENDOR_PIN_CALL_KEY : secrets distincts/);
      expect(() =>
        vendorPinSettings({
          ...PIN_PRODUCTION,
          VENDOR_PIN_SECRET: Buffer.alloc(32, 0x3c).toString('base64'),
        }),
      ).toThrow(/secrets distincts/);
    });

    it('secret égal à un autre secret posé dans l’environnement → refus ; autre secret absent → sans effet', () => {
      for (const other of [
        'VENDOR_PIN_IDEMPOTENCY_SECRET',
        'CLAIM_CODE_HMAC_KEY',
        'IDEMPOTENCY_HMAC_KEY',
        'ENROLLMENT_CODE_HMAC_KEY',
        'CUSTOMER_AUTH_HMAC_KEY',
      ]) {
        const value = (PRODUCTION as Record<string, string>)[other]!;
        expect(() =>
          vendorPinSettings({ ...PIN_PRODUCTION, [other]: value, VENDOR_PIN_SECRET: value }),
        ).toThrow(
          new RegExp(
            `(VENDOR_PIN_SECRET et ${other}|${other} et VENDOR_PIN_SECRET) : secrets distincts`,
          ),
        );
        expect(() =>
          vendorPinSettings({ ...PIN_PRODUCTION, [other]: value, VENDOR_PIN_CALL_KEY: value }),
        ).toThrow(
          new RegExp(
            `(VENDOR_PIN_CALL_KEY et ${other}|${other} et VENDOR_PIN_CALL_KEY) : secrets distincts`,
          ),
        );
        // Posé et distinct : accepté.
        expect(vendorPinSettings({ ...PIN_PRODUCTION, [other]: value }).production).toBe(true);
      }
    });

    it('hors production : valeurs de test, port 3003, base locale ; port invalide refusé', () => {
      const local = vendorPinSettings({ NODE_ENV: 'test' });
      expect(local.production).toBe(false);
      expect(local.port).toBe(3003);
      expect(local.vendorPinSecret.toString('utf8')).toMatch(/de-test-uniquement/);
      expect(local.vendorPinCallKey.equals(loadConfig(LOCAL).vendorPinCallKey)).toBe(true);
      expect(local.vendorPinSecret.equals(local.vendorPinCallKey)).toBe(false);
      expect(local.pinDatabaseUrl).toBe(loadConfig(LOCAL).pinDatabaseUrl);
      for (const bad of ['abc', '0', '-3'])
        expect(() => vendorPinSettings({ NODE_ENV: 'test', VENDOR_PIN_PORT: bad })).toThrow(
          /VENDOR_PIN_PORT : entier positif attendu/,
        );
    });

    it('NODE_ENV manquant ou inconnu : même refus que loadConfig', () => {
      expect(() => vendorPinSettings({})).toThrow();
      expect(() => loadConfig({})).toThrow();
    });
  });

  it('ADR-126 : VENDOR_PIN_IDEMPOTENCY_SECRET distinct de tous les autres secrets, refusé sinon', () => {
    for (const other of [
      'CLAIM_CODE_HMAC_KEY',
      'IDEMPOTENCY_HMAC_KEY',
      'ENROLLMENT_CODE_HMAC_KEY',
      'VENDOR_PIN_CALL_KEY',
    ]) {
      const value = (PRODUCTION as Record<string, string>)[other]!;
      expect(() => loadConfig({ ...PRODUCTION, VENDOR_PIN_IDEMPOTENCY_SECRET: value })).toThrow(
        new RegExp(
          `(${other} et VENDOR_PIN_IDEMPOTENCY_SECRET|VENDOR_PIN_IDEMPOTENCY_SECRET et ${other}) : secrets distincts`,
        ),
      );
    }
    const local = loadConfig(LOCAL);
    for (const key of [
      local.claimCodeHmacKey,
      local.idempotencyHmacKey,
      local.enrollmentCodeHmacKey,
      local.vendorPinCallKey,
    ])
      expect(local.vendorPinIdempotencySecret.equals(key)).toBe(false);
  });

  it('ADR-126 : production sans VENDOR_PIN_IDEMPOTENCY_SECRET → démarrage refusé ; hors production → secret de test', () => {
    const { VENDOR_PIN_IDEMPOTENCY_SECRET: _omitted, ...without } = PRODUCTION;
    expect(() => loadConfig(without)).toThrow(/VENDOR_PIN_IDEMPOTENCY_SECRET manquant/);
    expect(() => loadConfig({ ...PRODUCTION, VENDOR_PIN_IDEMPOTENCY_SECRET: '' })).toThrow(
      /VENDOR_PIN_IDEMPOTENCY_SECRET manquant/,
    );
    const local = loadConfig(LOCAL);
    expect(local.vendorPinIdempotencySecret.toString('utf8')).toMatch(/de-test-uniquement/);
  });

  it('production : les secrets de test sont refusés même posés explicitement', () => {
    const local = loadConfig(LOCAL);
    for (const [name, key] of [
      ['CLAIM_CODE_HMAC_KEY', local.claimCodeHmacKey],
      ['IDEMPOTENCY_HMAC_KEY', local.idempotencyHmacKey],
      ['ENROLLMENT_CODE_HMAC_KEY', local.enrollmentCodeHmacKey],
      ['VENDOR_PIN_CALL_KEY', local.vendorPinCallKey],
      ['VENDOR_PIN_IDEMPOTENCY_SECRET', local.vendorPinIdempotencySecret],
    ] as const) {
      expect(() => loadConfig({ ...PRODUCTION, [name]: key.toString('hex') })).toThrow(
        new RegExp(`${name} : secret de test refusé en production`),
      );
    }
    // `VENDOR_PIN_SECRET` n'est plus lu par l'API (WP07) : le processus `vendor-pin` le refuse.
    expect(() =>
      vendorPinSettings({
        ...PIN_PRODUCTION,
        VENDOR_PIN_SECRET: vendorPinSettings(LOCAL).vendorPinSecret.toString('hex'),
      }),
    ).toThrow(/VENDOR_PIN_SECRET/);
  });

  it('CUSTOMER_AUTH_HMAC_KEY : obligatoire en production, distinct des autres, secret de test refusé', () => {
    const { CUSTOMER_AUTH_HMAC_KEY: _omitted, ...without } = PRODUCTION;
    expect(() => loadConfig(without)).toThrow(/CUSTOMER_AUTH_HMAC_KEY manquant/);
    expect(() => loadConfig({ ...PRODUCTION, CUSTOMER_AUTH_HMAC_KEY: 'abcd' })).toThrow(
      /32 octets/,
    );
    expect(() =>
      loadConfig({ ...PRODUCTION, CUSTOMER_AUTH_HMAC_KEY: PRODUCTION.CLAIM_CODE_HMAC_KEY }),
    ).toThrow(/CUSTOMER_AUTH_HMAC_KEY et CLAIM_CODE_HMAC_KEY : secrets distincts/);
    const local = loadConfig(LOCAL);
    expect(local.customerAuthHmacKey.toString('utf8')).toMatch(/de-test-uniquement/);
    expect(() =>
      loadConfig({
        ...PRODUCTION,
        CUSTOMER_AUTH_HMAC_KEY: local.customerAuthHmacKey.toString('hex'),
      }),
    ).toThrow(/CUSTOMER_AUTH_HMAC_KEY : secret de test refusé en production/);
  });

  it('CUSTOMER_OTP_IP_HOURLY_MAX : 10 par défaut, entier ≥ 1 sinon refusé', () => {
    expect(loadConfig(LOCAL).customerOtpIpHourlyMax).toBe(10);
    expect(loadConfig(PRODUCTION).customerOtpIpHourlyMax).toBe(10);
    expect(loadConfig({ ...LOCAL, CUSTOMER_OTP_IP_HOURLY_MAX: '3' }).customerOtpIpHourlyMax).toBe(
      3,
    );
    for (const bad of ['0', '-1', 'abc', '1.5'])
      expect(() => loadConfig({ ...LOCAL, CUSTOMER_OTP_IP_HOURLY_MAX: bad })).toThrow(
        /CUSTOMER_OTP_IP_HOURLY_MAX/,
      );
  });

  it('iOS : IOS_APP_ATTEST_ENVIRONMENT = development refusé en production, permis hors production', () => {
    expect(() => loadConfig({ ...PRODUCTION, IOS_APP_ATTEST_ENVIRONMENT: 'development' })).toThrow(
      /« production » exigé en production/,
    );
    expect(
      loadConfig({ ...LOCAL, IOS_APP_ATTEST_ENVIRONMENT: 'development' }).iosAppAttestEnvironment,
    ).toBe('development');
    for (const bad of ['prod', 'Production', 'dev'])
      expect(() => loadConfig({ ...LOCAL, IOS_APP_ATTEST_ENVIRONMENT: bad })).toThrow(
        /production ou development attendu/,
      );
  });

  it('identifiants Android et iOS : formes attendues', () => {
    for (const bad of ['terminal', 'org..cashless', '1org.cashless', 'org.cashless-terminal'])
      expect(() => loadConfig({ ...PRODUCTION, ANDROID_APP_PACKAGE: bad })).toThrow(
        /ANDROID_APP_PACKAGE/,
      );
    for (const bad of ['abcde12345', 'ABCDE1234', 'ABCDE-1234'])
      expect(() => loadConfig({ ...PRODUCTION, IOS_TEAM_ID: bad })).toThrow(/IOS_TEAM_ID/);
    for (const bad of ['terminal', 'org.cashless.', 'org cashless'])
      expect(() => loadConfig({ ...PRODUCTION, IOS_BUNDLE_ID: bad })).toThrow(/IOS_BUNDLE_ID/);
    expect(() => loadConfig({ ...PRODUCTION, DEVICE_TOKEN_ISSUER: 'https://a b' })).toThrow(
      /DEVICE_TOKEN_ISSUER/,
    );
  });

  it('empreintes de signature Android : liste hexadécimale, `:` admis, minuscules, sans doublon', () => {
    const upper = 'AB:'.repeat(31) + 'AB';
    const config = loadConfig({
      ...PRODUCTION,
      ANDROID_APP_SIGNING_DIGESTS: `${upper}, ${'cd'.repeat(32)},${'ab'.repeat(32)}`,
    });
    expect(config.androidAppSigningDigests).toEqual(['ab'.repeat(32), 'cd'.repeat(32)]);
    for (const bad of ['ab'.repeat(31), 'zz'.repeat(32), `${'ab'.repeat(32)},`, ','])
      expect(() => loadConfig({ ...PRODUCTION, ANDROID_APP_SIGNING_DIGESTS: bad })).toThrow(
        /ANDROID_APP_SIGNING_DIGESTS/,
      );
  });

  it('niveau de correctif Android : AAAAMM', () => {
    expect(loadConfig(LOCAL).androidMinPatchLevel).toBe(202201);
    for (const bad of ['2025', '20250101', '202513', '202500', '201612', 'mars'])
      expect(() => loadConfig({ ...PRODUCTION, ANDROID_MIN_PATCH_LEVEL: bad })).toThrow(
        /ANDROID_MIN_PATCH_LEVEL/,
      );
  });

  // ----- Mission serveur-app-festivalier (WP07) : version du secret des codes, délais d'envoi -----

  describe('version du secret des codes de rattachement et délais de la chaîne d’envoi', () => {
    it('défauts (1, 10 000, 20 000), en production comme ailleurs', () => {
      for (const env of [LOCAL, PRODUCTION]) {
        const config = loadConfig(env);
        expect(config.claimCodeKeyVersion).toBe(1);
        expect(config.otpWhatsappTimeoutMs).toBe(10_000);
        expect(config.otpSmsPrimaryTimeoutMs).toBe(20_000);
      }
    });

    it.each([
      ['CLAIM_CODE_HMAC_KEY_VERSION', '1', 'claimCodeKeyVersion', 1],
      ['CLAIM_CODE_HMAC_KEY_VERSION', '32767', 'claimCodeKeyVersion', 32767],
      ['OTP_WHATSAPP_TIMEOUT_MS', '1000', 'otpWhatsappTimeoutMs', 1000],
      ['OTP_WHATSAPP_TIMEOUT_MS', '15000', 'otpWhatsappTimeoutMs', 15000],
      ['OTP_SMS_PRIMARY_TIMEOUT_MS', '1000', 'otpSmsPrimaryTimeoutMs', 1000],
      ['OTP_SMS_PRIMARY_TIMEOUT_MS', '20000', 'otpSmsPrimaryTimeoutMs', 20000],
    ] as const)('%s=%s accepté (borne)', (name, value, field, expected) => {
      expect(loadConfig({ ...PRODUCTION, [name]: value })[field]).toBe(expected);
    });

    it.each([
      ['CLAIM_CODE_HMAC_KEY_VERSION', ['0', '32768', '1.5', '-1', 'abc']],
      ['OTP_WHATSAPP_TIMEOUT_MS', ['999', '15001', '1.5', '-1', 'abc']],
      ['OTP_SMS_PRIMARY_TIMEOUT_MS', ['999', '20001', '1.5', '-1', 'abc']],
    ] as const)('%s hors bornes ou non entier : refus nommant la variable', (name, bads) => {
      for (const bad of bads) {
        expect(() => loadConfig({ ...PRODUCTION, [name]: bad })).toThrow(new RegExp(name));
        expect(() => loadConfig({ ...LOCAL, [name]: bad })).toThrow(new RegExp(name));
      }
    });

    it('valeur vide : défaut', () => {
      expect(
        loadConfig({ ...PRODUCTION, CLAIM_CODE_HMAC_KEY_VERSION: '' }).claimCodeKeyVersion,
      ).toBe(1);
    });

    it('ClaimHasher expose la version de la configuration', () => {
      const config = loadConfig({ ...PRODUCTION, CLAIM_CODE_HMAC_KEY_VERSION: '7' });
      expect(new ClaimHasher(config).keyVersion).toBe(7);
    });

    it('assertClaimKeyVersion : inférieure refuse, égale et supérieure passent, 0 passe', () => {
      expect(() => assertClaimKeyVersion(1, 2)).toThrow(/inférieure à la version 2/);
      expect(() => assertClaimKeyVersion(2, 2)).not.toThrow();
      expect(() => assertClaimKeyVersion(3, 2)).not.toThrow();
      expect(() => assertClaimKeyVersion(1, 0)).not.toThrow();
    });
  });

  describe('claimAdminSettings (commande de réémission des codes)', () => {
    const ADMIN_PRODUCTION = {
      NODE_ENV: 'production',
      CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
      CLAIM_CODE_DOMAIN: 'pay.example.org',
      DATABASE_URL_CLAIMADMIN: 'postgres://cashless_claimadmin:secret@db.internal:5432/cashless',
    };

    it('production : lit la configuration nécessaire, sans OIDC ni autre secret', () => {
      const settings = claimAdminSettings(ADMIN_PRODUCTION);
      expect(settings).toMatchObject({
        production: true,
        claimCodeKeyVersion: 1,
        claimCodeDomain: 'pay.example.org',
        claimAdminDatabaseUrl: ADMIN_PRODUCTION.DATABASE_URL_CLAIMADMIN,
      });
      expect(settings.claimCodeHmacKey.equals(Buffer.alloc(32, 0xab))).toBe(true);
      expect(
        claimAdminSettings({ ...ADMIN_PRODUCTION, CLAIM_CODE_HMAC_KEY_VERSION: '3' })
          .claimCodeKeyVersion,
      ).toBe(3);
    });

    it('production sans DATABASE_URL_CLAIMADMIN : erreur nommant la variable', () => {
      const { DATABASE_URL_CLAIMADMIN: _url, ...without } = ADMIN_PRODUCTION;
      expect(() => claimAdminSettings(without)).toThrow(/DATABASE_URL_CLAIMADMIN/);
    });

    it('production : secret de test, secret absent et domaine absent refusés', () => {
      const testKey = Buffer.from(
        'cashless-claim-code-hmac-key-de-test-uniquement-0000',
        'utf8',
      ).toString('hex');
      expect(() =>
        claimAdminSettings({ ...ADMIN_PRODUCTION, CLAIM_CODE_HMAC_KEY: testKey }),
      ).toThrow(/secret de test refusé/);
      const { CLAIM_CODE_HMAC_KEY: _k, ...noKey } = ADMIN_PRODUCTION;
      expect(() => claimAdminSettings(noKey)).toThrow(/CLAIM_CODE_HMAC_KEY/);
      const { CLAIM_CODE_DOMAIN: _d, ...noDomain } = ADMIN_PRODUCTION;
      expect(() => claimAdminSettings(noDomain)).toThrow(/CLAIM_CODE_DOMAIN/);
    });

    it('hors production : valeur locale du rôle cashless_claimadmin', () => {
      const settings = claimAdminSettings(LOCAL);
      expect(settings.production).toBe(false);
      expect(settings.claimAdminDatabaseUrl).toContain(
        'cashless_claimadmin:cashless_claimadmin_local',
      );
    });
  });
});

describe('loadConfig : services externes (mission 12b-1)', () => {
  it('hors production : quatre modes fake et défauts documentés', () => {
    const config = loadConfig(LOCAL);
    expect(config.externalModes).toEqual({
      psp: 'fake',
      pspSecrets: 'fake',
      kms: 'fake',
      sealCopy: 'fake',
    });
    expect(config.pspHttpTimeoutMs).toBe(10000);
    expect(config.pspBases).toEqual({
      wave: 'https://api.wave.com',
      paydunya: 'https://app.paydunya.com/api/v1',
      stripe: 'https://api.stripe.com',
    });
    expect(config.waveDefaultUrls).toEqual({ success: null, error: null });
    expect(config.aws).toEqual({ region: 'eu-west-3', endpoint: null });
    expect(config.sealCopy).toEqual({ bucket: null, retentionDays: 3650 });
  });

  it('en production : modes absents = real ; SEAL_COPY=real posé exige son seau', () => {
    expect(() => loadConfig({ ...PRODUCTION, SEAL_COPY: 'real' })).toThrow(/SEAL_COPY_BUCKET/);
    const config = loadConfig({ ...PRODUCTION, SEAL_COPY_BUCKET: 'scellements' });
    expect(config.externalModes).toEqual({
      psp: 'real',
      pspSecrets: 'real',
      kms: 'real',
      sealCopy: 'real',
    });
    expect(config.sealCopy.bucket).toBe('scellements');
  });

  it.each(['PSP_ADAPTERS', 'PSP_SECRET_STORE', 'KMS_BACKEND', 'SEAL_COPY'])(
    '%s : valeur hors liste refusée, fake refusé en production',
    (name) => {
      expect(() => loadConfig({ ...LOCAL, [name]: 'autre' })).toThrow(new RegExp(`${name} :`));
      expect(loadConfig({ ...LOCAL, [name]: 'fake' }).production).toBe(false);
      expect(() => loadConfig({ ...PRODUCTION, SEAL_COPY_BUCKET: 'b', [name]: 'fake' })).toThrow(
        new RegExp(`${name} : « fake » refusé en production`),
      );
    },
  );

  it('SEAL_COPY=real sans SEAL_COPY_BUCKET : refus', () => {
    expect(() => loadConfig({ ...LOCAL, SEAL_COPY: 'real' })).toThrow(/SEAL_COPY_BUCKET/);
    expect(loadConfig({ ...LOCAL, SEAL_COPY: 'real', SEAL_COPY_BUCKET: 'b' }).sealCopy.bucket).toBe(
      'b',
    );
  });

  it('AWS_ENDPOINT_URL : permis hors production, refusé en production', () => {
    const local = loadConfig({ ...LOCAL, AWS_ENDPOINT_URL: 'http://127.0.0.1:4566' });
    expect(local.aws.endpoint).toBe('http://127.0.0.1:4566');
    expect(() =>
      loadConfig({
        ...PRODUCTION,
        SEAL_COPY_BUCKET: 'b',
        AWS_ENDPOINT_URL: 'https://kms.eu-west-3.amazonaws.com',
      }),
    ).toThrow(/AWS_ENDPOINT_URL/);
  });

  it('PSP_HTTP_TIMEOUT_MS : 1 000 à 30 000', () => {
    expect(loadConfig({ ...LOCAL, PSP_HTTP_TIMEOUT_MS: '5000' }).pspHttpTimeoutMs).toBe(5000);
    expect(() => loadConfig({ ...LOCAL, PSP_HTTP_TIMEOUT_MS: '999' })).toThrow(
      /PSP_HTTP_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ ...LOCAL, PSP_HTTP_TIMEOUT_MS: '30001' })).toThrow(
      /PSP_HTTP_TIMEOUT_MS/,
    );
  });

  it('SEAL_COPY_RETENTION_DAYS : 1 à 36 500', () => {
    expect(loadConfig({ ...LOCAL, SEAL_COPY_RETENTION_DAYS: '36500' }).sealCopy.retentionDays).toBe(
      36500,
    );
    expect(() => loadConfig({ ...LOCAL, SEAL_COPY_RETENTION_DAYS: '0' })).toThrow(
      /SEAL_COPY_RETENTION_DAYS/,
    );
    expect(() => loadConfig({ ...LOCAL, SEAL_COPY_RETENTION_DAYS: '36501' })).toThrow(
      /SEAL_COPY_RETENTION_DAYS/,
    );
  });

  it('adresses de base : https exigé ; http local permis hors production seulement', () => {
    const local = loadConfig({ ...LOCAL, WAVE_API_BASE: 'http://127.0.0.1:5555/' });
    expect(local.pspBases.wave).toBe('http://127.0.0.1:5555');
    expect(loadConfig({ ...LOCAL, STRIPE_API_BASE: 'http://localhost:1' }).pspBases.stripe).toBe(
      'http://localhost:1',
    );
    expect(() => loadConfig({ ...LOCAL, PAYDUNYA_API_BASE: 'http://paydunya.example' })).toThrow(
      /PAYDUNYA_API_BASE : https attendu/,
    );
    expect(() => loadConfig({ ...LOCAL, WAVE_API_BASE: 'pas une url' })).toThrow(/WAVE_API_BASE/);
    expect(() =>
      loadConfig({
        ...PRODUCTION,
        SEAL_COPY_BUCKET: 'b',
        WAVE_API_BASE: 'http://127.0.0.1:5555',
      }),
    ).toThrow(/WAVE_API_BASE : https attendu/);
    expect(
      loadConfig({
        ...PRODUCTION,
        SEAL_COPY_BUCKET: 'b',
        PAYDUNYA_API_BASE: 'https://app.paydunya.com/sandbox-api/v1',
      }).pspBases.paydunya,
    ).toBe('https://app.paydunya.com/sandbox-api/v1');
  });

  it('adresses de retour Wave : https si posées', () => {
    const config = loadConfig({
      ...LOCAL,
      WAVE_DEFAULT_SUCCESS_URL: 'https://app.example.org/ok',
      WAVE_DEFAULT_ERROR_URL: 'https://app.example.org/ko',
    });
    expect(config.waveDefaultUrls).toEqual({
      success: 'https://app.example.org/ok',
      error: 'https://app.example.org/ko',
    });
    expect(() => loadConfig({ ...LOCAL, WAVE_DEFAULT_ERROR_URL: 'http://127.0.0.1/ko' })).toThrow(
      /WAVE_DEFAULT_ERROR_URL/,
    );
  });
});
