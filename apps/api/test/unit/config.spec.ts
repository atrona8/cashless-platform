// Configuration lue dans l'environnement : pools applicatif et de plateforme (contrat platform-access).
import { loadConfig } from '../../src/config/config';

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
});
