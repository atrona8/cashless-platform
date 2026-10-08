// Cloisonnement (research R-03) : seul src/db/ touche `pg` et le jeton du pool ; aucun `SET app.` dans src/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '../../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const imports = (text: string): string[] => [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

describe('architecture', () => {
  it('aucun fichier hors db/ n’importe pg (valeurs) ni le jeton du pool', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('db/'))
      .filter((file) =>
        imports(file.text).some((source) => source.endsWith('pool.token')) ||
        // `import type` de pg est permis (types seulement, aucune connexion possible).
        /^import\s+(?!type\b)[^;]*from\s+'pg'/m.test(file.text),
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('aucun SET app. dans src/ (set_config(…, true) seulement)', () => {
    expect(files.filter((file) => /SET\s+(LOCAL\s+)?app\./i.test(file.text)).map((f) => f.path)).toEqual([]);
  });

  it('le jeton du pool n’est pas exporté par DbModule', () => {
    const module = files.find((file) => file.path === 'db/db.module.ts');
    expect(module?.text).toMatch(/exports:\s*\[TenantTx, APP_CONFIG\]/);
  });
});
