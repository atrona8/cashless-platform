import { nodeEnv } from '@cashless/shared-rules';
import { ConfigError, loadConfig } from '../../src/config/config';

const BASE = { GATEWAY_DATABASE_URL: 'postgres://edge_app@localhost/x' };

describe('configuration de la passerelle', () => {
  it.each([
    undefined,
    '',
    'prod',
    'staging',
    'Production',
    'production ',
    'development',
    'test',
    'production',
  ])('NODE_ENV %p : même verdict que nodeEnv() partagé avec l’API', (value) => {
    let expected: string | Error;
    try {
      expected = nodeEnv(value);
    } catch (error) {
      expected = error as Error;
    }
    const env: Record<string, string | undefined> = { ...BASE, NODE_ENV: value };
    if (expected === 'production') {
      // Les clés de production obligatoires sont hors sujet ici : seul le verdict sur NODE_ENV
      // compte.
      let verdict: string | Error;
      try {
        verdict = loadConfig(env).nodeEnv;
      } catch (error) {
        verdict = error as Error;
      }
      expect(verdict).not.toBe(undefined);
      if (verdict instanceof Error) expect(verdict.message).not.toMatch(/NODE_ENV/);
      return;
    }
    if (expected instanceof Error) {
      expect(() => loadConfig(env)).toThrow(expected.message);
    } else {
      expect(loadConfig(env).nodeEnv).toBe(expected);
    }
  });

  it('refuse une clé GATEWAY_* inconnue, nomme la variable', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'test', GATEWAY_LISTEN_PROT: '1' })).toThrow(
      /GATEWAY_LISTEN_PROT/,
    );
  });

  it('variable vide = absente ; base absente refusée', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', GATEWAY_DATABASE_URL: '' })).toThrow(
      /GATEWAY_DATABASE_URL/,
    );
    expect(loadConfig({ ...BASE, NODE_ENV: 'test', EDGE_FAILPOINT: '' }).failpoint).toBeNull();
  });

  it.each(['70000', '-1', 'abc', '80.5'])(
    'port %p hors plage refusé sans écho de la valeur',
    (value) => {
      try {
        loadConfig({ ...BASE, NODE_ENV: 'test', GATEWAY_LISTEN_PORT: value });
        throw new Error('aurait dû refuser');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).toMatch(/GATEWAY_LISTEN_PORT/);
        expect((error as Error).message).not.toContain(value);
      }
    },
  );

  it('le port 0 est refusé en production', () => {
    expect(() =>
      loadConfig({
        ...BASE,
        NODE_ENV: 'production',
        GATEWAY_LISTEN_PORT: '0',
      }),
    ).toThrow();
  });

  it('GATEWAY_ADMIN_PORT est lu', () => {
    expect(loadConfig({ ...BASE, NODE_ENV: 'test', GATEWAY_ADMIN_PORT: '9000' }).adminPort).toBe(
      9000,
    );
  });

  it('un seul des deux fichiers TLS : refusé', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'test', GATEWAY_TLS_CERT_FILE: '/x' })).toThrow(
      /GATEWAY_TLS_KEY_FILE/,
    );
  });
});
