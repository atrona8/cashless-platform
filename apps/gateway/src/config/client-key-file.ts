// Durcissement du fichier de la clé TLS client du central (décision 32, ADR-168). Cette clé vit en
// fichier jusqu'à la mission 12b (aucun fournisseur matériel sans dépendance native) : le démarrage
// est donc refusé si le fichier est lisible ou modifiable par d'autres que le propriétaire du
// processus, si le chemin est un lien symbolique, ou si la clé est celle d'une clé du port matériel.
// Un message nomme la variable, JAMAIS un octet de la clé ni de ses empreintes.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KEY_USES, type HardwareKeystore } from '../key-store/hardware-keystore.port';

export const CLIENT_KEY_VARIABLE = 'GATEWAY_CENTRAL_CLIENT_KEY_FILE';

export interface ClientKeyInspection {
  violations: string[];
  /** Contenu lu sur le descripteur contrôlé ; null si une violation ou l'absence l'interdit. */
  key: Buffer | null;
}

/**
 * SEUL point de lecture de la clé client (décision 32, anti-TOCTOU) : ouverture sans suivre les
 * liens (`O_NOFOLLOW`), contrôles par `fstat` sur ce descripteur (fichier ordinaire, propriétaire,
 * mode 0600), contrôle du répertoire, puis lecture SUR CE MÊME descripteur : un fichier remplacé
 * après l'ouverture n'est jamais lu. `uid` : propriétaire attendu (défaut : uid du processus ;
 * injectable pour les tests). Un fichier absent n'est une violation qu'en production.
 */
export function inspectClientKey(
  file: string,
  production: boolean,
  uid: number | null = typeof process.getuid === 'function' ? process.getuid() : null,
): ClientKeyInspection {
  let fd: number;
  try {
    // O_NONBLOCK : l'ouverture d'un tube nommé ne doit pas bloquer (refusé ensuite par isFile).
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { violations: [`${CLIENT_KEY_VARIABLE} : lien symbolique refusé`], key: null };
    }
    const absent = production ? [`${CLIENT_KEY_VARIABLE} : fichier absent ou inaccessible`] : [];
    return { violations: absent, key: null };
  }
  try {
    const violations: string[] = [];
    const stat = fstatSync(fd);
    if (!stat.isFile()) violations.push(`${CLIENT_KEY_VARIABLE} : fichier ordinaire attendu`);
    if ((stat.mode & 0o077) !== 0) {
      violations.push(`${CLIENT_KEY_VARIABLE} : mode 0600 exigé (groupe ou autres y accèdent)`);
    }
    if (uid !== null && stat.uid !== uid) {
      violations.push(`${CLIENT_KEY_VARIABLE} : propriétaire différent du processus`);
    }
    try {
      const directory = lstatSync(realpathSync(dirname(resolve(file))));
      if ((directory.mode & 0o022) !== 0) {
        violations.push(
          `${CLIENT_KEY_VARIABLE} : répertoire modifiable par le groupe ou les autres`,
        );
      }
      if (uid !== null && directory.uid !== uid && directory.uid !== 0) {
        violations.push(`${CLIENT_KEY_VARIABLE} : répertoire d'un autre propriétaire`);
      }
    } catch {
      violations.push(`${CLIENT_KEY_VARIABLE} : répertoire inaccessible`);
    }
    if (violations.length > 0) return { violations, key: null };
    try {
      return { violations: [], key: readFileSync(fd) };
    } catch {
      return { violations: [`${CLIENT_KEY_VARIABLE} : fichier illisible`], key: null };
    }
  } finally {
    closeSync(fd);
  }
}

/** Violations seules (même chemin de lecture que `inspectClientKey`). */
export function clientKeyFileViolations(
  file: string,
  production: boolean,
  uid?: number | null,
): string[] {
  return inspectClientKey(file, production, uid).violations;
}

/**
 * Refus si la clé du fichier est identique à une clé publique du port (comparaison des publics
 * dérivés ; aucune clé privée n'est exportée du port). Fichier absent : rien à comparer.
 */
export async function clientKeyDistinctViolations(
  file: string | null,
  keystore: HardwareKeystore,
  production = false,
  uid?: number | null,
): Promise<string[]> {
  if (file === null) return [];
  const read = inspectClientKey(file, production, uid);
  if (read.violations.length > 0) return read.violations;
  if (read.key === null) return [];
  let mine: Buffer;
  try {
    mine = createPublicKey(createPrivateKey(read.key)).export({
      type: 'spki',
      format: 'der',
    });
  } catch {
    return [`${CLIENT_KEY_VARIABLE} : clé illisible ou non reconnue`];
  }
  for (const use of KEY_USES) {
    if (mine.equals(await keystore.publicKey(use))) {
      return [`${CLIENT_KEY_VARIABLE} : clé identique à une clé du port matériel (usage ${use})`];
    }
  }
  return [];
}
