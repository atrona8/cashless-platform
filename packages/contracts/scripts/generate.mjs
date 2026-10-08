// Génère les types TypeScript du contrat depuis openapi.yaml (research R-10, FR-022). Jamais écrits à la main.
//   node scripts/generate.mjs   : écrit generated/*.ts
// `render()` est aussi utilisé par scripts/check.mjs pour comparer sans écrire.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse } from 'yaml';

const SPEC_URL = new URL('../openapi.yaml', import.meta.url);
export const GENERATED_DIR = new URL('../generated/', import.meta.url);

const HEADER =
  '// Fichier généré par packages/contracts/scripts/generate.mjs depuis openapi.yaml — ne pas modifier.\n' +
  '// Régénérer : npm run generate -w @cashless/contracts\n';

/** Une puce de la description de ProblemCode : « - `CODE` (statuts…) : sens », éventuellement sur plusieurs lignes. */
function problemBullets(description) {
  const bullets = new Map();
  let current = null;
  for (const line of description.split('\n')) {
    const start = /^- `([A-Z0-9_]+)`(.*)$/.exec(line);
    if (start) {
      current = start[1];
      bullets.set(current, start[2]);
    } else if (current && /^\s+\S/.test(line)) {
      bullets.set(current, `${bullets.get(current)} ${line.trim()}`);
    }
  }
  return bullets;
}

/**
 * Statuts HTTP d'un code : ceux de la parenthèse qui suit le code (« (409, `CL002`) », « (400, ou 422 …) ») ;
 * à défaut, ceux écrits entre accents graves dans la règle (`APPROVAL_INVALID` : « `403` … `409` »).
 */
function statusesOf(code, text) {
  const parenthesis = /^\s*\(([^)]*)\)/.exec(text);
  const source = parenthesis ? parenthesis[1] : [...text.matchAll(/`([1-5]\d\d)`/g)].map((m) => m[1]).join(' ');
  const statuses = [...new Set([...source.matchAll(/\b([1-5]\d\d)\b/g)].map((m) => Number(m[1])))];
  if (statuses.length === 0) throw new Error(`ProblemCode ${code} : aucun statut HTTP dans la description`);
  return statuses;
}

/**
 * Code de l'énumération sans puce dans la description (cas de `LATE_CLAIM_INVALID` au 2026-10-07) : le statut
 * est pris dans les autres mentions du contrat de la forme « `409 CODE` ». Sans aucune mention : erreur.
 */
function statusesFromMentions(code, rawSpec) {
  const statuses = [...new Set([...rawSpec.matchAll(new RegExp(`\`([1-5]\\d\\d) ${code}\``, 'g'))].map((m) => Number(m[1])))];
  if (statuses.length === 0) throw new Error(`ProblemCode ${code} : ni description ni statut HTTP dans le contrat`);
  console.warn(`[contracts] ${code} absent de la description de ProblemCode ; statut tiré du contrat : ${statuses.join(', ')}`);
  return statuses;
}

function problemCodeFiles(spec, rawSpec) {
  const schema = spec.components.schemas.ProblemCode;
  const codes = schema.enum;
  const bullets = problemBullets(schema.description);
  const extra = [...bullets.keys()].filter((code) => !codes.includes(code));
  if (extra.length) throw new Error(`Description de codes absents de l'énumération : ${extra.join(', ')}`);

  const list = codes.map((code) => `  '${code}',`).join('\n');
  const problemCodes =
    `${HEADER}import type { components } from './openapi';\n\n` +
    `/** Valeurs de l'énumération ProblemCode, dans l'ordre du contrat (${codes.length} codes). */\n` +
    `export const PROBLEM_CODES = [\n${list}\n] as const satisfies readonly components['schemas']['ProblemCode'][];\n`;

  const entries = codes
    .map((code) => {
      const statuses = bullets.has(code) ? statusesOf(code, bullets.get(code)) : statusesFromMentions(code, rawSpec);
      return `  ${code}: [${statuses.join(', ')}],`;
    })
    .join('\n');
  const problemStatuses =
    `${HEADER}import type { components } from './openapi';\n\n` +
    '/** Statuts HTTP de chaque code, tirés de la description de ProblemCode (plusieurs quand le contrat en prévoit). */\n' +
    `export const PROBLEM_STATUSES: Readonly<Record<components['schemas']['ProblemCode'], readonly number[]>> = {\n` +
    `${entries}\n};\n`;

  return { 'problem-codes.ts': problemCodes, 'problem-statuses.ts': problemStatuses };
}

/** Contenu attendu de chaque fichier de generated/, fins de ligne en \n. */
export async function render() {
  const ast = await openapiTS(SPEC_URL, { exportType: true, enum: false });
  const rawSpec = readFileSync(SPEC_URL, 'utf8');
  const files = { 'openapi.ts': HEADER + '\n' + astToString(ast), ...problemCodeFiles(parse(rawSpec), rawSpec) };
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [name, text.replace(/\r\n/g, '\n')]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await render();
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(new URL(name, GENERATED_DIR), text);
    console.log(`[contracts] généré : generated/${name}`);
  }
}
