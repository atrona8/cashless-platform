// Démarrage RÉEL du processus `edge` (vrai `NestFactory`, vrai `serve`, vrai écouteur TLS) : aucun faux en production
// (règle 2 de CLAUDE.md, NFR-010 ; OP-N100 : autorité des passerelles simulée jusqu'à la mission 12b), TLS et port
// obligatoires, rôle de base nommé. Chaque refus a son cas. Le cas « EDGE_CA factice refusé en production » échoue si
// `EDGE_CA` quitte la liste de `assertProcessIsSafe` : la fabrique du faux ne refuse rien elle-même.
import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { FakeInProductionError } from '../../../../src/kms/production-guard';
import { requireEdgeListenPort } from '../../../../src/edge/edge-listen-port';
import { EDGE_URL } from '../../../support/db';
import { edgeGet, startEdge } from '../../../support/edge-fixtures';
import { DEVICE_PRODUCTION } from '../../../support/tls';

const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://cashless_app:s@127.0.0.1:1/c',
  DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@127.0.0.1:1/c',
  OIDC_ISSUER: 'https://id.example',
  OIDC_AUDIENCE: 'a',
  OIDC_APPROVAL_AUDIENCE: 'b',
  OIDC_JWKS_URI: 'https://id.example/jwks.json',
  CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
  TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
  CLAIM_CODE_DOMAIN: 'pay.example.org',
  // Le processus termine TLS lui-même : aucun répartiteur de confiance (assertSafeTransport).
  TRUST_PROXY_HOPS: '0',
  ...DEVICE_PRODUCTION,
};

describe('processus edge : démarrage réel', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('hors production, avec le faux, le processus démarre et répond sur /health', async () => {
    const edge = await startEdge();
    try {
      const reply = await edgeGet(edge.port, '/health');
      expect(reply.status).toBe(200);
      expect(reply.json).toEqual({ status: 'ok', db: 'ok' });
    } finally {
      await edge.close();
    }
  });

  it('en production, EDGE_CA factice : démarrage refusé (aucun faux en production)', async () => {
    Object.assign(process.env, PRODUCTION);
    const error = await startEdge({ ...PRODUCTION }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FakeInProductionError);
    expect((error as FakeInProductionError).names).toEqual(['l’autorité des passerelles']);
  });

  it.each([
    [
      'certificat et clé',
      ['EDGE_TLS_CERT_FILE', 'EDGE_TLS_KEY_FILE'],
      /EDGE_TLS_CERT_FILE manquant/,
    ],
    ['certificat seul', ['EDGE_TLS_CERT_FILE'], /les deux ou aucun/],
    ['clé seule', ['EDGE_TLS_KEY_FILE'], /les deux ou aucun/],
    ['autorité des passerelles', ['EDGE_CA_CERT_FILE'], /EDGE_CA_CERT_FILE manquant/],
  ])(
    'en production, sans %s : démarrage refusé (jamais en clair)',
    async (_name, missing, message) => {
      Object.assign(process.env, PRODUCTION);
      const env: Record<string, string | undefined> = { ...PRODUCTION };
      for (const key of missing) env[key] = '';
      await expect(startEdge(env)).rejects.toThrow(message);
    },
  );

  it('en production, sans DATABASE_URL_EDGE : refus qui nomme la clé', async () => {
    Object.assign(process.env, PRODUCTION);
    await expect(startEdge({ ...PRODUCTION, DATABASE_URL_EDGE: '' })).rejects.toThrow(
      /DATABASE_URL_EDGE manquant/,
    );
  });

  it('sans DATABASE_URL_EDGE hors production, le rôle local par défaut est cashless_edge', async () => {
    delete process.env.DATABASE_URL_EDGE;
    const { loadConfig } = await import('../../../../src/config/config');
    expect(loadConfig().edgeDatabaseUrl).toContain('cashless_edge:');
    expect(EDGE_URL).toContain('cashless_edge:');
  });

  it('EDGE_LISTEN_PORT absent ou invalide : refus', () => {
    const base = { ...process.env, EDGE_LISTEN_PORT: undefined };
    expect(() => requireEdgeListenPort(base)).toThrow(/EDGE_LISTEN_PORT manquant/);
    expect(() => requireEdgeListenPort({ ...base, EDGE_LISTEN_PORT: '' })).toThrow(
      /EDGE_LISTEN_PORT manquant/,
    );
    expect(() => requireEdgeListenPort({ ...base, EDGE_LISTEN_PORT: '70000' })).toThrow(
      /EDGE_LISTEN_PORT : port invalide/,
    );
    expect(requireEdgeListenPort({ ...base, EDGE_LISTEN_PORT: '8443' })).toBe(8443);
  });

  it('le vrai point d’entrée (main.edge.ts) refuse de démarrer sans EDGE_LISTEN_PORT', () => {
    const env = { ...process.env };
    delete env.EDGE_LISTEN_PORT;
    const run = spawnSync(
      process.execPath,
      ['--require', 'tsx/cjs', join(__dirname, '../../../../src/main.edge.ts')],
      { env, encoding: 'utf8', timeout: 60_000 },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/EDGE_LISTEN_PORT manquant/);
  });
});
