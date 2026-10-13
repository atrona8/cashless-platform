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
});
