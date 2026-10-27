// Chaîne d'approvisionnement d'argon2 (mission 5b, lot WP08, T032 ; A16 ; research R-01 ;
// docs/08-pile-logicielle.md) : version exacte, intégrité du verrou, dépendances transitives
// attendues, et empreinte SHA-256 du binaire RÉELLEMENT chargé comparée aux valeurs de R-01.
// Plateforme absente de la liste → échec explicite (OP-N11 : plateforme de production non arrêtée).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '../../../../..');
const ARGON2_DIR = dirname(require.resolve('argon2/package.json'));

/** R-01 : intégrité de `argon2@0.44.0` publiée sur le registre. */
const R01_INTEGRITY =
  'sha512-zHPGN3S55sihSQo0dBbK0A5qpi2R31z7HZDZnry3ifOyj8bZZnpZND2gpmhnRGO1V/d555RwBqIK5W4Mrmv3ig==';

/** R-01 : empreintes SHA-256 des binaires du paquet, recopiées de research.md. */
const R01_BINARIES: Readonly<Record<string, string>> = {
  'prebuilds/linux-x64/argon2.glibc.node':
    'd573da575d5c8a1ad71edd066d8222a7d99e590bf09daa9204847143b3ba8cd0',
  'prebuilds/linux-x64/argon2.musl.node':
    '90d12fb13b719fcb8deae23607d093166bc2ba44791a2fd51c966f626e0ec47a',
  'prebuilds/darwin-x64/argon2.glibc.node':
    '1698dae58318847337fac1e9c24b9f455ceb5e15f7578ca96558b4d821bdc166',
};

/** Entrées du verrou apportées par argon2 (R-01 ; `@epic-web/invariant` : dépendance de cross-env). */
const EXPECTED_NEW_LOCK_ENTRIES = [
  'node_modules/@epic-web/invariant',
  'node_modules/@phc/format',
  'node_modules/argon2',
  'node_modules/argon2/node_modules/node-addon-api',
  'node_modules/cross-env',
  'node_modules/node-gyp-build',
];

/**
 * Entrées déjà au verrou avant la mission, atteintes par argon2 via cross-env (cross-spawn et ses dépendances) :
 * ni apportées ni changées par argon2. Une entrée de la fermeture qui n'est dans aucune des deux listes fait
 * échouer le test de la fermeture transitive.
 */
const PRE_EXISTING_TRANSITIVES = [
  'node_modules/cross-spawn',
  'node_modules/isexe',
  'node_modules/path-key',
  'node_modules/shebang-command',
  'node_modules/shebang-regex',
  'node_modules/which',
];

interface LockPackage {
  version?: string;
  integrity?: string;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
}

const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockPackage>;
};

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** Chemin, relatif au paquet, du binaire que `node-gyp-build` choisit (celui qu'argon2 charge). */
function selectedBinary(): string {
  // Chargement dynamique du chargeur qu'argon2 résout lui-même (même instance, même choix).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gypBuild = require(require.resolve('node-gyp-build', { paths: [ARGON2_DIR] })) as {
    path(dir: string): string;
  };
  return relative(ARGON2_DIR, gypBuild.path(ARGON2_DIR)).split(sep).join('/');
}

describe('argon2 : chaîne d’approvisionnement (A16, R-01)', () => {
  it('version installée exacte : 0.44.0 (et version exacte dans apps/api/package.json)', () => {
    const installed = JSON.parse(readFileSync(join(ARGON2_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(installed.version).toBe('0.44.0');
    const api = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(api.dependencies.argon2).toBe('0.44.0');
  });

  it('verrou : intégrité de R-01, dépendances transitives attendues', () => {
    const entry = lock.packages['node_modules/argon2']!;
    expect(entry.version).toBe('0.44.0');
    expect(entry.integrity).toBe(R01_INTEGRITY);
    expect(Object.keys(entry.dependencies ?? {}).sort()).toEqual([
      '@phc/format',
      'cross-env',
      'node-addon-api',
      'node-gyp-build',
    ]);
    expect(lock.packages['node_modules/node-gyp-build']?.version).toBe('4.8.4');
    expect(lock.packages['node_modules/@phc/format']?.version).toBe('1.0.0');
    // Aucune dépendance transitive n'a de script d'installation (seul argon2 en déclare un, non
    // exécuté : `.npmrc` impose ignore-scripts=true).
    for (const name of EXPECTED_NEW_LOCK_ENTRIES.filter((n) => n !== 'node_modules/argon2'))
      expect([name, lock.packages[name]?.hasInstallScript ?? false]).toEqual([name, false]);
    expect(readFileSync(join(ROOT, '.npmrc'), 'utf8')).toMatch(/^ignore-scripts=true$/m);
  });

  it('fermeture transitive d’argon2 dans le verrou = EXACTEMENT les entrées attendues et déjà présentes (toute entrée nouvelle échoue)', () => {
    // Résolution à la manière de npm : `<chemin>/node_modules/<nom>`, puis chaque `node_modules` parent.
    const resolve = (from: string, name: string): string | undefined => {
      for (let base = from; ; ) {
        const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
        if (lock.packages[candidate]) return candidate;
        if (base === '') return undefined;
        const cut = base.lastIndexOf('/node_modules/');
        base = cut >= 0 ? base.slice(0, cut) : '';
      }
    };
    const closure = new Set<string>();
    const queue = ['node_modules/argon2'];
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (closure.has(path)) continue;
      closure.add(path);
      const entry = lock.packages[path]!;
      for (const name of Object.keys(entry.dependencies ?? {})) {
        const found = resolve(path, name);
        if (!found) throw new Error(`${path} : dépendance ${name} introuvable dans le verrou`);
        queue.push(found);
      }
    }
    expect([...closure].sort()).toEqual(
      [...EXPECTED_NEW_LOCK_ENTRIES, ...PRE_EXISTING_TRANSITIVES].sort(),
    );
  });

  it('binaire chargé : empreinte SHA-256 présente dans la liste de R-01', () => {
    const binary = selectedBinary();
    const known = R01_BINARIES[binary];
    if (known === undefined)
      throw new Error(
        `plateforme ${process.platform}-${process.arch} : binaire ${binary} absent de la liste ` +
          'de R-01 (OP-N11) ; empreinte à vérifier et à ajouter avant tout déploiement',
      );
    expect(sha256(join(ARGON2_DIR, binary))).toBe(known);
  });

  it('le binaire choisi est bien celui qu’argon2 charge (processus séparé, cache des modules)', () => {
    const script =
      "require('argon2');" +
      "console.log(JSON.stringify(Object.keys(require.cache).filter((p) => p.endsWith('.node'))))";
    const loaded = JSON.parse(
      execFileSync(process.execPath, ['-e', script], { cwd: join(ROOT, 'apps/api') }).toString(),
    ) as string[];
    expect(loaded.map((p) => realpathSync(p))).toEqual([
      realpathSync(join(ARGON2_DIR, selectedBinary())),
    ]);
  });
});
