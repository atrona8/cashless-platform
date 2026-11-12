// T117 : consignation finale des écarts de la mission 8 (règle du porteur du 13/10/2026,
//   CLAUDE.md).
// Vérifie, sur les textes et sur le code :
//   - `docs/POINTS_OUVERTS.md` : OP-N100 à OP-N119, chaque écart de sécurité avec constat, risque,
//     mission
//     qui le lève, condition de levée, test de borne, report ; OP-N115 à OP-N117 (hors sécurité) en
//       ligne
//     de tableau avec mission et levée ;
//   - `docs/DECISIONS_ADR.md` : ADR-155 à ADR-187 (hors ADR-175 à 181 : inexistants ou autre
//     chantier) ; chaque ADR a sa
//     décision et son test de borne ; un ADR qui consigne un écart porte risque et levée (ou, à
//       défaut, les
//     trouve dans l'OP qu'il cite) ;
//   - pour chaque écart de sécurité, un TEST DE BORNE NOMMÉ qui existe (fichier et titre) ;
//   - `PROMPTS-A-ENVOYER.md` et `PRD.md` reportent les écarts (mission 12b et suivantes).
// Les documents sont lus à la racine du dépôt, ou à `M8_DOCS_ROOT` (checkout où vivent les
//   documents de
// passation quand le test tourne dans une lane de la mission, dont les documents sont en retard).
// Sensibilité : un OP ou un ADR retiré, un champ retiré, un test de borne introuvable sont
//   détectés.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');
const DOCS_ROOT = process.env['M8_DOCS_ROOT'] || REPO;
const G = 'apps/gateway/test/';
const A = 'apps/api/test/integration/';

const nums = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const SECURITY_OPS = [...nums(100, 114), 118, 119];
const TABLE_OPS = [115, 116, 117];
const OPS = [...nums(100, 119)];
// ADR-175 à 179 n'existent nulle part (saut de numérotation constaté le 12/11/2026) ; ADR-180 et
//   181 :
// autre chantier (main), hors de la mission.
const ADRS = nums(155, 187).filter((n) => n < 175 || n > 181);
// OP -> ADR qui le consigne.
const OP_ADR: Record<number, number> = {
  100: 155,
  101: 156,
  102: 157,
  103: 158,
  104: 159,
  105: 160,
  106: 161,
  107: 162,
  108: 163,
  109: 164,
  110: 165,
  111: 166,
  112: 167,
  113: 168,
  114: 170,
  118: 186,
  119: 187,
};

/** Test de borne nommé : fichier (depuis la racine du dépôt) et motif d'un titre qu'il contient. */
interface Bound {
  file: string;
  title: RegExp;
}
export const BOUNDS: Record<number, Bound[]> = {
  100: [{ file: `${G}e2e/production-refusals.spec.ts`, title: /HARDWARE_KEYSTORE/ }],
  101: [{ file: `${G}device/tokens.spec.ts`, title: /par audience/ }],
  102: [{ file: `${G}device/refresh.spec.ts`, title: /jamais un autre jeton de rafraîchissement/ }],
  103: [{ file: `${G}counter/tolerance-bounds.spec.ts`, title: /12 h \+ 1 s/ }],
  104: [{ file: `${G}offline/batches.spec.ts`, title: /plafond par vente dépassé/ }],
  105: [
    { file: `${A}edge/packs/register-alert.spec.ts`, title: /alerte d.inscription/ },
    { file: `${A}edge/packs/pack-standby.spec.ts`, title: /STANDBY/ },
  ],
  106: [{ file: `${G}purge/purge-canary.spec.ts`, title: /présent avant la purge, absent après/ }],
  107: [{ file: `${G}e2e/forced-resume.spec.ts`, title: /EDGE_REPLAY_FAILED|reprise/i }],
  108: [{ file: 'packages/ledger-sql/tests/tests_edge_fixes.sql', title: /OP-N108/ }],
  109: [{ file: `${G}startup/architecture.spec.ts`, title: /aucun import de apps\/api/ }],
  110: [
    { file: `${G}authority/epochs.spec.ts`, title: /epoch \+ 1 et epoch \+ 2/ },
    { file: `${G}authority/local-unstale.spec.ts`, title: /une seule signature/ },
  ],
  111: [
    { file: `${G}e2e/security-bounds.spec.ts`, title: /TRUNCATE est refusé/ },
    { file: `${G}e2e/security-bounds.spec.ts`, title: /liste figée des rôles/ },
  ],
  112: [{ file: `${G}e2e/security-bounds.spec.ts`, title: /deux titulaires identiques/ }],
  113: [{ file: `${G}startup/client-key-file.spec.ts`, title: /lien symbolique refusé/ }],
  114: [
    { file: `${A}debit-authority/debit-authority-routes.spec.ts`, title: /ABANDONED|abandon/i },
  ],
  118: [
    { file: `${G}purge/purge-canary.spec.ts`, title: /sign et agree refusés/ },
    {
      file: `${G}purge/purge-bound.spec.ts`,
      title: /tables non vidées par la purge : liste figée/,
    },
  ],
  119: [{ file: `${G}purge/purge-manual.spec.ts`, title: /CENTRAL_UNCONFIRMED|accusé/ }],
};

const TEST_CALL = /(^|\s)(it|test)(\.each\([^)]*\))?\s*\(/m;
const PGTAP_CALL = /\b(ok|is|isnt|throws_ok|lives_ok|results_eq|is_empty)\s*\(/;

const SECTION_FIELDS = [
  'Constat',
  'Risque',
  'Mission qui le lève',
  'Condition de levée',
  'Test de borne',
  'Report',
];

const readText = (root: string, path: string): string | null => {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

/** Texte de la section Markdown dont le titre commence par `id`, jusqu'au titre suivant. */
export function section(text: string, level: '##' | '###', id: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex(
    (l) =>
      l.startsWith(`${level} ${id}`) &&
      /^\W|\s|—/.test(l.slice(level.length + 1 + id.length) || ' '),
  );
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith(`${level} `) || (level === '###' && lines[i]!.startsWith('## '))) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

const hasField = (body: string, field: string): boolean =>
  new RegExp(`^- \\*\\*${field}[^*]*\\*\\*`, 'm').test(body);

export interface Docs {
  ops: string;
  adr: string;
  prompts: string;
  prd: string;
  read: (path: string) => string | null;
}

/** Défauts de consignation (liste vide = conforme). */
export function defects(d: Docs): string[] {
  const out: string[] = [];
  for (const n of OPS) {
    if (!new RegExp(`\\bOP-N${n}\\b`).test(d.ops)) out.push(`OP-N${n} absent de POINTS_OUVERTS.md`);
  }
  for (const n of SECURITY_OPS) {
    const body = section(d.ops, '###', `OP-N${n}`);
    if (body === null) {
      out.push(`OP-N${n} : section détaillée absente`);
      continue;
    }
    for (const f of SECTION_FIELDS)
      if (!hasField(body, f)) out.push(`OP-N${n} : champ « ${f} » absent`);
    const adr = OP_ADR[n];
    if (adr !== undefined && !body.includes(`ADR-${adr}`))
      out.push(`OP-N${n} : ne cite pas ADR-${adr}`);
    if (!/12b|mission \d|Porteur|juriste|WP\d|exploitation|Mission d/i.test(body))
      out.push(`OP-N${n} : mission de levée illisible`);
  }
  for (const n of TABLE_OPS) {
    const row = d.ops.split('\n').filter((l) => l.startsWith(`| OP-N${n} |`));
    if (row.length < 2) out.push(`OP-N${n} : ligne du tableau détaillé absente`);
    else if (row[1]!.split('|').length < 8)
      out.push(`OP-N${n} : colonnes risque, levée ou test absentes`);
  }
  for (const n of ADRS) {
    const body = section(d.adr, '##', `ADR-${n}`);
    if (body === null) {
      out.push(`ADR-${n} absent de DECISIONS_ADR.md`);
      continue;
    }
    if (!hasField(body, 'Décision')) out.push(`ADR-${n} : champ « Décision » absent`);
    if (!hasField(body, 'Test de borne')) out.push(`ADR-${n} : test de borne absent`);
    const cited = [...body.matchAll(/OP-N(\d+)/g)].map((m) => Number(m[1]));
    if (cited.length > 0) {
      // Écart consigné : risque et levée dans l'ADR ou, à défaut, dans l'OP cité.
      const op =
        cited.map((c) => section(d.ops, '###', `OP-N${c}`)).find((s) => s !== null) ?? null;
      const rowOnly = cited.some((c) => TABLE_OPS.includes(c));
      const inAdr =
        hasField(body, 'Risque') &&
        (hasField(body, 'Mission qui le lève') || hasField(body, 'Levée'));
      const inOp = op !== null && hasField(op, 'Risque') && hasField(op, 'Condition de levée');
      if (!inAdr && !inOp && !rowOnly)
        out.push(`ADR-${n} : risque ou levée absents (ADR et OP cité)`);
    }
  }
  for (const n of SECURITY_OPS) {
    const bounds = BOUNDS[n];
    if (!bounds || bounds.length === 0) {
      out.push(`OP-N${n} : aucun test de borne nommé`);
      continue;
    }
    for (const b of bounds) {
      const text = d.read(b.file);
      if (text === null) out.push(`OP-N${n} : fichier du test de borne inexistant ${b.file}`);
      else if (!(b.file.endsWith('.sql') ? PGTAP_CALL : TEST_CALL).test(text))
        out.push(`OP-N${n} : ${b.file} sans it( ni assertion pgTAP`);
      else if (!b.title.test(text))
        out.push(`OP-N${n} : titre ${String(b.title)} introuvable dans ${b.file}`);
    }
  }
  const reports = `${d.prompts}\n${d.prd}`;
  for (const n of SECURITY_OPS) {
    if (!new RegExp(`\\bOP-N${n}\\b`).test(reports))
      out.push(`OP-N${n} non reporté dans PROMPTS-A-ENVOYER.md ni PRD.md`);
  }
  if (!/12b/.test(d.prompts)) out.push('PROMPTS-A-ENVOYER.md : mission 12b non mentionnée');
  if (!/12b/.test(d.prd)) out.push('PRD.md : mission 12b non mentionnée');
  return out;
}

function load(): Docs {
  const need = (p: string): string => {
    const t = readText(DOCS_ROOT, p);
    if (t === null) throw new Error(`document introuvable : ${p} (racine ${DOCS_ROOT})`);
    return t;
  };
  return {
    ops: need('docs/POINTS_OUVERTS.md'),
    adr: need('docs/DECISIONS_ADR.md'),
    prompts: need('PROMPTS-A-ENVOYER.md'),
    prd: need('PRD.md'),
    read: (p) => readText(REPO, p),
  };
}

describe('T117 : consignation finale (OP-N100 à OP-N119, ADR-155 à ADR-187)', () => {
  it('toutes les consignations sont complètes et leurs tests de borne existent', () => {
    expect(defects(load())).toEqual([]);
  });

  describe('sensibilité : chaque défaut est détecté', () => {
    const drop = (text: string, re: RegExp): string => {
      expect(re.test(text)).toBe(true);
      return text.replace(re, '');
    };
    it('un OP retiré', () => {
      const d = load();
      const ops = d.ops
        .split('\n')
        .filter((l) => !/OP-N106/.test(l))
        .join('\n');
      expect(defects({ ...d, ops }).join('\n')).toMatch(/OP-N106 absent/);
    });
    it('le risque d’un OP retiré', () => {
      const d = load();
      const body = section(d.ops, '###', 'OP-N104')!;
      const ops = d.ops.replace(body, drop(body, /^- \*\*Risque\.\*\*.*$/m));
      expect(defects({ ...d, ops }).join('\n')).toMatch(/OP-N104 : champ « Risque » absent/);
    });
    it('la condition de levée d’un OP retirée', () => {
      const d = load();
      const body = section(d.ops, '###', 'OP-N100')!;
      const ops = d.ops.replace(body, drop(body, /^- \*\*Condition de levée\.\*\*.*$/m));
      expect(defects({ ...d, ops }).join('\n')).toMatch(
        /OP-N100 : champ « Condition de levée » absent/,
      );
    });
    it('un ADR retiré', () => {
      const d = load();
      const body = section(d.adr, '##', 'ADR-161')!;
      expect(defects({ ...d, adr: d.adr.replace(body, '') }).join('\n')).toMatch(/ADR-161 absent/);
    });
    it('le test de borne d’un ADR retiré', () => {
      const d = load();
      const body = section(d.adr, '##', 'ADR-165')!;
      const adr = d.adr.replace(body, drop(body, /^- \*\*Test de borne\.\*\*.*$/m));
      expect(defects({ ...d, adr }).join('\n')).toMatch(/ADR-165 : test de borne absent/);
    });
    it('un fichier de test de borne introuvable', () => {
      const d = load();
      const read = (p: string): string | null =>
        p.endsWith('purge-canary.spec.ts') ? null : d.read(p);
      expect(defects({ ...d, read }).join('\n')).toMatch(
        /OP-N106 : fichier du test de borne inexistant/,
      );
    });
    it('un titre de test de borne renommé', () => {
      const d = load();
      const read = (p: string): string | null =>
        p.endsWith('tolerance-bounds.spec.ts')
          ? (d.read(p) ?? '').replace(/12 h \+ 1 s/g, 'x')
          : d.read(p);
      expect(defects({ ...d, read }).join('\n')).toMatch(/OP-N103 : titre .* introuvable/);
    });
    it('un écart non reporté dans PROMPTS-A-ENVOYER.md ni PRD.md', () => {
      const d = load();
      const strip = (t: string): string => t.replace(/OP-N108\b/g, 'OP-X');
      expect(defects({ ...d, prompts: strip(d.prompts), prd: strip(d.prd) }).join('\n')).toMatch(
        /OP-N108 non reporté/,
      );
    });
  });
});
