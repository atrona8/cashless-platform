// Un DÉMARRAGE RÉEL par réglage interdit en production (processus enfant, code de sortie, message,
// aucun port).
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { admin, createTestDb, ensureRole, type TestDb } from './_support/db';
import { CHILD_MAIN, freePort, runGateway } from './_support/child';
import { enrolledFixture, tempDir } from './_support/fixture';
import { makeCa } from './_support/pki';

const STRONG = 'Zk9-Longue-Phrase-8hQw3';
const ROLE = 'edge_app_prod';
let dir: string;
let healthy: Record<string, string>;
let db: TestDb;

beforeAll(async () => {
  dir = tempDir();
  const ca = await makeCa('CN=gateway.site.test');
  writeFileSync(join(dir, 'tls.crt'), ca.certPem);
  writeFileSync(join(dir, 'tls.key'), ca.keyPem, { mode: 0o600 });
  db = await createTestDb({ role: ROLE, password: STRONG });
  await enrolledFixture(db);
  healthy = {
    NODE_ENV: 'production',
    GATEWAY_DATABASE_URL: db.url,
    GATEWAY_CENTRAL_URL: 'https://central.example.test',
    GATEWAY_LISTEN_PORT: String(await freePort()),
    GATEWAY_ADMIN_PORT: String(await freePort()),
    GATEWAY_TLS_CERT_FILE: join(dir, 'tls.crt'),
    GATEWAY_TLS_KEY_FILE: join(dir, 'tls.key'),
    GATEWAY_ADMIN_TLS_CERT_FILE: join(dir, 'tls.crt'),
    GATEWAY_ADMIN_TLS_KEY_FILE: join(dir, 'tls.key'),
    GATEWAY_DEVICE_CA_FILE: join(dir, 'tls.crt'),
    GATEWAY_CENTRAL_CLIENT_CERT_FILE: join(dir, 'tls.crt'),
    GATEWAY_CENTRAL_CLIENT_KEY_FILE: join(dir, 'tls.key'),
    GATEWAY_REQUEST_AUTHORITY: 'gateway.site.test:8443',
    HARDWARE_KEYSTORE: 'hardware',
  };
}, 60_000);
afterAll(async () => {
  await db.drop();
});

const start = (env: Record<string, string>) => runGateway(env, { entry: CHILD_MAIN });
const without = (...names: string[]): Record<string, string> => {
  const copy = { ...healthy };
  for (const name of names) delete copy[name];
  return copy;
};
/** Base injoignable : un refus de configuration ne doit PAS tenter de s'y connecter (sinon ECONNREFUSED). */
const unreachable = (password = STRONG): string =>
  `postgres://${ROLE}:${password}@127.0.0.1:1/none`;

describe('contrôle positif', () => {
  it('la configuration de production saine DÉMARRE (sinon les refus ne prouveraient rien)', async () => {
    const r = await start(healthy);
    expect({ listening: r.listening, stderr: r.stderr }).toEqual({ listening: true, stderr: '' });
    expect(r.stdout).toContain('GATEWAY listening https');
  }, 60_000);

  it('avec main.ts réel, la valeur de production « hardware » est refusée tant qu’aucun adaptateur n’existe', async () => {
    const r = await runGateway(healthy);
    expect(r.code).toBe(1);
    expect(r.listening).toBe(false);
    expect(r.stderr).toMatch(/aucun adaptateur matériel/);
  }, 60_000);
});

describe('un démarrage réel par réglage refusé en production (avant toute connexion à la base)', () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ['HARDWARE_KEYSTORE=fake', { HARDWARE_KEYSTORE: 'fake' }, /HARDWARE_KEYSTORE/],
    ['EDGE_CA factice', { EDGE_CA: 'fake' }, /EDGE_CA/],
    [
      'vérificateur d’identité de test',
      { GATEWAY_IDENTITY_VERIFIER: 'test' },
      /GATEWAY_IDENTITY_VERIFIER/,
    ],
    ['EDGE_FAILPOINT', { EDGE_FAILPOINT: 'before-local-write' }, /EDGE_FAILPOINT/],
    ['EDGE_ALLOW_FAILPOINTS', { EDGE_ALLOW_FAILPOINTS: '1' }, /EDGE_ALLOW_FAILPOINTS/],
    [
      'EDGE_FAILPOINT + EDGE_ALLOW_FAILPOINTS',
      { EDGE_FAILPOINT: 'kill-local-database', EDGE_ALLOW_FAILPOINTS: '1' },
      /EDGE_FAILPOINT[\s\S]*EDGE_ALLOW_FAILPOINTS/,
    ],
    ['CORS_ALLOW_ALL', { CORS_ALLOW_ALL: '1' }, /CORS_ALLOW_ALL/],
    ['@authority à joker', { GATEWAY_REQUEST_AUTHORITY: '*:8443' }, /GATEWAY_REQUEST_AUTHORITY/],
    [
      '@authority « :* »',
      { GATEWAY_REQUEST_AUTHORITY: 'gateway.site.test:*' },
      /GATEWAY_REQUEST_AUTHORITY/,
    ],
    [
      '@authority à plusieurs valeurs',
      { GATEWAY_REQUEST_AUTHORITY: 'a.test:1,b.test:2' },
      /GATEWAY_REQUEST_AUTHORITY/,
    ],
    ['@authority vide', { GATEWAY_REQUEST_AUTHORITY: '' }, /GATEWAY_REQUEST_AUTHORITY/],
    ['secret de test', { GATEWAY_DATABASE_URL: unreachable('changeme') }, /GATEWAY_DATABASE_URL/],
    [
      'mot de passe publié du dépôt',
      { GATEWAY_DATABASE_URL: unreachable('edge_app_local') },
      /GATEWAY_DATABASE_URL/,
    ],
    ['GATEWAY_DEV_KEY_FILE', { GATEWAY_DEV_KEY_FILE: '/tmp/keys.json' }, /GATEWAY_DEV_KEY_FILE/],
    [
      'mot de passe de base vide',
      { GATEWAY_DATABASE_URL: `postgres://${ROLE}@127.0.0.1:1/none` },
      /mot de passe vide/,
    ],
    [
      'mot de passe « postgres »',
      { GATEWAY_DATABASE_URL: unreachable('postgres') },
      /GATEWAY_DATABASE_URL/,
    ],
    [
      'mot de passe « edge_app »',
      { GATEWAY_DATABASE_URL: unreachable('edge_app') },
      /GATEWAY_DATABASE_URL/,
    ],
    [
      'mot de passe égal au nom du rôle',
      { GATEWAY_DATABASE_URL: unreachable(ROLE) },
      /GATEWAY_DATABASE_URL/,
    ],
    [
      'mot de passe numérique',
      { GATEWAY_DATABASE_URL: unreachable('123456') },
      /GATEWAY_DATABASE_URL/,
    ],
    ['NODE_ENV=prod', { NODE_ENV: 'prod' }, /NODE_ENV/],
    ['NODE_ENV=staging', { NODE_ENV: 'staging' }, /NODE_ENV/],
    ['NODE_ENV=Production', { NODE_ENV: 'Production' }, /NODE_ENV/],
    ['NODE_ENV vide', { NODE_ENV: '' }, /NODE_ENV/],
  ];
  it.each(cases)(
    '%s',
    async (_name, change, expected) => {
      const env = { ...healthy, GATEWAY_DATABASE_URL: unreachable(), ...change };
      const r = await start(env);
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(expected);
      expect(r.stderr).not.toMatch(/ECONNREFUSED|connect/i);
      expect(r.stderr).not.toContain(STRONG);
    },
    60_000,
  );

  it.each([
    ['NODE_ENV absent', 'NODE_ENV'],
    ['TLS absent (écoute en clair)', 'GATEWAY_TLS_CERT_FILE'],
  ])(
    '%s',
    async (_name, removed) => {
      const env = {
        ...without(removed, ...(removed === 'NODE_ENV' ? [] : ['GATEWAY_TLS_KEY_FILE'])),
        GATEWAY_DATABASE_URL: unreachable(),
      };
      const r = await start(env);
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(removed === 'NODE_ENV' ? /NODE_ENV/ : /GATEWAY_TLS/);
      expect(r.stderr).not.toMatch(/ECONNREFUSED/);
    },
    60_000,
  );

  it('port d’administration sans TLS : démarrage refusé en production (décision 47)', async () => {
    const env = {
      ...without('GATEWAY_ADMIN_TLS_CERT_FILE', 'GATEWAY_ADMIN_TLS_KEY_FILE'),
      GATEWAY_DATABASE_URL: unreachable(),
    };
    const r = await start(env);
    expect(r.code).toBe(1);
    expect(r.listening).toBe(false);
    expect(r.stderr).toMatch(/GATEWAY_ADMIN_TLS_CERT_FILE/);
    expect(r.stderr).not.toMatch(/ECONNREFUSED/);
  }, 60_000);

  it('plusieurs violations à la fois : toutes nommées dans le même message', async () => {
    const r = await start({
      ...healthy,
      GATEWAY_DATABASE_URL: unreachable('changeme'),
      HARDWARE_KEYSTORE: 'fake',
      EDGE_ALLOW_FAILPOINTS: '1',
      CORS_ALLOW_ALL: '1',
      EDGE_CA: 'fake',
    });
    expect(r.code).toBe(1);
    for (const name of [
      'HARDWARE_KEYSTORE',
      'EDGE_ALLOW_FAILPOINTS',
      'CORS_ALLOW_ALL',
      'EDGE_CA',
      'GATEWAY_DATABASE_URL',
    ]) {
      expect(r.stderr).toContain(name);
    }
    expect(r.stderr).not.toContain('changeme');
  }, 60_000);

  it('GATEWAY_* inconnue : refusée', async () => {
    const r = await start({ ...healthy, GATEWAY_LISTEN_PROT: '1' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/GATEWAY_LISTEN_PROT/);
  }, 60_000);
});

describe('réglages du serveur PostgreSQL local', () => {
  it('synchronous_commit désactivé (ALTER DATABASE) : refusé, nommé', async () => {
    await admin((c) => c.query(`ALTER DATABASE ${db.name} SET synchronous_commit = off`));
    try {
      const r = await start(healthy);
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(/synchronous_commit/);
    } finally {
      await admin((c) => c.query(`ALTER DATABASE ${db.name} RESET synchronous_commit`));
    }
  }, 60_000);

  it('rôle superutilisateur : refusé', async () => {
    const url = `postgres://${process.env.PGUSER ?? 'postgres'}:${STRONG}@127.0.0.1:${process.env.PGPORT ?? '5433'}/${db.name}`;
    const r = await start({ ...healthy, GATEWAY_DATABASE_URL: url });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/superutilisateur/);
  }, 60_000);

  describe('conteneur PostgreSQL 17 jetable', () => {
    const containers: string[] = [];
    afterAll(() => {
      for (const name of containers) {
        try {
          execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
        } catch {
          /* déjà supprimé */
        }
      }
    });

    async function container(flags: string[]): Promise<{ port: string; url: string }> {
      const port = String(await freePort());
      const name = `cashless_m8_edge_pg_${port}`;
      containers.push(name);
      execFileSync(
        'docker',
        [
          'run',
          '-d',
          '--name',
          name,
          '-e',
          'POSTGRES_HOST_AUTH_METHOD=trust',
          '-p',
          `127.0.0.1:${port}:5432`,
          'postgres:17',
          'postgres',
          ...flags,
        ],
        { stdio: 'ignore' },
      );
      for (let i = 0; i < 60; i += 1) {
        try {
          await admin(async (c) => void (await c.query('SELECT 1')), port);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      // Le serveur redémarre une fois pendant l'initialisation de l'image : on attend qu'il réponde
      // deux fois.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await ensureRole(port, ROLE, STRONG);
      await admin((c) => c.query(`CREATE DATABASE gw OWNER ${ROLE}`), port);
      return { port, url: `postgres://${ROLE}:${STRONG}@127.0.0.1:${port}/gw` };
    }

    it.each([
      ['fsync', ['-c', 'fsync=off'], /fsync/],
      ['full_page_writes', ['-c', 'full_page_writes=off'], /full_page_writes/],
    ])(
      '%s désactivé : refusé, nommé',
      async (_name, flags, expected) => {
        const pg = await container(flags);
        const r = await start({ ...healthy, GATEWAY_DATABASE_URL: pg.url });
        expect(r.code).toBe(1);
        expect(r.listening).toBe(false);
        expect(r.stderr).toMatch(expected);
      },
      120_000,
    );

    it('fsync et full_page_writes désactivés ensemble : les deux nommés', async () => {
      const pg = await container(['-c', 'fsync=off', '-c', 'full_page_writes=off']);
      const r = await start({ ...healthy, GATEWAY_DATABASE_URL: pg.url });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/fsync/);
      expect(r.stderr).toMatch(/full_page_writes/);
    }, 120_000);
  });
});

it('le faux du port matériel porte isFake et la garde de production le refuse au niveau des objets instanciés', () => {
  const { evaluateProviderRules } = jest.requireActual('../../src/processes/startup-guard');
  const production = { production: true } as never;
  expect(
    evaluateProviderRules(production, {
      keystore: new FakeHardwareKeystore(),
      catchUp: {},
      deltaPurgeProvided: true,
    }),
  ).toHaveLength(1);
  expect(
    evaluateProviderRules(production, { keystore: {}, catchUp: {}, deltaPurgeProvided: true }),
  ).toHaveLength(0);
  expect(
    evaluateProviderRules(production, { keystore: {}, catchUp: {}, deltaPurgeProvided: false }),
  ).toHaveLength(1);
});

describe('registre des règles de production des lots suivants', () => {
  it('une règle enregistrée refuse en production seulement', () => {
    const guard = jest.requireActual('../../src/processes/startup-guard');
    guard.registerProductionRule('faux-de-test', () => 'FAUX_DE_TEST : interdit');
    expect(() => guard.registerProductionRule('faux-de-test', () => null)).toThrow(/déjà/);
    const input = (production: boolean) => ({
      config: {
        production,
        hardwareKeystore: 'hardware',
        edgeCa: null,
        identityVerifier: null,
        failpoint: null,
        allowFailpoints: null,
        tlsCertFile: '/c',
        tlsKeyFile: '/k',
        requestAuthority: 'a.test:1',
        databaseUrl: 'postgres://u@h/d',
        centralUrl: null,
        identityJwksUrl: null,
      } as never,
      env: {},
    });
    expect(guard.evaluateConfigRules(input(true))).toContain('FAUX_DE_TEST : interdit');
    expect(guard.evaluateConfigRules(input(false))).toEqual([]);
  });
});

describe('câblage de bootstrap prouvé par de vrais démarrages de production', () => {
  it('DELTA_PURGE absent : refus au démarrage (message DELTA_PURGE, aucun port)', async () => {
    const r = await start({ ...healthy, TEST_CHILD_NO_DELTA_PURGE: '1' });
    expect(r.listening).toBe(false);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/DELTA_PURGE/);
  }, 60_000);

  it('clé client égale à une clé du port : refus au démarrage', async () => {
    const keysDir = tempDir();
    const keyFile = join(keysDir, 'keys.json');
    chmodSync(keysDir, 0o700);
    const store = new FakeHardwareKeystore({ keyFile });
    await store.publicKey('batch');
    const keys = JSON.parse(readFileSync(keyFile, 'utf8')) as { keys: Record<string, string> };
    const clientKey = join(keysDir, 'client.key');
    writeFileSync(
      clientKey,
      `-----BEGIN PRIVATE KEY-----\n${keys.keys.batch}\n-----END PRIVATE KEY-----\n`,
      { mode: 0o600 },
    );
    const env = {
      ...healthy,
      GATEWAY_CENTRAL_CLIENT_KEY_FILE: clientKey,
      TEST_CHILD_KEYSTORE_KEY_FILE: keyFile,
    };
    const r = await start(env);
    expect(r.listening).toBe(false);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/GATEWAY_CENTRAL_CLIENT_KEY_FILE : clé identique à une clé du port/);
    // Contrôle positif avec le même fichier de clés du port mais une clé client distincte.
    const ok = await start({ ...healthy, TEST_CHILD_KEYSTORE_KEY_FILE: keyFile });
    expect({ listening: ok.listening, stderr: ok.stderr }).toEqual({ listening: true, stderr: '' });
  }, 120_000);
});
