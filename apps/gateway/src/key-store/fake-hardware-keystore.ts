// Faux du port matériel, pour le développement et les tests SEULEMENT (`isFake = true` : refusé en production).
// ES256 P-256 pour `snapshot`, `token`, `batch`, ECDH P-256 pour `agreement`, générés au premier usage. Les clés sont
// dans des champs privés (`#`) : aucune réflexion sur l'objet ne les atteint, aucune méthode ne les exporte, rien
// n'est écrit en journal ni en base. `destroy(use)` oublie la clé et toute copie, y compris dans le fichier ; ensuite
// `sign`, `agree` et `publicKey` refusent (`KEY_DESTROYED`), même après un redémarrage (NFR-013, WP24).
//
// Fichier de clés de développement (`GATEWAY_DEV_KEY_FILE`, optionnel) : sans lui les clés ne vivent que dans le
// processus. Avec lui, elles survivent à un redémarrage ou à un SIGKILL (commandes `request` puis `enroll` en deux
// processus, bancs de reprise). Le fichier contient des clés PRIVÉES de développement : il est créé en mode 0600, son
// mode est VÉRIFIÉ à l'ouverture (tout accès pour le groupe ou les autres le fait refuser), il ne peut pas se trouver
// dans un dépôt git, et la garde de démarrage refuse le réglage en production.
// Décision 24 du porteur (09/11/2026), durcissement du fichier : écriture par un fichier temporaire à nom UNIQUE
// créé en exclusif (`wx`, jamais un nom fixe prévisible) puis `fchmod 0600` forcé, `rename` atomique ; un lien
// symbolique est refusé (le fichier lui-même et son dossier sont résolus par `realpath` avant le contrôle « hors
// dépôt ») ; un VERROU entre processus (fichier `<fichier>.lock` créé en exclusif, récupéré s'il est périmé ou si
// son propriétaire est mort) entoure toute lecture-modification-écriture : deux processus qui créent chacun une clé
// d'usage différent ne s'écrasent plus, et une clé déjà créée par l'autre processus est reprise, pas remplacée.
// Limite du faux : un objet de clé Node ne peut pas être effacé octet par octet ; seule la référence est coupée.
import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign as nodeSign,
  type KeyObject,
} from 'node:crypto';
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  KEY_USES,
  KeystoreError,
  type HardwareKeystore,
  type KeyUse,
} from './hardware-keystore.port';

interface Pair {
  privateKey: KeyObject;
  publicDer: Buffer;
}

interface KeyFileContent {
  keys: Partial<Record<KeyUse, string>>;
  destroyed: KeyUse[];
}

/** Dossier du fichier résolu par `realpath` (un lien symbolique de dossier ne cache pas un dépôt). */
function resolvedDirectory(path: string): string {
  const directory = dirname(resolve(path));
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}

function insideGitRepository(path: string): boolean {
  for (let dir = resolvedDirectory(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const BREAK_STALE_MS = 5_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Verrou entre processus : création exclusive de `<fichier>.lock` (contenu `pid:jeton unique`). */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const content = `${process.pid}:${randomBytes(16).toString('hex')}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeSync(fd, content);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      breakIfStale(lock);
      if (Date.now() > deadline) {
        throw new KeystoreError('KEY_FILE_INVALID', 'GATEWAY_DEV_KEY_FILE : verrou indisponible');
      }
      sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    // Ne retire que SON verrou : repris comme périmé par un autre, il n'est plus le nôtre.
    removeIfContent(lock, content);
  }
}

/** Pour les tests seulement : inerte (refuse) en production. */
export const withLockForTest: typeof withLock = (file, fn) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('withLockForTest : réservé aux tests');
  }
  return withLock(file, fn);
};

function readQuiet(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function removeIfContent(lock: string, content: string): void {
  if (readQuiet(lock) !== content) return;
  try {
    unlinkSync(lock);
  } catch {
    // déjà retiré
  }
}

/**
 * Reprise d'un verrou périmé, SÉRIALISÉE par `<verrou>.break` (création exclusive) : sous ce
 * verrou, le contenu est relu et ne tombe que s'il est identique à celui jugé périmé. Le jeton
 * unique du contenu interdit de supprimer le verrou frais qu'un autre processus vient de poser.
 */
function breakIfStale(lock: string): void {
  const observed = readQuiet(lock);
  if (observed === null) return; // levé entre-temps
  const owner = Number(observed.split(':')[0]);
  let stale: boolean;
  try {
    stale =
      Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS ||
      (Number.isInteger(owner) && owner > 0 && !processAlive(owner));
  } catch {
    return;
  }
  if (!stale) return;
  const guard = `${lock}.break`;
  try {
    closeSync(openSync(guard, 'wx', 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    try {
      if (Date.now() - statSync(guard).mtimeMs > BREAK_STALE_MS) unlinkSync(guard);
    } catch {
      // un autre l'a retiré
    }
    return;
  }
  try {
    removeIfContent(lock, observed);
  } finally {
    try {
      unlinkSync(guard);
    } catch {
      // déjà retiré
    }
  }
}

export class FakeHardwareKeystore implements HardwareKeystore {
  readonly isFake = true;
  readonly #pairs = new Map<KeyUse, Pair>();
  readonly #destroyed = new Set<KeyUse>();
  readonly #keyFile: string | null;

  constructor(options: { keyFile?: string | null } = {}) {
    this.#keyFile =
      options.keyFile === undefined || options.keyFile === null
        ? null
        : FakeHardwareKeystore.#checkedPath(options.keyFile);
    if (this.#keyFile !== null) withLock(this.#keyFile, () => this.#load(this.#keyFile!));
  }

  /** Chemin résolu : hors dépôt, jamais un lien symbolique. */
  static #checkedPath(file: string): string {
    if (insideGitRepository(file)) {
      throw new KeystoreError('KEY_FILE_INVALID', 'GATEWAY_DEV_KEY_FILE : doit être hors dépôt');
    }
    const absolute = join(resolvedDirectory(file), resolve(file).split('/').pop()!);
    try {
      if (lstatSync(absolute).isSymbolicLink()) {
        throw new KeystoreError(
          'KEY_FILE_INVALID',
          'GATEWAY_DEV_KEY_FILE : lien symbolique refusé',
        );
      }
    } catch (error) {
      if (error instanceof KeystoreError) throw error;
      // fichier absent : créé plus tard
    }
    return absolute;
  }

  /** Relit le fichier : fusionne dans l'état du processus sans retirer ce que le fichier ne dit pas. */
  #load(file: string): void {
    if (!existsSync(file)) return;
    if ((statSync(file).mode & 0o077) !== 0) {
      throw new KeystoreError('KEY_FILE_INVALID', 'GATEWAY_DEV_KEY_FILE : mode 0600 exigé');
    }
    let content: KeyFileContent;
    try {
      content = JSON.parse(readFileSync(file, 'utf8')) as KeyFileContent;
      for (const [use, pkcs8] of Object.entries(content.keys)) {
        if (!KEY_USES.includes(use as KeyUse)) throw new Error('usage inconnu');
        const privateKey = createPrivateKey({
          key: Buffer.from(pkcs8, 'base64'),
          format: 'der',
          type: 'pkcs8',
        });
        this.#pairs.set(use as KeyUse, {
          privateKey,
          publicDer: createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
        });
      }
      for (const use of content.destroyed) {
        this.#destroyed.add(use);
        this.#pairs.delete(use);
      }
    } catch {
      throw new KeystoreError('KEY_FILE_INVALID', 'GATEWAY_DEV_KEY_FILE : contenu illisible');
    }
  }

  /** À appeler SOUS le verrou, après `#load` : écrit l'état fusionné par un fichier unique + rename. */
  #save(): void {
    if (this.#keyFile === null) return;
    const content: KeyFileContent = { keys: {}, destroyed: [...this.#destroyed] };
    for (const [use, pair] of this.#pairs) {
      content.keys[use] = pair.privateKey
        .export({ type: 'pkcs8', format: 'der' })
        .toString('base64');
    }
    const temporary = `${this.#keyFile}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    // `wx` : jamais un fichier ni un lien existant ; le mode est ensuite FORCÉ (umask, héritage).
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, JSON.stringify(content));
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      unlinkSync(temporary);
      throw error;
    }
    closeSync(fd);
    renameSync(temporary, this.#keyFile);
  }

  /** Lecture-modification-écriture sous verrou : l'état de l'autre processus est relu d'abord. */
  #locked<T>(fn: () => T): T {
    if (this.#keyFile === null) return fn();
    const file = this.#keyFile;
    return withLock(file, () => {
      this.#load(file);
      return fn();
    });
  }

  #pair(use: KeyUse): Pair {
    if (!KEY_USES.includes(use)) throw new KeystoreError('KEY_USE_INVALID', 'usage de clé inconnu');
    const known = this.#pairs.get(use);
    if (known && !this.#destroyed.has(use)) return known;
    if (this.#destroyed.has(use) && this.#keyFile === null) {
      throw new KeystoreError('KEY_DESTROYED', `clé détruite (${use})`);
    }
    return this.#locked(() => {
      if (this.#destroyed.has(use))
        throw new KeystoreError('KEY_DESTROYED', `clé détruite (${use})`);
      let pair = this.#pairs.get(use);
      if (!pair) {
        const generated = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        pair = {
          privateKey: generated.privateKey,
          publicDer: generated.publicKey.export({ type: 'spki', format: 'der' }),
        };
        this.#pairs.set(use, pair);
        this.#save();
      }
      return pair;
    });
  }

  async sign(use: KeyUse, data: Buffer): Promise<Buffer> {
    if (use === 'agreement') {
      throw new KeystoreError('KEY_USE_INVALID', 'la clé d’accord ne signe pas');
    }
    const { privateKey } = this.#pair(use);
    return nodeSign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  }

  async agree(peerPublic: Buffer): Promise<Buffer> {
    const { privateKey } = this.#pair('agreement');
    try {
      const publicKey = createPublicKey({ key: peerPublic, format: 'der', type: 'spki' });
      return diffieHellman({ privateKey, publicKey });
    } catch {
      throw new KeystoreError('KEY_PEER_INVALID', 'clé publique du pair invalide');
    }
  }

  async publicKey(use: KeyUse): Promise<Buffer> {
    return Buffer.from(this.#pair(use).publicDer);
  }

  async destroy(use: KeyUse): Promise<void> {
    if (!KEY_USES.includes(use)) throw new KeystoreError('KEY_USE_INVALID', 'usage de clé inconnu');
    this.#locked(() => {
      this.#pairs.delete(use);
      this.#destroyed.add(use);
      this.#save();
    });
  }
}
