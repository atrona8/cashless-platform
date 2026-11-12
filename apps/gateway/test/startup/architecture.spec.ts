import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SERVED_OPERATION_IDS } from '../../src/processes/served-operations';

const SRC = join(__dirname, '..', '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
const all = files(SRC).map((path) => ({
  path: relative(SRC, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('architecture de la passerelle', () => {
  it('aucun import de apps/api depuis src', () => {
    const offenders = all.filter((f) =>
      /from\s+['"]([^'"]*apps\/api[^'"]*|@cashless\/api[^'"]*)['"]/.test(f.text),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('seuls les paquets @cashless admis sont importés', () => {
    const allowed = new Set([
      '@cashless/shared-rules',
      '@cashless/tag-format',
      '@cashless/contracts',
    ]);
    const used = new Set<string>();
    for (const f of all) {
      for (const m of f.text.matchAll(/from\s+['"](@cashless\/[a-z-]+)[^'"]*['"]/g))
        used.add(m[1]!);
    }
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('pg est importé par db/pool.ts seul, et seul lui crée un pool', () => {
    const importers = all.filter((f) => /from\s+['"]pg['"]|require\(['"]pg['"]\)/.test(f.text));
    expect(importers.map((f) => f.path)).toEqual(['db/pool.ts']);
    const creators = all.filter((f) => /new\s+(Pool|Client)\s*\(/.test(f.text));
    expect(creators.map((f) => f.path)).toEqual(['db/pool.ts']);
  });

  it('chaque route déclarée porte un @ServedOperation de la liste des 16', () => {
    expect(SERVED_OPERATION_IDS).toHaveLength(16);
    // Le serveur d'administration local (WP17, boucle locale, autre écouteur) n'est pas une
    // opération de terminal.
    const controllers = all.filter(
      (f) =>
        !f.path.startsWith('admin/') &&
        /@(Get|Post|Put|Patch|Delete|All|Head|Options)\(/.test(f.text),
    );
    for (const f of controllers) {
      const routes = [...f.text.matchAll(/@(Get|Post|Put|Patch|Delete|All|Head|Options)\(/g)]
        .length;
      const marks = [...f.text.matchAll(/@ServedOperation\('([A-Za-z]+)'\)/g)].map((m) => m[1]!);
      expect({ file: f.path, marked: marks.length }).toEqual({ file: f.path, marked: routes });
      for (const id of marks) expect(SERVED_OPERATION_IDS as readonly string[]).toContain(id);
    }
  });

  it('la liste des 16 correspond au contrat (gateway-served-operations.md)', () => {
    const doc = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'kitty-specs',
        'passerelle-locale-01M6NM1S',
        'contracts',
        'gateway-served-operations.md',
      ),
      'utf8',
    );
    const ids = [...doc.matchAll(/^\| \d+ \| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
    expect([...SERVED_OPERATION_IDS].sort()).toEqual([...ids].sort());
  });
});
