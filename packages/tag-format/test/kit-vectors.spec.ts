// vectors.json doit être la sortie du script du kit, pas une copie retouchée : régénération puis comparaison.
// Hors CI, ignoré avec un message quand python3 ou le module `cryptography` manquent (le script du kit l'exige).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const PYTHON = process.env.TAG_FORMAT_PYTHON ?? 'python3';
const SCRIPT = join(__dirname, '..', 'scripts', 'export_vectors.py');
const available =
  spawnSync(PYTHON, ['-c', 'import cryptography'], { stdio: 'ignore' }).status === 0;

// En CI, l'absence de l'interpréteur n'excuse rien : le contrôle est obligatoire (variable `CI`).
const required = available || Boolean(process.env.CI);

(required ? it : it.skip)('vectors.json est reproduit par vecteurs_test_bracelet.py', () => {
  expect(available).toBe(true);
  expect(spawnSync(PYTHON, [SCRIPT, '--check'], { stdio: 'ignore' }).status).toBe(0);
});

if (!required) {
  console.warn(
    `[tag-format] ${PYTHON} ou le module cryptography est absent : contrôle de vectors.json ignoré (TAG_FORMAT_PYTHON pour désigner un interpréteur).`,
  );
}
