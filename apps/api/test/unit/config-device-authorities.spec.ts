// `DEVICE_REQUEST_AUTHORITIES` (mission 5a, WP12, research R-04) : autorités auxquelles un terminal
// adresse une requête signée. Relecture WP12 (M3) : ces tests échouent si, en production, le réglage
// cesse d'être obligatoire ou si le port joker (`host:*`) y est accepté.
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
  ...DEVICE_PRODUCTION,
};
const LOCAL = { NODE_ENV: 'test' };

describe('DEVICE_REQUEST_AUTHORITIES (WP12, M3)', () => {
  it('contrôle : la configuration de production complète se charge', () => {
    expect(loadConfig(PRODUCTION).deviceRequestAuthorities).toEqual(['api.cashless.example']);
  });

  it('production : obligatoire (absent ou vide → refus au démarrage)', () => {
    const { DEVICE_REQUEST_AUTHORITIES: _omitted, ...without } = PRODUCTION;
    expect(() => loadConfig(without)).toThrow(/DEVICE_REQUEST_AUTHORITIES manquant/);
    expect(() => loadConfig({ ...PRODUCTION, DEVICE_REQUEST_AUTHORITIES: '' })).toThrow(
      /DEVICE_REQUEST_AUTHORITIES manquant/,
    );
  });

  it.each(['api.cashless.example:*', 'api.cashless.example,localhost:*', 'API.CASHLESS.EXAMPLE:*'])(
    'production : port joker refusé (%s)',
    (value) => {
      expect(() => loadConfig({ ...PRODUCTION, DEVICE_REQUEST_AUTHORITIES: value })).toThrow(
        /port joker/,
      );
    },
  );

  it.each(['', ' ', 'api.example/x', 'https://api.example', 'api.example:443:1', 'a b'])(
    'production : autorité mal formée refusée (« %s » dans la liste)',
    (bad) => {
      expect(() =>
        loadConfig({ ...PRODUCTION, DEVICE_REQUEST_AUTHORITIES: `api.cashless.example,${bad}` }),
      ).toThrow(/DEVICE_REQUEST_AUTHORITIES/);
    },
  );

  it('production : minuscules, port 443 retiré, port explicite gardé', () => {
    const config = loadConfig({
      ...PRODUCTION,
      DEVICE_REQUEST_AUTHORITIES: 'API.Cashless.Example:443, api2.cashless.example:8443',
    });
    expect(config.deviceRequestAuthorities).toEqual([
      'api.cashless.example',
      'api2.cashless.example:8443',
    ]);
  });

  it('hors production : défaut de test (serveurs HTTPS locaux, port tiré) et joker permis', () => {
    expect(loadConfig(LOCAL).deviceRequestAuthorities).toEqual(['localhost:*', '127.0.0.1:*']);
    expect(
      loadConfig({ ...LOCAL, DEVICE_REQUEST_AUTHORITIES: 'gw.local:*' }).deviceRequestAuthorities,
    ).toEqual(['gw.local:*']);
  });
});
