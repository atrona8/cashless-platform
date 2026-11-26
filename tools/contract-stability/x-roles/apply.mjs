#!/usr/bin/env node
// Annotation `x-roles` du contrat (mission 11b, WP04 ; FR-003, FR-004 ; interfaces.md §3, research D3).
//
// Lit `roles.json` (table relue à la main : operationId -> rôles + source) et ajoute à chaque opération de
// `packages/contracts/openapi.yaml` une ligne `x-roles: [...]`, par édition de texte ciblée (le reste du
// fichier, l'ordre et les commentaires ne bougent pas). Écrit aussi les entrées de référence correspondantes dans
// `tools/contract-stability/contract-baseline.json` (forme (a) : une entrée `extension` par opération existante
// de la référence ; empreinte recalculée pour une opération ou un chemin ajoutés par une mission, qui contient
// désormais `x-roles`). Idempotent : deux passages de suite ne changent rien.
//
// Usage : node tools/contract-stability/x-roles/apply.mjs [--check] [--repin <pointeur>]...
//   --check          n'écrit rien ; code 1 si le contrat, la table ou la référence divergent
//   --openapi, --baseline-json, --roles <fichier>   autres fichiers (essais seulement)
//   --repin <ptr>    recalcule l'empreinte d'une entrée existante de la référence (décision du porteur
//                    consignée dans le fichier) ; seulement un pointeur déjà inscrit, jamais un ajout
// Codes : 0 conforme ; 1 écart (--check) ou panne.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { canonical, sha256Hex, subtreeHash } from '../check.mjs';

export const ROLE_VALUES = [
  'PLATFORM_ADMIN',
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'MERCHANT_ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'PERSONALIZER',
  'VENDOR',
  'CUSTOMER',
  'DEVICE',
  'GATEWAY',
  'PUBLIC',
];
export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const OPENAPI = resolve(ROOT, 'packages/contracts/openapi.yaml');
const BASELINE = resolve(HERE, '..', 'contract-baseline.json');
const ROLES = resolve(HERE, 'roles.json');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esc = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** Opérations du contrat : [{ path, method, operationId, op }] dans l'ordre du fichier. */
export function operationsOf(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (isObject(item?.[method])) {
        out.push({ path, method, operationId: item[method].operationId, op: item[method] });
      }
    }
  }
  return out;
}

/** Table : { operationId: { roles?, doubt?, source, note?, question? } }. */
export function loadTable(file = ROLES) {
  return JSON.parse(readFileSync(file, 'utf8')).operations;
}

/** Les rôles d'une valeur de la table, dans l'ordre de la liste fermée, sans doublon. */
export const orderedRoles = (roles) => ROLE_VALUES.filter((r) => roles.includes(r));

/** Erreurs de cohérence entre la table et les opérations du contrat. */
export function tableProblems(doc, table) {
  const problems = [];
  const ids = new Set();
  for (const { operationId, method, path } of operationsOf(doc)) {
    ids.add(operationId);
    const entry = table[operationId];
    if (!entry)
      problems.push(`${operationId} (${method.toUpperCase()} ${path}) : absente de roles.json`);
  }
  for (const id of Object.keys(table)) {
    if (!ids.has(id)) problems.push(`${id} : entrée de roles.json sans opération du contrat`);
  }
  return problems;
}

/** Texte d'openapi.yaml avec les lignes `x-roles` posées (ou retirées pour un doute). */
export function annotate(text, doc, table) {
  const wanted = new Map(); // operationId -> ligne ou null
  for (const { operationId } of operationsOf(doc)) {
    const entry = table[operationId];
    if (!entry || entry.doubt) wanted.set(operationId, null);
    else wanted.set(operationId, `      x-roles: [${orderedRoles(entry.roles).join(', ')}]`);
  }
  const lines = text.split('\n');
  const out = [];
  let inPaths = false;
  let current = null; // opération en cours
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^paths:\s*$/.test(line)) inPaths = true;
    else if (/^\S/.test(line) && inPaths) inPaths = false;
    if (inPaths) {
      if (/^ {2}\S/.test(line) || /^ {4}[a-z]+:\s*$/.test(line)) current = null;
      if (/^ {6}x-roles:/.test(line) && current !== null) continue; // retirée, reposée après operationId
      const id = /^ {6}operationId: (\S+)\s*$/.exec(line);
      if (id) {
        out.push(line);
        if (wanted.get(id[1])) out.push(wanted.get(id[1]));
        current = id[1];
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

const stripXRoles = (doc) => {
  const copy = JSON.parse(JSON.stringify(doc));
  for (const { path, method } of operationsOf(copy)) delete copy.paths[path][method]['x-roles'];
  return copy;
};

function baselineDoc(pinned) {
  const text = execFileSync('git', ['show', `${pinned.baseline.commit}:${pinned.baseline.path}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (sha256Hex(text) !== pinned.baseline.sha256) throw new Error('référence falsifiée (SHA-256)');
  return parse(text);
}

/**
 * Entrées de référence attendues. Retourne { entries, repinned, problems } : `entries` = liste complète des
 * entrées après mise à jour ; `problems` = écarts qui interdisent d'écrire.
 */
export function expectedBaseline(pinned, base, doc, table, repin = []) {
  const problems = [];
  const kept = pinned.admitted_additions.filter((e) => !/\/x-roles$/.test(e.pointer));
  const byPointer = new Map(kept.map((e) => [e.pointer, e]));
  const stripped = stripXRoles(doc);
  const touched = new Set();
  const extensions = [];
  for (const { path, method, operationId } of operationsOf(doc)) {
    const entry = table[operationId];
    if (!entry || entry.doubt) continue;
    const opPointer = `/paths/${esc(path)}/${method}`;
    const pathPointer = `/paths/${esc(path)}`;
    if (!base.paths?.[path]) touched.add(pathPointer);
    else if (!base.paths[path][method]) touched.add(opPointer);
    else {
      extensions.push({
        pointer: `${opPointer}/x-roles`,
        kind: 'extension',
        sha256: subtreeHash(doc.paths[path][method]['x-roles']),
      });
    }
  }
  const pointerValue = (root, pointer) =>
    pointer
      .split('/')
      .slice(1)
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((node, key) => node?.[key], root);
  const repinned = [];
  for (const pointer of [...touched, ...repin]) {
    const found = byPointer.get(pointer);
    if (!found) {
      problems.push(`${pointer} : absent de la liste blanche, empreinte non recalculable`);
      continue;
    }
    const after = subtreeHash(pointerValue(doc, pointer));
    const before = subtreeHash(pointerValue(stripped, pointer));
    if (found.sha256 !== after) {
      if (found.sha256 !== before && !repin.includes(pointer)) {
        problems.push(
          `${pointer} : empreinte épinglée ni avant ni après x-roles (contenu modifié)`,
        );
        continue;
      }
      repinned.push(pointer);
      byPointer.set(pointer, { ...found, sha256: after });
    }
  }
  const entries = [...kept.map((e) => byPointer.get(e.pointer)), ...extensions];
  return { entries, repinned, problems };
}

/** Écarts du contrat par rapport à la table (hors empreintes). */
export function contractProblems(doc, table) {
  const problems = [];
  for (const { operationId, op } of operationsOf(doc)) {
    const entry = table[operationId];
    if (!entry) continue;
    const have = op['x-roles'];
    if (entry.doubt) {
      if (have !== undefined)
        problems.push(`${operationId} : douteuse, ne doit pas porter x-roles`);
    } else if (canonical(have) !== canonical(orderedRoles(entry.roles))) {
      problems.push(`${operationId} : x-roles ${JSON.stringify(have)} au lieu de ${entry.roles}`);
    }
  }
  return problems;
}

export function run(argv) {
  const check = argv.includes('--check');
  const repin = [];
  const files = { openapi: OPENAPI, baseline: BASELINE, roles: ROLES };
  const options = { '--repin': (v) => repin.push(v), '--openapi': (v) => (files.openapi = v) };
  options['--baseline-json'] = (v) => (files.baseline = v);
  options['--roles'] = (v) => (files.roles = v);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') continue;
    if (!options[argv[i]] || argv[i + 1] === undefined) {
      console.error(`usage : option inconnue ou sans valeur : ${argv[i]}`);
      return 1;
    }
    options[argv[i]](argv[(i += 1)]);
  }
  const table = loadTable(files.roles);
  const text = readFileSync(files.openapi, 'utf8');
  const doc = parse(text);
  const problems = tableProblems(doc, table);
  if (problems.length > 0) {
    problems.forEach((p) => console.error(p));
    return 1;
  }
  const next = annotate(text, doc, table);
  const nextDoc = parse(next);
  if (canonical(stripXRoles(nextDoc)) !== canonical(stripXRoles(doc))) {
    console.error('annotation : le contrat change ailleurs que par x-roles (abandon)');
    return 1;
  }
  const pinned = JSON.parse(readFileSync(files.baseline, 'utf8'));
  const base = baselineDoc(pinned);
  const expected = expectedBaseline(pinned, base, nextDoc, table, repin);
  const baselineText = `${JSON.stringify({ ...pinned, admitted_additions: expected.entries }, null, 2)}\n`;
  if (expected.problems.length > 0) {
    expected.problems.forEach((p) => console.error(p));
    return 1;
  }
  const baselineDiffers = baselineText !== readFileSync(files.baseline, 'utf8');
  if (check) {
    const found = [...contractProblems(doc, table)];
    if (next !== text) found.push('openapi.yaml : lignes x-roles différentes de la table');
    if (baselineDiffers) found.push('contract-baseline.json : entrées x-roles à régénérer');
    found.slice(0, 20).forEach((p) => console.error(p));
    if (found.length > 20) console.error(`... et ${found.length - 20} autre(s) écart(s)`);
    return found.length > 0 ? 1 : 0;
  }
  if (next !== text) writeFileSync(files.openapi, next);
  if (baselineDiffers) writeFileSync(files.baseline, baselineText);
  console.log(
    `x-roles : ${operationsOf(nextDoc).filter((o) => o.op['x-roles']).length} opérations annotées, ` +
      `${expected.repinned.length} empreinte(s) recalculée(s)`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
