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
  TRUST_PROXY_HOPS: '1',
};

describe('loadConfig', () => {
  it('hors production : défauts locaux des deux pools', () => {
    const config = loadConfig({});
    expect(config.production).toBe(false);
    expect(config.databaseUrl).toBe('postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test');
    expect(config.platformDatabaseUrl).toBe(
      'postgres://cashless_platform:cashless_platform_local@127.0.0.1:5433/cashless_test',
    );
    expect(config.poolSize).toBe(10);
    expect(config.platformPoolSize).toBe(2);
  });

  it('lit DATABASE_URL_PLATFORM et DB_PLATFORM_POOL_SIZE', () => {
    const config = loadConfig({ DATABASE_URL_PLATFORM: 'postgres://cashless_platform:x@h:5432/d', DB_PLATFORM_POOL_SIZE: '4' });
    expect(config.platformDatabaseUrl).toBe('postgres://cashless_platform:x@h:5432/d');
    expect(config.platformPoolSize).toBe(4);
  });

  it('les deux pools restent distincts', () => {
    const config = loadConfig(PRODUCTION);
    expect(config.platformDatabaseUrl).not.toBe(config.databaseUrl);
  });

  it.each(['0', '-1', 'deux'])('DB_PLATFORM_POOL_SIZE invalide (%s) : refus', (value) => {
    expect(() => loadConfig({ DB_PLATFORM_POOL_SIZE: value })).toThrow(/DB_PLATFORM_POOL_SIZE/);
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
    const config = loadConfig({});
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
    expect(loadConfig({ ...PRODUCTION, CLAIM_CODE_HMAC_KEY: Buffer.alloc(32, 7).toString('base64') }).claimCodeHmacKey).toHaveLength(32);
    expect(loadConfig(PRODUCTION).claimCodeHmacKey.equals(Buffer.alloc(32, 0xab))).toBe(true);
  });

  it('production : aucune chaîne de connexion ni clé d’emballage par défaut pour les processus des clés', () => {
    const config = loadConfig(PRODUCTION);
    expect([config.tagKeysDatabaseUrl, config.personalizationDatabaseUrl, config.tagCheckDatabaseUrl, config.keyAdminDatabaseUrl, config.tagWrappingKeyRef]).toEqual(['', '', '', '', '']);
  });

  it('TRUST_PROXY_HOPS (OP-N53) : obligatoire en production, entier de 0 à 5, 0 hors production', () => {
    const { TRUST_PROXY_HOPS: _hops, ...withoutHops } = PRODUCTION;
    expect(() => loadConfig(withoutHops)).toThrow(/TRUST_PROXY_HOPS manquant/);
    expect(() => loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '' })).toThrow(/TRUST_PROXY_HOPS manquant/);
    for (const bad of ['true', '-1', '6', '1.5', 'loopback', ' 1'])
      expect(() => loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: bad })).toThrow(/entier de 0 à 5/);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
    expect(loadConfig({}).trustProxyHops).toBe(0);
    expect(() => loadConfig({ TRUST_PROXY_HOPS: '9' })).toThrow(/entier de 0 à 5/);
  });

  it('domaine des liens imprimés sur les bracelets : défaut de test, valeur en minuscules, vide en production', () => {
    expect(loadConfig({}).claimCodeDomain).toBe('pay.cashless.test');
    expect(loadConfig({ CLAIM_CODE_DOMAIN: 'Pay.Example.ORG' }).claimCodeDomain).toBe('pay.example.org');
    expect(loadConfig(PRODUCTION).claimCodeDomain).toBe('');
  });

  it.each(['https://pay.example.org', 'pay.example.org/c', 'pay example.org', 'localhost', '-pay.example.org'])('CLAIM_CODE_DOMAIN mal formé (%s) : refus', (value) => {
    expect(() => loadConfig({ CLAIM_CODE_DOMAIN: value })).toThrow(/CLAIM_CODE_DOMAIN/);
  });

  it.each(['0', '1', '300'])('TAG_DEK_CACHE_SECONDS valide (%s)', (value) => {
    expect(loadConfig({ TAG_DEK_CACHE_SECONDS: value }).tagDekCacheSeconds).toBe(Number(value));
  });

  it.each(['-1', '301', '5.5', 'cinq'])('TAG_DEK_CACHE_SECONDS hors bornes (%s) : refus', (value) => {
    expect(() => loadConfig({ TAG_DEK_CACHE_SECONDS: value })).toThrow(/TAG_DEK_CACHE_SECONDS/);
  });
});
