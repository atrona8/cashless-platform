// Le vérificateur d'assertions App Attest n'est branché sur aucune route (WP13, T052 ;
// OP-N64 « côté serveur prêt », non levé) : aucun contrôleur ni garde ne l'importe ni ne le nomme,
// et rien de ce qui est atteignable depuis eux ne le fait. Fichier propre à WP13
// (architecture.spec.ts est à WP06). Borne iOS : la preuve que la limite n'est pas levée reste dans
// device-auth-matrix.spec.ts et media-port-swap.spec.ts, que ce lot ne modifie pas ; ce fichier
// garde que ces tests existent.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '../../../src');
const TESTS = join(__dirname, '../..');
const VERIFIER_FILE = 'attestation/ios-app-attest-assertion.ts';
const VERIFIER_CLASS = 'IosAppAttestAssertionVerifier';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const files = sources(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));
const byPath = new Map(files.map((file) => [file.path, file]));
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const imports = (text: string): string[] =>
  [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

/** Fichiers atteignables depuis `entries` en suivant les imports relatifs (analyse statique). */
function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const file = byPath.get(current);
    if (!file || seen.has(current)) continue;
    seen.add(current);
    const dir = current.split('/').slice(0, -1);
    for (const source of imports(file.text)) {
      if (!source.startsWith('.')) continue;
      const parts = [...dir];
      for (const segment of source.split('/')) {
        if (segment === '.' || segment === '') continue;
        if (segment === '..') parts.pop();
        else parts.push(segment);
      }
      const base = parts.join('/');
      queue.push(byPath.has(`${base}.ts`) ? `${base}.ts` : `${base}/index.ts`);
    }
  }
  return seen;
}

const isRouteEntry = (path: string) => /\.controller\.ts$/.test(path) || /guard/i.test(path);
const mentionsVerifier = (text: string) =>
  code(text).includes(VERIFIER_CLASS) ||
  imports(text).some((s) => s.endsWith('ios-app-attest-assertion'));

describe('vérificateur d’assertions App Attest : aucune route (OP-N64)', () => {
  it('le vérificateur et les points d’entrée de route existent (contrôle positif)', () => {
    expect(byPath.has(VERIFIER_FILE)).toBe(true);
    expect(files.filter((file) => /\.controller\.ts$/.test(file.path)).length).toBeGreaterThan(10);
    expect(files.filter((file) => /guard/i.test(file.path)).length).toBeGreaterThan(0);
  });

  it('aucun contrôleur ni garde ne l’importe ni ne le nomme', () => {
    expect(
      files
        .filter((file) => isRouteEntry(file.path) && mentionsVerifier(file.text))
        .map((file) => file.path),
    ).toEqual([]);
  });

  it('rien d’atteignable depuis un contrôleur ou une garde ne l’importe ni ne le nomme', () => {
    const entries = files.filter((file) => isRouteEntry(file.path)).map((file) => file.path);
    const seen = reachable(entries);
    expect(seen.has(VERIFIER_FILE)).toBe(false);
    expect([...seen].filter((path) => mentionsVerifier(byPath.get(path)!.text))).toEqual([]);
  });

  it('seuls le vérificateur et le module d’attestation le nomment dans src/', () => {
    expect(
      files
        .filter((file) => file.path !== VERIFIER_FILE && mentionsVerifier(file.text))
        .map((file) => file.path),
    ).toEqual(['attestation/attestation.module.ts']);
  });

  it('borne iOS (OP-N64) : les suites de borne existent et gardent leur test, non levées', () => {
    for (const name of ['device-auth-matrix.spec.ts', 'media-port-swap.spec.ts']) {
      const text = readFileSync(join(TESTS, 'integration/end-to-end', name), 'utf8');
      expect(text).toMatch(/borne iOS \(OP-N64\)/);
      expect(text).toMatch(/\/media\/auth-keys/);
    }
  });
});
