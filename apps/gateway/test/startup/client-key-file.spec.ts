// Décision 32 (ADR-168) : la clé TLS client du central, en fichier jusqu'à la mission 12b, est
// durcie. Un test par contrôle ; chacun échoue si le contrôle est retiré.
import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CentralClient } from '../../src/central-client/central-client';
import { clientKeyDistinctViolations, inspectClientKey } from '../../src/config/client-key-file';
import { ConfigError, loadConfig } from '../../src/config/config';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { KEY_USES } from '../../src/key-store/hardware-keystore.port';
import { evaluateProviderRules } from '../../src/processes/startup-guard';
import { tempDir } from './_support/fixture';

// Module réel (et non la copie de `import * as`), pour que l'espion voie les appels de src/.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs: typeof import('node:fs') = require('node:fs');

const CANARY = 'CANARY-CLE-PRIVEE-NE-DOIT-JAMAIS-SORTIR';
const pem = (): string =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

function env(keyFile: string, production: boolean): Record<string, string> {
  return {
    NODE_ENV: production ? 'production' : 'test',
    GATEWAY_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none',
    GATEWAY_LISTEN_PORT: '8443',
    GATEWAY_ADMIN_PORT: '8444',
    GATEWAY_CENTRAL_URL: 'https://central.example.test',
    GATEWAY_REQUEST_AUTHORITY: 'gw.test:8443',
    HARDWARE_KEYSTORE: production ? 'hardware' : 'fake',
    GATEWAY_CENTRAL_CLIENT_CERT_FILE: '/etc/gw/client.crt',
    GATEWAY_CENTRAL_CLIENT_KEY_FILE: keyFile,
  };
}

function keyIn(dir: string, mode = 0o600, content = pem()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'client.key');
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
  return file;
}

const refusal = (e: Record<string, string>): string => {
  try {
    loadConfig(e);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('démarrage non refusé');
};

describe.each([true, false])('fichier de la clé client (production = %s)', (production) => {
  it('0600 dans un répertoire fermé : accepté', () => {
    expect(loadConfig(env(keyIn(tempDir()), production)).centralClientKeyFile).not.toBeNull();
  });

  it.each([0o640, 0o604, 0o644, 0o660, 0o666])('mode %o refusé', (mode) => {
    expect(refusal(env(keyIn(tempDir(), mode), production))).toMatch(
      /GATEWAY_CENTRAL_CLIENT_KEY_FILE : mode 0600/,
    );
  });

  it.each([0o720, 0o702, 0o777])('répertoire en mode %o refusé', (mode) => {
    const dir = tempDir();
    const file = keyIn(dir);
    chmodSync(dir, mode);
    try {
      expect(refusal(env(file, production))).toMatch(/répertoire modifiable/);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('lien symbolique refusé (même vers un fichier 0600)', () => {
    const dir = tempDir();
    const real = keyIn(join(dir, 'real'));
    const link = join(dir, 'link.key');
    symlinkSync(real, link);
    expect(refusal(env(link, production))).toMatch(/lien symbolique/);
  });

  it('le contenu de la clé ne sort jamais, ni dans le message de refus', () => {
    const message = refusal(env(keyIn(tempDir(), 0o644, CANARY), production));
    expect(message).not.toContain(CANARY);
    expect(message).not.toMatch(/PRIVATE KEY/);
  });
});

it('fichier absent : refusé en production seulement (la lecture échouera sans secret ailleurs)', () => {
  const absent = join(tempDir(), 'absent.key');
  expect(refusal(env(absent, true))).toMatch(/absent/);
  expect(loadConfig(env(absent, false)).centralClientKeyFile).toBe(absent);
});

describe('clé distincte des clés du port', () => {
  it.each(KEY_USES)(
    'la clé « %s » du port réutilisée comme clé client est refusée',
    async (use) => {
      const keystore = new FakeHardwareKeystore();
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      // Le faux n'exporte rien : on prépare la clé du port à l'identique de celle du fichier.
      const dir = tempDir();
      const file = join(dir, 'keys.json');
      const store = new FakeHardwareKeystore({ keyFile: file });
      await store.publicKey(use);
      const shared = JSON.parse(readFileSync(file, 'utf8')) as {
        keys: Record<string, string>;
      };
      const pkcs8Pem = `-----BEGIN PRIVATE KEY-----\n${shared.keys[use]}\n-----END PRIVATE KEY-----\n`;
      const clientKey = keyIn(join(dir, 'c'), 0o600, pkcs8Pem);
      const violations = await clientKeyDistinctViolations(clientKey, store);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/identique à une clé du port/);
      expect(violations[0]).not.toContain(shared.keys[use]);
      // Contrôle négatif : une clé indépendante passe.
      expect(await clientKeyDistinctViolations(keyIn(join(dir, 'd')), store)).toEqual([]);
      void keystore;
      void privateKey;
      void publicKey;
    },
  );

  it('un fichier illisible est refusé sans montrer son contenu', async () => {
    const violations = await clientKeyDistinctViolations(
      keyIn(tempDir(), 0o600, CANARY),
      new FakeHardwareKeystore(),
    );
    expect(violations).toHaveLength(1);
    expect(violations.join()).not.toContain(CANARY);
  });
});

describe('DELTA_PURGE en production', () => {
  const production = { production: true } as never;
  it('absent : refusé en production (le repli n’est permis que hors production)', () => {
    const out = evaluateProviderRules(production, {
      keystore: {},
      catchUp: {},
      deltaPurgeProvided: false,
    });
    expect(out).toEqual([expect.stringMatching(/^DELTA_PURGE/)]);
  });
  it('fourni : accepté ; hors production : le repli est permis', () => {
    expect(
      evaluateProviderRules(production, { keystore: {}, catchUp: {}, deltaPurgeProvided: true }),
    ).toEqual([]);
    expect(
      evaluateProviderRules({ production: false } as never, {
        keystore: {},
        catchUp: {},
        deltaPurgeProvided: false,
      }),
    ).toEqual([]);
  });
});

describe('lecture unique sur le descripteur contrôlé (anti-TOCTOU)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('un fichier remplacé entre le contrôle et la lecture n’est jamais lu (lecture par descripteur)', () => {
    const dir = tempDir();
    const original = pem();
    const file = keyIn(dir, 0o600, original);
    const evil = join(dir, 'evil.key');
    writeFileSync(evil, CANARY, { mode: 0o644 });
    const real = fs.readFileSync;
    const firstArgs: unknown[] = [];
    jest.spyOn(fs, 'readFileSync').mockImplementation(((target: never, ...rest: never[]) => {
      firstArgs.push(target);
      // Remplacement du chemin juste avant la lecture : par un fichier 0644 au contenu autre.
      fs.renameSync(evil, file);
      return (real as (...a: unknown[]) => unknown)(target, ...rest);
    }) as never);
    const result = inspectClientKey(file, true);
    expect(result.violations).toEqual([]);
    expect(result.key?.toString()).toBe(original);
    expect(typeof firstArgs[0]).toBe('number');
    // Le fichier du chemin est maintenant l'autre : un nouveau contrôle le refuse.
    expect(inspectClientKey(file, true).violations.join()).toMatch(/mode 0600/);
  });

  it('remplacé par un lien symbolique après un contrôle : l’ouverture suivante le refuse', () => {
    const dir = tempDir();
    const file = keyIn(dir);
    expect(inspectClientKey(file, true).violations).toEqual([]);
    fs.unlinkSync(file);
    symlinkSync(keyIn(join(dir, 'x')), file);
    expect(inspectClientKey(file, true).violations).toEqual([
      expect.stringMatching(/lien symbolique/),
    ]);
  });

  it('un chmod élargi avant la première lecture de central-client est refusé (contrôle de loadTrust)', async () => {
    const dir = tempDir();
    const file = keyIn(dir);
    const cert = join(dir, 'client.crt');
    writeFileSync(cert, 'cert');
    const tx = {
      run: async (fn: (t: unknown) => unknown) =>
        fn({
          query: async () => ({ rows: [{ central_url: 'https://c.test', central_ca_pem: 'x' }] }),
        }),
    };
    const client = new CentralClient(
      {
        production: true,
        centralClientCertFile: cert,
        centralClientKeyFile: file,
        centralUrl: null,
      } as never,
      tx as never,
      {} as never,
    );
    const load = (): Promise<unknown> =>
      (client as never as { loadTrust(): Promise<unknown> }).loadTrust();
    chmodSync(file, 0o644);
    await expect(load()).rejects.toThrow(/mode 0600/);
    chmodSync(file, 0o600);
    await expect(load()).resolves.toMatchObject({ key: expect.any(Buffer) });
  });
});

describe('propriétaire et nature du fichier (uid attendu injecté : le test ne peut pas changer de propriétaire sans root)', () => {
  const me = (process.getuid as () => number)();
  it('propriétaire du fichier différent de l’uid attendu : refusé', () => {
    const file = keyIn(tempDir());
    expect(inspectClientKey(file, true, me).violations).toEqual([]);
    const out = inspectClientKey(file, true, me + 1).violations.join();
    expect(out).toMatch(/propriétaire différent du processus/);
  });

  it('répertoire d’un autre propriétaire (ni l’uid attendu, ni root) : refusé', () => {
    const file = keyIn(tempDir());
    const out = inspectClientKey(file, true, me + 1).violations.join();
    expect(out).toMatch(/répertoire d'un autre propriétaire/);
  });

  it('un répertoire n’est pas un fichier ordinaire', () => {
    const dir = tempDir();
    chmodSync(dir, 0o700);
    const out = inspectClientKey(dir, true);
    expect(out.violations.join()).toMatch(/fichier ordinaire attendu/);
    expect(out.key).toBeNull();
  });

  it('un tube nommé n’est pas un fichier ordinaire et ne bloque pas l’ouverture', () => {
    const dir = tempDir();
    chmodSync(dir, 0o700);
    const fifo = join(dir, 'fifo.key');
    execFileSync('mkfifo', ['-m', '600', fifo]);
    expect(inspectClientKey(fifo, true).violations.join()).toMatch(/fichier ordinaire attendu/);
  });
});
