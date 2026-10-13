// Cloisonnement (research R-03) : seul src/db/ touche `pg` et les jetons des pools ; aucun `SET app.` dans src/.
// La transaction de plateforme (contrat platform-access) n'est importée que par les services de plateforme.
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

  it('les jetons des pools ne sont pas exportés par DbModule', () => {
    const module = files.find((file) => file.path === 'db/db.module.ts');
    expect(module?.text).toMatch(/exports:\s*\[TenantTx, PlatformTx, APP_CONFIG\]/);
  });

  it('PlatformTx n’est importée que par db/, idempotency/, approval/ et les fichiers de plateforme', () => {
    const allowed = [
      /^db\//,
      /^idempotency\//,
      /^approval\//,
      /^organization\/platform\//,
      /^configuration\/jurisdiction[^/]*$/,
      /^configuration\/platform-[^/]*$/,
    ];
    const offenders = files
      .filter((file) => imports(file.text).some((source) => source.endsWith('/platform-tx')))
      .filter((file) => !allowed.some((pattern) => pattern.test(file.path)))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('la transaction de plateforme ne pose jamais de prestataire', () => {
    const platformTx = files.find((file) => file.path === 'db/platform-tx.ts');
    expect(platformTx?.text).toMatch(/set_config\('app\.scope', 'platform', true\)/);
    expect(platformTx?.text.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/app\.operator_id/);
  });

  it('seul db/ nomme le pool de la plateforme', () => {
    expect(files.filter((file) => !file.path.startsWith('db/') && file.text.includes('PG_PLATFORM_POOL')).map((f) => f.path)).toEqual([]);
  });
});
