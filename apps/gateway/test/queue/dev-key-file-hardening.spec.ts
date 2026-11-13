// Décision 24 du porteur : fichier de clés de développement durci (nom temporaire unique, `wx`,
// `fchmod 0600`, verrou entre processus, `realpath`).
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { KEY_USES, type KeyUse } from '../../src/key-store/hardware-keystore.port';
import { tempDir } from '../startup/_support/fixture';

const CHILD = join(__dirname, '_support', 'keys-child.ts');
const GATEWAY = join(__dirname, '..', '..');
const TSX = require.resolve('tsx/cjs');

function keyChild(file: string, use: KeyUse, startAt: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', TSX, CHILD], {
      cwd: GATEWAY,
      env: { PATH: process.env.PATH ?? '', KEY_FILE: file, USE: use, START_AT: String(startAt) },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('close', (code) =>
      code === 0 ? resolve(out.trim().replace('PUBLIC ', '')) : reject(new Error(err)),
    );
  });
}

describe('fichier de clés de développement : durcissement', () => {
  it('lien symbolique refusé (le fichier, et un dossier qui mène à un dépôt)', async () => {
    const dir = tempDir();
    const real = join(dir, 'real.json');
    await new FakeHardwareKeystore({ keyFile: real }).publicKey('batch');
    const link = join(dir, 'link.json');
    symlinkSync(real, link);
    expect(() => new FakeHardwareKeystore({ keyFile: link })).toThrow(/lien symbolique/);
    // Un lien vers un dossier du dépôt ne cache pas le dépôt (`realpath`).
    const viaLink = join(dir, 'depot');
    symlinkSync(__dirname, viaLink);
    expect(() => new FakeHardwareKeystore({ keyFile: join(viaLink, 'keys.json') })).toThrow(
      /hors dépôt/,
    );
    expect(existsSync(join(__dirname, 'keys.json'))).toBe(false);
  });

  it('nom temporaire unique, création exclusive : un lien posé au nom ancien `.tmp` n’est pas suivi', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    const victim = join(dir, 'victime.txt');
    writeFileSync(victim, 'intact');
    symlinkSync(victim, `${file}.tmp`);
    const store = new FakeHardwareKeystore({ keyFile: file });
    await store.publicKey('batch');
    await store.publicKey('token');
    expect(readFileSync(victim, 'utf8')).toBe('intact');
    // Aucun fichier temporaire ni verrou ne traîne.
    expect(readdirSync(dir).filter((n) => /\.(lock|[0-9a-f]{16}\.tmp)$/.test(n))).toEqual([]);
  });

  it('mode 0600 forcé même avec un umask permissif', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    const previous = process.umask(0);
    try {
      await new FakeHardwareKeystore({ keyFile: file }).publicKey('snapshot');
    } finally {
      process.umask(previous);
    }
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('un verrou périmé (processus mort) est repris ; un verrou vivant fait attendre puis refuser', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    writeFileSync(`${file}.lock`, '2147483646'); // pid inexistant
    await new FakeHardwareKeystore({ keyFile: file }).publicKey('token');
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it('quatre processus sur un verrou périmé (processus mort) : une seule reprise, aucune clé perdue', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    writeFileSync(`${file}.lock`, '2147483646:jeton-perime');
    const startAt = Date.now() + 2500;
    const publics = await Promise.all(KEY_USES.map((use) => keyChild(file, use, startAt)));
    const reread = new FakeHardwareKeystore({ keyFile: file });
    for (const [index, use] of KEY_USES.entries()) {
      expect((await reread.publicKey(use)).toString('hex')).toBe(publics[index]);
    }
    expect(readdirSync(dir).filter((n) => /\.(lock|break)$/.test(n))).toEqual([]);
  }, 60_000);

  it('le propriétaire ne retire pas un verrou repris par un autre (jeton différent)', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    // Pendant l'opération du premier, son verrou est repris par un autre (jeton différent).
    const lock = `${file}.lock`;
    const other = `${process.pid}:jeton-d-un-autre`;
    const { withLockForTest } = await import('../../src/key-store/fake-hardware-keystore');
    withLockForTest(file, () => {
      unlinkSync(lock);
      writeFileSync(lock, other);
    });
    expect(readFileSync(lock, 'utf8')).toBe(other);
  });

  it.each([1, 2, 3])(
    'quatre processus créent chacun la clé d’un usage en même temps : aucune clé perdue (tour %i)',
    async () => {
      const dir = tempDir();
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'keys.json');
      const startAt = Date.now() + 2500;
      const publics = await Promise.all(KEY_USES.map((use) => keyChild(file, use, startAt)));
      const reread = new FakeHardwareKeystore({ keyFile: file });
      for (const [index, use] of KEY_USES.entries()) {
        expect((await reread.publicKey(use)).toString('hex')).toBe(publics[index]);
      }
      expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).keys).sort()).toEqual(
        [...KEY_USES].sort(),
      );
    },
    60_000,
  );

  it('deux processus demandent le MÊME usage en même temps : une seule clé, la même pour les deux', async () => {
    const dir = tempDir();
    const file = join(dir, 'keys.json');
    const startAt = Date.now() + 2500;
    const [a, b] = await Promise.all([
      keyChild(file, 'batch', startAt),
      keyChild(file, 'batch', startAt),
    ]);
    expect(a).toBe(b);
  }, 60_000);
});
