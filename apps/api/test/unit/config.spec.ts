// Configuration lue dans l'environnement : pools applicatif et de plateforme (contrat platform-access).
import { loadConfig } from '../../src/config/config';
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
    ]).toEqual(['', '', '', '']);
    expect(config.tagWrappingKeyRef).toBe(PRODUCTION.TAG_WRAPPING_KEY_REF);
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

  it.each(Object.keys(DEVICE_PRODUCTION))(
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

  it.each(['IDEMPOTENCY_HMAC_KEY', 'ENROLLMENT_CODE_HMAC_KEY'])(
    '%s : 32 octets au moins, hexadécimal ou base64',
    (name) => {
      for (const env of [PRODUCTION, LOCAL]) {
        expect(() => loadConfig({ ...env, [name]: 'abcd' })).toThrow(/32 octets/);
        expect(() => loadConfig({ ...env, [name]: '0f'.repeat(31) })).toThrow(/32 octets/);
      }
      const config = loadConfig({ ...PRODUCTION, [name]: Buffer.alloc(48, 9).toString('base64') });
      const key =
        name === 'IDEMPOTENCY_HMAC_KEY' ? config.idempotencyHmacKey : config.enrollmentCodeHmacKey;
      expect(key.equals(Buffer.alloc(48, 9))).toBe(true);
    },
  );

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

  it('production : les secrets de test sont refusés même posés explicitement', () => {
    const local = loadConfig(LOCAL);
    for (const [name, key] of [
      ['CLAIM_CODE_HMAC_KEY', local.claimCodeHmacKey],
      ['IDEMPOTENCY_HMAC_KEY', local.idempotencyHmacKey],
      ['ENROLLMENT_CODE_HMAC_KEY', local.enrollmentCodeHmacKey],
    ] as const) {
      expect(() => loadConfig({ ...PRODUCTION, [name]: key.toString('hex') })).toThrow(
        new RegExp(`${name} : secret de test refusé en production`),
      );
    }
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
});
