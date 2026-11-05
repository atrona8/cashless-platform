// Les règles pures ne touchent ni base, ni Nest, ni horloge, ni hasard (WP17).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '../../../src/offline/rules');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));
// Ôte les commentaires de ligne et de bloc avant la recherche.
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('offline/rules : pureté', () => {
  it('contient les six fichiers attendus', () => {
    expect(files.map((x) => x.f).sort()).toEqual([
      'compliance.ts',
      'conflict-outcome.ts',
      'loss-bearer.ts',
      'offline-time.ts',
      'period.ts',
      'types.ts',
    ]);
  });

  it.each(files.map((x) => [x.f, x.text] as const))('%s : imports permis seulement', (_f, text) => {
    const sources = [...code(text).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const s of sources) {
      expect(s).toMatch(/^(\.\/[a-z-]+|@cashless\/contracts)$/);
      expect(s).not.toMatch(/(^pg$|nest|\.\.\/db)/);
    }
    expect(code(text)).not.toMatch(/\brequire\s*\(/);
  });

  it.each(files.map((x) => [x.f, x.text] as const))('%s : ni horloge ni hasard', (_f, text) => {
    const c = code(text);
    expect(c).not.toMatch(/Date\.now\s*\(/);
    expect(c).not.toMatch(/new Date\s*\(\s*\)/);
    expect(c).not.toMatch(/Math\.random\s*\(/);
    expect(c).not.toMatch(/performance\.now|process\.hrtime|fetch\s*\(/);
  });
});
