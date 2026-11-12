// Fichier de clés de développement du faux (T072) et commandes hors service (`request`, `enroll`) en deux
// processus réels.
import 'reflect-metadata';
import { createVerify, createPublicKey } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StartupRefusedError } from '../../src/processes/startup-guard';
import { assertRuntimeSafe } from '../../src/processes/bootstrap';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { createHardwareKeystore } from '../../src/key-store/hardware-keystore.factory';
import { admin, createTestDb, type TestDb } from './_support/db';
import { CHILD_MAIN, freePort, runGateway } from './_support/child';
import { tempDir } from './_support/fixture';
import { makeCa, makeEnrollmentFile } from './_support/pki';

describe('fichier de clés du faux', () => {
  it('deux instances sur le même fichier : mêmes clés, signatures vérifiables entre elles', async () => {
    const file = join(tempDir(), 'keys.json');
    const a = new FakeHardwareKeystore({ keyFile: file });
    const batch = await a.publicKey('batch');
    const agreement = await a.publicKey('agreement');
    const b = new FakeHardwareKeystore({ keyFile: file });
    expect((await b.publicKey('batch')).equals(batch)).toBe(true);
    expect((await b.publicKey('agreement')).equals(agreement)).toBe(true);
    const signature = await b.sign('batch', Buffer.from('lot'));
    const key = createPublicKey({ key: batch, format: 'der', type: 'spki' });
    const ok = createVerify('sha256')
      .update('lot')
      .verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
    expect(ok).toBe(true);
  });

  it('créé en 0600 ; un mode plus large est refusé à la lecture', async () => {
    const file = join(tempDir(), 'keys.json');
    await new FakeHardwareKeystore({ keyFile: file }).publicKey('token');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    for (const mode of [0o644, 0o640, 0o604, 0o660]) {
      chmodSync(file, mode);
      expect(() => new FakeHardwareKeystore({ keyFile: file })).toThrow(/0600/);
    }
    chmodSync(file, 0o600);
    expect(() => new FakeHardwareKeystore({ keyFile: file })).not.toThrow();
  });

  it('un fichier dans un dépôt git ou illisible est refusé', () => {
    expect(() => new FakeHardwareKeystore({ keyFile: join(__dirname, 'keys.json') })).toThrow(
      /hors dépôt/,
    );
    const file = join(tempDir(), 'keys.json');
    writeFileSync(file, '{pas du json', { mode: 0o600 });
    expect(() => new FakeHardwareKeystore({ keyFile: file })).toThrow(/illisible/);
  });

  it('destroy supprime la clé du fichier et reste vrai après relecture (NFR-013)', async () => {
    const file = join(tempDir(), 'keys.json');
    const a = new FakeHardwareKeystore({ keyFile: file });
    await a.publicKey('snapshot');
    await a.publicKey('token');
    await a.destroy('snapshot');
    const content = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(content.keys)).toEqual(['token']);
    expect(content.destroyed).toEqual(['snapshot']);
    const b = new FakeHardwareKeystore({ keyFile: file });
    await expect(b.publicKey('snapshot')).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
    await expect(b.sign('snapshot', Buffer.from('x'))).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('la fabrique transmet le fichier ; sans fichier, les clés restent en mémoire', async () => {
    const file = join(tempDir(), 'keys.json');
    const ks = createHardwareKeystore({ hardwareKeystore: 'fake', devKeyFile: file });
    await ks.publicKey('batch');
    expect(existsSync(file)).toBe(true);
    const other = createHardwareKeystore({ hardwareKeystore: 'fake' });
    await other.publicKey('batch');
    expect(JSON.stringify(readFileSync(file, 'utf8'))).not.toContain('other');
  });
});

describe('commandes request et enroll en deux processus réels', () => {
  let db: TestDb;
  let env: Record<string, string>;
  let dir: string;
  beforeAll(async () => {
    db = await createTestDb();
    dir = tempDir();
    env = {
      NODE_ENV: 'test',
      GATEWAY_DATABASE_URL: db.url,
      GATEWAY_REQUEST_AUTHORITY: 'passerelle.site.test:8443',
      GATEWAY_DEV_KEY_FILE: join(dir, 'keys.json'),
    };
  });
  afterAll(async () => {
    await db.drop();
  });

  const request = async (name: string) => {
    const out = join(dir, name);
    const r = await runGateway(env, {
      args: ['request', '--serial', 'GW-TEST-1', '--role', 'PRIMARY', '--out', out],
    });
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
    return JSON.parse(readFileSync(out, 'utf8'));
  };

  it('request deux fois : mêmes clés publiques ; puis enroll dans un autre processus', async () => {
    const first = await request('r1.json');
    const second = await request('r2.json');
    for (const key of [
      'batch_public_key',
      'snapshot_public_key',
      'token_public_key',
      'agreement_public_key',
      'snapshot_key_id',
    ]) {
      expect(second[key]).toBe(first[key]);
    }
    // Le fichier d'enrôlement de l'outil est construit sur la clé annoncée par la demande.
    const keystore = new FakeHardwareKeystore({ keyFile: env.GATEWAY_DEV_KEY_FILE! });
    expect((await keystore.publicKey('batch')).toString('base64url')).toBe(first.batch_public_key);
    const file = await makeEnrollmentFile(keystore, { serial: 'GW-TEST-1' });
    const path = join(dir, 'enrollment.json');
    writeFileSync(path, JSON.stringify(file));
    const r = await runGateway(env, { args: ['enroll', path] });
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
    expect(existsSync(path)).toBe(false);
    const meta = await db.pool.query('SELECT gateway_id FROM edge_meta');
    expect(meta.rows[0].gateway_id).toBe(file.gateway_id);
  }, 120_000);

  it('enroll avec une autre clé que celle du fichier : KEY_MISMATCH, rien en base', async () => {
    const other = await createTestDb();
    try {
      const file = await makeEnrollmentFile(new FakeHardwareKeystore());
      const path = join(dir, 'wrong.json');
      writeFileSync(path, JSON.stringify(file));
      const r = await runGateway(
        { ...env, GATEWAY_DATABASE_URL: other.url },
        { args: ['enroll', path] },
      );
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/clé de lot/);
      expect((await other.pool.query('SELECT 1 FROM edge_meta')).rows).toHaveLength(0);
    } finally {
      await other.drop();
    }
  }, 60_000);
});

describe('request et enroll appliquent les contrôles du serveur en production', () => {
  const STRONG = 'Zk9-Longue-Phrase-8hQw3';
  const ROLE = 'edge_app_prod';
  let db: TestDb;
  let healthy: Record<string, string>;
  let dir: string;
  beforeAll(async () => {
    dir = tempDir();
    const ca = await makeCa('CN=gateway.site.test');
    writeFileSync(join(dir, 'tls.crt'), ca.certPem);
    writeFileSync(join(dir, 'tls.key'), ca.keyPem, { mode: 0o600 });
    db = await createTestDb({ role: ROLE, password: STRONG });
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
  const run = (env: Record<string, string>, args: string[]) =>
    runGateway(env, { entry: CHILD_MAIN, args });

  it('contrôle positif : request en production saine réussit', async () => {
    const out = join(dir, 'ok.json');
    const r = await run(healthy, ['request', '--serial', 'S', '--role', 'PRIMARY', '--out', out]);
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
    expect(existsSync(out)).toBe(true);
  }, 60_000);

  it('synchronous_commit désactivé : request et enroll refusés, rien n’est écrit', async () => {
    await admin((c) => c.query(`ALTER DATABASE ${db.name} SET synchronous_commit = off`));
    try {
      const out = join(dir, 'refused.json');
      const a = await run(healthy, ['request', '--serial', 'S', '--role', 'PRIMARY', '--out', out]);
      expect(a.code).toBe(1);
      expect(a.stderr).toMatch(/synchronous_commit/);
      expect(existsSync(out)).toBe(false);
      const b = await run(healthy, ['enroll', join(dir, 'absent.json')]);
      expect(b.code).toBe(1);
      expect(b.stderr).toMatch(/synchronous_commit/);
      const c = await run(healthy, ['migrate']);
      expect(c.stderr).toMatch(/synchronous_commit/);
    } finally {
      await admin((c) => c.query(`ALTER DATABASE ${db.name} RESET synchronous_commit`));
    }
  }, 120_000);

  it('rôle superutilisateur : enroll refusé', async () => {
    const url = `postgres://${process.env.PGUSER ?? 'postgres'}:${STRONG}@127.0.0.1:${
      process.env.PGPORT ?? '5433'
    }/${db.name}`;
    const r = await run({ ...healthy, GATEWAY_DATABASE_URL: url }, ['enroll', '/absent.json']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/superutilisateur/);
  }, 60_000);

  it('un faux instancié est refusé par le contrôle commun, avant toute connexion', async () => {
    const config = { production: true, databaseUrl: 'postgres://u:p@127.0.0.1:1/x' } as never;
    const app = { get: () => new FakeHardwareKeystore() } as never;
    await expect(assertRuntimeSafe(config, app)).rejects.toBeInstanceOf(StartupRefusedError);
  });
});
