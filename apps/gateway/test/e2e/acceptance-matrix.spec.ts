// T117 : matrice d'acceptation exécutable. Chaque exigence non fonctionnelle (NFR-001 à NFR-013) et
//   chaque
// critère de succès (SC-001 à SC-007) de la mission 8 renvoie aux fichiers de test qui le prouvent
//   (lots 1
// à 25). Le test échoue si : une exigence de la spécification n'a pas de ligne (ou l'inverse), un
//   fichier
// cité n'existe pas, ne contient aucun `it(` / `test(`, ou ne nomme pas l'exigence qu'il prouve.
// Sensibilité : la même vérification, jouée sur des matrices mutées, doit échouer.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');
const G = 'apps/gateway/test/';
const A = 'apps/api/test/integration/edge/';

export const MATRIX: Record<string, string[]> = {
  'NFR-001': [`${G}e2e/exclusion-under-load.spec.ts`, `${G}e2e/bench-support.spec.ts`],
  'NFR-002': [`${G}e2e/release-10000.spec.ts`],
  'NFR-003': [`${G}e2e/replay-100.spec.ts`, `${G}offline/relay.spec.ts`],
  'NFR-004': [`${G}e2e/crash-points.spec.ts`, `${G}queue/append.spec.ts`],
  'NFR-005': [`${G}e2e/latency-two-process.spec.ts`, `${G}sales/latency.spec.ts`],
  'NFR-006': [`${G}e2e/release-10000.spec.ts`],
  'NFR-007': [
    `${G}e2e/handover-and-freshness.spec.ts`,
    `${A}process/current-handover-wait.spec.ts`,
  ],
  'NFR-008': [`${G}e2e/handover-and-freshness.spec.ts`, `${G}replication/freshness.spec.ts`],
  'NFR-009': [`${G}e2e/production-refusals.spec.ts`],
  'NFR-010': [
    `${G}e2e/canary-end-to-end.spec.ts`,
    `${G}offline/canary.spec.ts`,
    `${G}purge/purge-canary.spec.ts`,
  ],
  'NFR-011': [`${G}e2e/scoping.spec.ts`, `${A}routes/edge-cloistering.spec.ts`],
  'NFR-012': [`${G}e2e/contract-stability.spec.ts`],
  'NFR-013': [`${G}e2e/purge-end-to-end.spec.ts`, `${G}purge/purge-canary.spec.ts`],
  'SC-001': [`${G}e2e/sc-001-journey.spec.ts`],
  'SC-002': [`${G}e2e/exclusion-under-load.spec.ts`],
  'SC-003': [`${G}e2e/release-10000.spec.ts`],
  'SC-004': [`${G}e2e/latency-two-process.spec.ts`],
  'SC-005': [`${G}e2e/forced-resume.spec.ts`],
  'SC-006': [`${G}e2e/contract-stability.spec.ts`],
  'SC-007': [`${G}e2e/production-refusals.spec.ts`],
};

const EXPECTED = [
  ...Array.from({ length: 13 }, (_, i) => `NFR-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 7 }, (_, i) => `SC-${String(i + 1).padStart(3, '0')}`),
];

const TEST_CALL = /(^|\s)(it|test)(\.each\([^)]*\))?\s*\(/m;

/** Défauts d'une matrice (liste vide = conforme). `read` rend le texte d'un fichier ou `null`. */
export function defects(
  matrix: Record<string, string[]>,
  specIds: string[],
  read: (path: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const id of specIds) {
    const files = matrix[id];
    if (!files || files.length === 0) {
      out.push(`${id} : aucune preuve citée`);
      continue;
    }
    for (const file of files) {
      const text = read(file);
      if (text === null) out.push(`${id} : fichier cité inexistant ${file}`);
      else if (!TEST_CALL.test(text)) out.push(`${id} : ${file} ne contient aucun it( / test(`);
      else if (!new RegExp(`\\b${id}\\b`).test(text))
        out.push(`${id} : ${file} ne nomme pas ${id}`);
    }
  }
  for (const id of Object.keys(matrix))
    if (!specIds.includes(id)) out.push(`${id} : hors spécification`);
  return out;
}

const readRepo = (path: string): string | null => {
  const full = join(REPO, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

/** Identifiants de la spécification de la mission (table des NFR, liste des SC). */
function specIds(): string[] {
  const spec = join(REPO, 'kitty-specs', 'passerelle-locale-01M6NM1S', 'spec.md');
  const text = readFileSync(spec, 'utf8');
  const nfr = [...text.matchAll(/^\| (NFR-\d{3}) \|/gm)].map((m) => m[1]!);
  const sc = [...text.matchAll(/^- \*\*(SC-\d{3})\*\*/gm)].map((m) => m[1]!);
  return [...nfr, ...sc];
}

describe('T117 : matrice d’acceptation NFR-001 à NFR-013, SC-001 à SC-007', () => {
  it('la spécification porte exactement ces 13 exigences et ces 7 critères', () => {
    expect(specIds().sort()).toEqual([...EXPECTED].sort());
  });

  it('chaque exigence et chaque critère a une preuve existante qui le nomme', () => {
    expect(defects(MATRIX, EXPECTED, readRepo)).toEqual([]);
  });

  describe('sensibilité : la vérification échoue sur une matrice défectueuse', () => {
    it('fichier cité inexistant', () => {
      const m = { ...MATRIX, 'NFR-009': [`${G}e2e/n-existe-pas.spec.ts`] };
      expect(defects(m, EXPECTED, readRepo).join('\n')).toMatch(
        /NFR-009 : fichier cité inexistant/,
      );
    });
    it('fichier sans aucun it( / test(', () => {
      const m = { ...MATRIX, 'NFR-009': [`${G}support/canary.ts`] };
      expect(defects(m, EXPECTED, readRepo).join('\n')).toMatch(/NFR-009 : .* ne contient aucun/);
    });
    it('fichier qui ne nomme pas l’exigence', () => {
      const m = { ...MATRIX, 'NFR-009': [`${G}e2e/tcp-relay.spec.ts`] };
      expect(defects(m, EXPECTED, readRepo).join('\n')).toMatch(
        /NFR-009 : .* ne nomme pas NFR-009/,
      );
    });
    it('exigence sans ligne', () => {
      const { 'SC-005': _removed, ...m } = MATRIX;
      expect(defects(m, EXPECTED, readRepo)).toContain('SC-005 : aucune preuve citée');
    });
    it('un fichier vide ou un contenu sans test est refusé même s’il existe', () => {
      expect(defects({ 'NFR-001': ['x'] }, ['NFR-001'], () => '// NFR-001 seulement')).toHaveLength(
        1,
      );
    });
  });
});
