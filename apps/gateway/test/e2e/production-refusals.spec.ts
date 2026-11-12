// T116 / NFR-009, SC-007 : chaque règle de la garde de production a SON démarrage réel (processus
// enfant, code de sortie 1, message qui nomme le réglage, aucun port ouvert).
//   - l'énumération vient du CODE : `productionRuleNames()` (règles intégrées et enregistrées par
//     les lots, dont celles qui s'enregistrent à l'import de leur module : on les trouve en
//     parcourant `src/`), les règles du serveur local et celles des objets instanciés ;
//   - la suite échoue si une règle du code n'a pas de cas ici, ou si un cas n'a plus de règle
//     (retirer une règle sans son test, ou l'inverse) ;
//   - contrôle positif : la configuration de production saine démarre ;
//   - côté central : démarrage réel du processus `edge` en production avec le faux de l'autorité
//     des passerelles, refusé ; les autres faux du central sont énumérés depuis `bootstrap.ts` et
//     rattachés à la suite qui les prouve.
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  evaluateProviderRules,
  evaluateServerRules,
  productionRuleNames,
} from '../../src/processes/startup-guard';
import { admin, createTestDb, ensureRole, type TestDb } from '../startup/_support/db';
import { CHILD_MAIN, freePort, runGateway } from '../startup/_support/child';
import { enrolledFixture, tempDir } from '../startup/_support/fixture';
import { makeCa } from '../startup/_support/pki';
import { FakeInProductionError } from '../../../api/src/kms/production-guard';
import { startEdge } from '../../../api/test/support/edge-fixtures';
import { DEVICE_PRODUCTION } from '../../../api/test/support/tls';

const GATEWAY = join(__dirname, '..', '..');
const API = join(GATEWAY, '..', 'api');
const STRONG = 'Zk9-Longue-Phrase-8hQw3';
const ROLE = 'edge_app_prod';

/** Modules qui s'enregistrent à l'import : on les charge tous, sans en oublier un futur. */
function loadRegisteringModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (
        name.endsWith('.ts') &&
        !path.endsWith('startup-guard.ts') &&
        readFileSync(path, 'utf8').includes('registerProductionRule(')
      )
        found.push(path);
    }
  };
  walk(join(GATEWAY, 'src'));
  for (const path of found) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(path);
    } catch {
      /* module déjà chargé ou dépendances de test : la règle est alors déjà enregistrée */
    }
  }
  return found.map((p) => relative(GATEWAY, p));
}

let dir: string;
let healthy: Record<string, string>;
let db: TestDb;

const unreachable = (password = STRONG): string =>
  `postgres://${ROLE}:${password}@127.0.0.1:1/none`;
const start = (env: Record<string, string>) => runGateway(env, { entry: CHILD_MAIN });
const without = (...names: string[]): Record<string, string> => {
  const copy = { ...healthy };
  for (const name of names) delete copy[name];
  return copy;
};

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
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

interface Case {
  /** Variables à changer (ou à retirer : valeur `null`). */
  env: Record<string, string | null>;
  expected: RegExp;
}
const cfg = (env: Record<string, string | null>, expected: RegExp): Case => ({ env, expected });

/** Un cas par règle de configuration (nom = nom enregistré dans la garde). */
const CONFIG_CASES: Record<string, Case[]> = {
  HARDWARE_KEYSTORE: [cfg({ HARDWARE_KEYSTORE: 'fake' }, /HARDWARE_KEYSTORE/)],
  EDGE_CA: [cfg({ EDGE_CA: 'fake' }, /EDGE_CA/)],
  GATEWAY_IDENTITY_VERIFIER: [
    cfg({ GATEWAY_IDENTITY_VERIFIER: 'test' }, /GATEWAY_IDENTITY_VERIFIER/),
  ],
  GATEWAY_DEV_KEY_FILE: [cfg({ GATEWAY_DEV_KEY_FILE: '/tmp/keys.json' }, /GATEWAY_DEV_KEY_FILE/)],
  EDGE_FAILPOINT: [cfg({ EDGE_FAILPOINT: 'before-local-write' }, /EDGE_FAILPOINT/)],
  EDGE_ALLOW_FAILPOINTS: [cfg({ EDGE_ALLOW_FAILPOINTS: '1' }, /EDGE_ALLOW_FAILPOINTS/)],
  CORS_ALLOW_ALL: [cfg({ CORS_ALLOW_ALL: '1' }, /CORS_ALLOW_ALL/)],
  GATEWAY_TLS: [cfg({ GATEWAY_TLS_CERT_FILE: null, GATEWAY_TLS_KEY_FILE: null }, /GATEWAY_TLS/)],
  GATEWAY_REQUEST_AUTHORITY: [
    cfg({ GATEWAY_REQUEST_AUTHORITY: '*:8443' }, /GATEWAY_REQUEST_AUTHORITY/),
    cfg({ GATEWAY_REQUEST_AUTHORITY: 'gateway.site.test:*' }, /GATEWAY_REQUEST_AUTHORITY/),
    cfg({ GATEWAY_REQUEST_AUTHORITY: 'a.test:1,b.test:2' }, /GATEWAY_REQUEST_AUTHORITY/),
  ],
  GATEWAY_DATABASE_URL: [
    cfg({ GATEWAY_DATABASE_URL: unreachable('changeme') }, /GATEWAY_DATABASE_URL/),
    cfg({ GATEWAY_DATABASE_URL: unreachable('edge_app_local') }, /GATEWAY_DATABASE_URL/),
    cfg({ GATEWAY_DATABASE_URL: unreachable(ROLE) }, /GATEWAY_DATABASE_URL/),
  ],
  GATEWAY_CENTRAL_URL: [
    cfg({ GATEWAY_CENTRAL_URL: 'http://central.example.test' }, /GATEWAY_CENTRAL_URL/),
  ],
  GATEWAY_IDENTITY_JWKS_URL: [
    cfg({ GATEWAY_IDENTITY_JWKS_URL: 'http://idp.example.test/jwks' }, /GATEWAY_IDENTITY_JWKS_URL/),
  ],
  GATEWAY_ADMIN_TLS: [
    cfg(
      { GATEWAY_ADMIN_TLS_CERT_FILE: null, GATEWAY_ADMIN_TLS_KEY_FILE: null },
      /GATEWAY_ADMIN_TLS_CERT_FILE/,
    ),
  ],
  IDENTITY_KEYS_IN_MEMORY: [
    cfg({ GATEWAY_IDENTITY_VERIFIER: 'test' }, /edge_identity_key|GATEWAY_IDENTITY_VERIFIER/),
  ],
};

/** Règles du temps 2 (serveur local) et des objets instanciés : cas dédiés plus bas. */
const SERVER_CASES = new Set(['fsync', 'full_page_writes', 'synchronous_commit', 'superuser']);
const PROVIDER_CASES = new Set([
  'HARDWARE_KEYSTORE#instance',
  'REPLICATION_CATCH_UP',
  'DELTA_PURGE',
]);
/** Autres refus de configuration jugés avant la garde (`loadConfig`), un démarrage réel chacun. */
const LOAD_CONFIG_CASES: Array<[string, Record<string, string | null>, RegExp]> = [
  ['NODE_ENV=staging', { NODE_ENV: 'staging' }, /NODE_ENV/],
  ['NODE_ENV=prod', { NODE_ENV: 'prod' }, /NODE_ENV/],
  ['NODE_ENV vide', { NODE_ENV: '' }, /NODE_ENV/],
  ['NODE_ENV absent', { NODE_ENV: null }, /NODE_ENV/],
];

const withEnv = (change: Record<string, string | null>): Record<string, string> => {
  const env: Record<string, string> = { ...healthy, GATEWAY_DATABASE_URL: unreachable() };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
};

function serverRuleIds(): string[] {
  const all = evaluateServerRules({ production: true } as never, {
    fsync: 'off',
    full_page_writes: 'off',
    synchronous_commit: 'off',
    is_superuser: 'on',
  });
  return all.map((m) => (m.includes('superutilisateur') ? 'superuser' : m.split(' : ')[0]!));
}
function providerRuleIds(): string[] {
  const all = evaluateProviderRules({ production: true } as never, {
    keystore: { isFake: true },
    catchUp: undefined,
    deltaPurgeProvided: false,
  });
  return all.map((m) => {
    const id = m.split(' : ')[0]!;
    return id === 'HARDWARE_KEYSTORE' ? 'HARDWARE_KEYSTORE#instance' : id;
  });
}

describe('énumération des règles du code', () => {
  it('chaque règle de configuration a un cas, chaque cas a sa règle', () => {
    const modules = loadRegisteringModules();
    expect(modules.length).toBeGreaterThanOrEqual(2); // admin-tls, identity-keys
    const names = productionRuleNames().sort();
    expect(new Set(names).size).toBe(names.length);
    const covered = Object.keys(CONFIG_CASES).sort();
    expect({ sansCas: names.filter((n) => !covered.includes(n)) }).toEqual({ sansCas: [] });
    expect({ sansRegle: covered.filter((n) => !names.includes(n)) }).toEqual({ sansRegle: [] });
  });

  it('chaque règle du serveur local et des objets instanciés a un cas', () => {
    expect(serverRuleIds().sort()).toEqual([...SERVER_CASES].sort());
    expect(providerRuleIds().sort()).toEqual([...PROVIDER_CASES].sort());
  });
});

describe('contrôle positif', () => {
  it('la configuration de production saine démarre (sinon rien n’est prouvé)', async () => {
    const r = await start(healthy);
    expect({ listening: r.listening, stderr: r.stderr }).toEqual({ listening: true, stderr: '' });
  }, 120_000);
});

describe('un démarrage réel par règle de configuration', () => {
  const rows = Object.entries(CONFIG_CASES).flatMap(([rule, cases]) =>
    cases.map((c, i) => [`${rule} #${i + 1}`, c] as const),
  );
  it.each(rows)(
    '%s : refusé, nommé, aucun port',
    async (_label, c) => {
      const r = await start(withEnv(c.env));
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(c.expected);
      expect(r.stderr).not.toMatch(/ECONNREFUSED/);
      expect(r.stderr).not.toContain(STRONG);
    },
    120_000,
  );

  it.each(LOAD_CONFIG_CASES)(
    '%s : refusé avant la garde',
    async (_label, change, expected) => {
      const r = await start(withEnv(change));
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(expected);
    },
    120_000,
  );

  it('plusieurs règles violées à la fois : toutes nommées', async () => {
    const r = await start(
      withEnv({
        HARDWARE_KEYSTORE: 'fake',
        EDGE_ALLOW_FAILPOINTS: '1',
        CORS_ALLOW_ALL: '1',
        EDGE_CA: 'fake',
      }),
    );
    for (const name of ['HARDWARE_KEYSTORE', 'EDGE_ALLOW_FAILPOINTS', 'CORS_ALLOW_ALL', 'EDGE_CA'])
      expect(r.stderr).toContain(name);
  }, 120_000);
});

describe('règles du serveur local et des objets instanciés (démarrage réel)', () => {
  it('synchronous_commit désactivé : refusé', async () => {
    await admin((c) => c.query(`ALTER DATABASE ${db.name} SET synchronous_commit = off`));
    try {
      const r = await start(healthy);
      expect(r.code).toBe(1);
      expect(r.listening).toBe(false);
      expect(r.stderr).toMatch(/synchronous_commit/);
    } finally {
      await admin((c) => c.query(`ALTER DATABASE ${db.name} RESET synchronous_commit`));
    }
  }, 120_000);

  it('rôle superutilisateur : refusé', async () => {
    // Le mot de passe du superutilisateur du serveur de test peut être trivial (en CI :
    // `PGPASSWORD=postgres`), refusé par la règle du secret avant la règle du rôle. Un
    // superutilisateur jetable au mot de passe fort isole donc la seule règle du rôle.
    const su = 'edge_su_refusal_test';
    await admin(async (c) => {
      await c.query(`DROP ROLE IF EXISTS ${su}`);
      await c.query(`CREATE ROLE ${su} LOGIN SUPERUSER PASSWORD '${STRONG}'`);
    });
    try {
      const url = `postgres://${su}:${STRONG}@127.0.0.1:${process.env.PGPORT ?? '5433'}/${db.name}`;
      const r = await start({ ...healthy, GATEWAY_DATABASE_URL: url });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/superutilisateur/);
    } finally {
      await admin((c) => c.query(`DROP ROLE IF EXISTS ${su}`));
    }
  }, 120_000);

  it('DELTA_PURGE absent : refusé (main.ts réel, règle des objets instanciés)', async () => {
    const r = await runGateway(
      { ...healthy, TEST_CHILD_NO_DELTA_PURGE: '1' },
      { entry: CHILD_MAIN },
    );
    expect(r.code).toBe(1);
    expect(r.listening).toBe(false);
    expect(r.stderr).toMatch(/DELTA_PURGE/);
  }, 120_000);

  it('HARDWARE_KEYSTORE : main.ts réel, aucun adaptateur matériel, refus', async () => {
    // `main.ts` réel : aucun adaptateur matériel n'existe, la valeur de production `hardware` est
    // refusée, le faux n'est jamais servi en production.
    const r = await runGateway(healthy);
    expect(r.code).toBe(1);
    expect(r.listening).toBe(false);
    expect(r.stderr).toMatch(/aucun adaptateur matériel/);
  }, 120_000);

  it('REPLICATION_CATCH_UP : bouchon refusé (règle des objets instanciés, appel direct)', () => {
    const { unavailableCatchUp } = jest.requireActual('../../src/authority/ports');
    const messages = evaluateProviderRules({ production: true } as never, {
      keystore: {},
      catchUp: unavailableCatchUp,
      deltaPurgeProvided: true,
    });
    expect(messages.join('\n')).toMatch(/REPLICATION_CATCH_UP/);
    expect(
      evaluateProviderRules({ production: true } as never, {
        keystore: {},
        catchUp: {},
        deltaPurgeProvided: true,
      }),
    ).toEqual([]);
  });

  describe('conteneur PostgreSQL 17 jetable (fsync, full_page_writes)', () => {
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
    async function container(flags: string[]): Promise<{ url: string }> {
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
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await ensureRole(port, ROLE, STRONG);
      await admin((c) => c.query(`CREATE DATABASE gw OWNER ${ROLE}`), port);
      return { url: `postgres://${ROLE}:${STRONG}@127.0.0.1:${port}/gw` };
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
      180_000,
    );
  });
});

describe('central : aucun faux en production', () => {
  /** Faux nommés par `assertProcessIsSafe` (lus dans le code du central). */
  const centralFakes = (): string[] => {
    const text = readFileSync(join(API, 'src', 'processes', 'bootstrap.ts'), 'utf8');
    const block = text.slice(text.indexOf('assertNoFakeInProduction(config.production, {'));
    return [...block.slice(0, block.indexOf('});')).matchAll(/'([^']+)': optional/g)].map(
      (m) => m[1]!,
    );
  };
  /** Pour chaque faux : le démarrage réel du processus `edge` ou la suite qui le prouve. */
  const COVERAGE: Record<string, { edgeProcess: boolean; suite?: string }> = {
    'le service de clés': { edgeProcess: false, suite: 'test/unit/production-guard.spec.ts' },
    'le signataire de snapshots': {
      edgeProcess: false,
      suite: 'test/unit/production-guard.spec.ts',
    },
    'l’identité du terminal': { edgeProcess: false, suite: 'test/unit/production-guard.spec.ts' },
    'l’identité du festivalier': {
      edgeProcess: false,
      suite: 'test/unit/production-guard.spec.ts',
    },
    'l’autorité des terminaux': { edgeProcess: false, suite: 'test/unit/device-ca.spec.ts' },
    'l’autorité des passerelles': { edgeProcess: true, suite: 'test/unit/edge-ca.spec.ts' },
    'le signataire des jetons d’appareil': {
      edgeProcess: false,
      suite: 'test/unit/device-token.spec.ts',
    },
    'le vérificateur d’attestation': {
      edgeProcess: false,
      suite: 'test/unit/production-guard.spec.ts',
    },
    'l’accès central des lots de passerelle': { edgeProcess: true },
    'la preuve de passage des lots de passerelle': { edgeProcess: true },
    'les adaptateurs PSP': { edgeProcess: false, suite: 'test/unit/production-guard.spec.ts' },
    'le coffre des secrets PSP': {
      edgeProcess: false,
      suite: 'test/unit/production-guard.spec.ts',
    },
    'le processeur d’opérations hors ligne': {
      edgeProcess: false,
      suite: 'test/unit/production-guard.spec.ts',
    },
  };

  it('chaque faux du central est rattaché à un démarrage réel ou à une suite qui existe', () => {
    const fakes = centralFakes();
    expect(fakes.length).toBeGreaterThanOrEqual(10);
    expect({ sansCas: fakes.filter((f) => !(f in COVERAGE)) }).toEqual({ sansCas: [] });
    expect({ sansFaux: Object.keys(COVERAGE).filter((f) => !fakes.includes(f)) }).toEqual({
      sansFaux: [],
    });
    for (const [name, c] of Object.entries(COVERAGE)) {
      if (c.suite === undefined) continue;
      const file = join(API, c.suite);
      expect({ name, existe: existsSync(file) }).toEqual({ name, existe: true });
    }
  });

  it('processus edge du central en production : le faux EDGE_CA refuse', async () => {
    // Vrai `NestFactory`, vrai `serve`, configuration de production complète : seul le faux de
    // l'autorité des passerelles (le central n'a pas encore d'adaptateur réel) est refusé.
    const saved = { ...process.env };
    const production = {
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
      TRUST_PROXY_HOPS: '0',
      ...DEVICE_PRODUCTION,
    };
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      Object.assign(process.env, production);
      const error = await startEdge({ ...production }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(FakeInProductionError);
      expect((error as FakeInProductionError).names).toEqual(['l’autorité des passerelles']);
      expect(String((error as Error).message)).toMatch(/interdit en production/);
    } finally {
      jest.restoreAllMocks();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  }, 180_000);
});
