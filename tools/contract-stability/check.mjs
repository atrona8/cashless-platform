#!/usr/bin/env node
// Contrôle de stabilité du contrat (mission 8, NFR-012, SC-006, C-002).
//
// Compare `packages/contracts/openapi.yaml` à la référence épinglée (commit d2a7c538, SHA-256 dans
// `contract-baseline.json`) et n'admet que les ajouts facultatifs listés dans ce même fichier, à leurs pointeurs
// EXACTS et avec l'empreinte de leur contenu. Liste blanche stricte : dans le doute, REFUSÉE.
//
// Codes de sortie (seul 2 prouve un refus) :
//   0  aucune différence refusée
//   2  au moins une différence REFUSÉE (chaque pointeur refusé est nommé)
//   1  panne ou erreur d'usage : fichier absent, YAML invalide, module `yaml` absent, référence introuvable ou
//      falsifiée (SHA-256 différente de la valeur épinglée), option inconnue
//
// Usage : node tools/contract-stability/check.mjs [--candidate <openapi.yaml>] [--baseline-file <fichier>]
//                                                 [--baseline-json <contract-baseline.json>]
//   --candidate      contrat à contrôler (défaut : packages/contracts/openapi.yaml du dépôt)
//   --baseline-file  lit la référence dans ce fichier au lieu de `git show` ; sa SHA-256 est vérifiée aussi
//   --baseline-json  autre fichier de référence épinglée (essais seulement)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_REFUSED = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_BASELINE_JSON = resolve(HERE, 'contract-baseline.json');
const DEFAULT_CANDIDATE = resolve(REPO_ROOT, 'packages/contracts/openapi.yaml');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
/** Schémas qui ne doivent être référencés que par ces routes (condition 2 de la liste blanche). */
const EDGE_ONLY_SCHEMAS = {
  ReplicationPage: ['/paths/~1edge~1replication-feed/'],
  EdgeSyncBatch: ['/paths/~1edge~1sync-batches/'],
};

class ToolFailure extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapeToken = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON canonique (clés triées) : l'ordre des clés et les commentaires ne comptent pas. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const subtreeHash = (value) => sha256Hex(canonical(value));

const deepEqual = (a, b) => canonical(a) === canonical(b);

/**
 * Différences sémantiques (pointeur JSON, ajout | retrait | changement). Un sous-arbre ajouté ou retiré est
 * rapporté une seule fois, à sa racine.
 */
export function diff(a, b, pointer = '', out = []) {
  if (deepEqual(a, b)) return out;
  if (isObject(a) && isObject(b)) {
    for (const key of Object.keys(a)) {
      const p = `${pointer}/${escapeToken(key)}`;
      if (!(key in b)) out.push({ kind: 'REMOVE', pointer: p, before: a[key] });
      else diff(a[key], b[key], p, out);
    }
    for (const key of Object.keys(b)) {
      if (!(key in a))
        out.push({ kind: 'ADD', pointer: `${pointer}/${escapeToken(key)}`, after: b[key] });
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const common = Math.min(a.length, b.length);
    if (a.length === b.length) {
      a.forEach((item, i) => diff(item, b[i], `${pointer}/${i}`, out));
      return out;
    }
    const prefixEqual = a.slice(0, common).every((item, i) => deepEqual(item, b[i]));
    if (!prefixEqual) {
      out.push({ kind: 'CHANGE', pointer, before: a, after: b });
    } else if (b.length > a.length) {
      for (let i = common; i < b.length; i += 1) {
        out.push({ kind: 'ADD', pointer: `${pointer}/${i}`, after: b[i] });
      }
    } else {
      for (let i = common; i < a.length; i += 1) {
        out.push({ kind: 'REMOVE', pointer: `${pointer}/${i}`, before: a[i] });
      }
    }
    return out;
  }
  out.push({ kind: 'CHANGE', pointer, before: a, after: b });
  return out;
}

/** Opérations (méthode + chemin) portant `x-edge-available` : on compte les opérations, pas les lignes. */
export function edgeAvailableOperations(spec) {
  const found = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      if (isObject(item[method]) && 'x-edge-available' in item[method]) {
        found.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return found.sort();
}

/** Tous les `$ref` d'un document avec le pointeur de leur emplacement. */
function collectRefs(node, pointer = '', out = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectRefs(item, `${pointer}/${i}`, out));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      const p = `${pointer}/${escapeToken(key)}`;
      if (key === '$ref' && typeof value === 'string') out.push({ at: p, target: value });
      else collectRefs(value, p, out);
    }
  }
  return out;
}

const schemaOfRef = (target) => /^#\/components\/schemas\/([^/]+)/.exec(target)?.[1] ?? null;
const isUnder = (pointer, root) => pointer === root || pointer.startsWith(`${root}/`);

/**
 * Classe chaque différence. `whitelist` : [{ pointer, kind, sha256, ... }] du fichier de référence épinglée.
 * Retourne [{ verdict: 'ADMISE'|'REFUSÉE', kind, pointer, reason }].
 */
export function classify(baseline, candidate, whitelist) {
  const entries = new Map(whitelist.map((w) => [w.pointer, w]));
  const results = diff(baseline, candidate).map((d) => {
    const base = { kind: d.kind, pointer: d.pointer };
    const segments = d.pointer.split('/');
    if (segments.includes('required') && d.kind !== 'ADD') {
      return { ...base, verdict: 'REFUSÉE', reason: 'tableau required préexistant touché' };
    }
    // Relâchement étroit (ADR-187) : UN seul pointeur, valeur d'avant et valeur d'après épinglées.
    const relax = entries.get(d.pointer);
    if (d.kind === 'CHANGE' && relax?.kind === 'relaxation') {
      const same = deepEqual(d.before, relax.before) && subtreeHash(d.after) === relax.sha256;
      return same
        ? { ...base, verdict: 'ADMISE', reason: 'liste blanche (relaxation)' }
        : { ...base, verdict: 'REFUSÉE', reason: 'relâchement différent de celui épinglé' };
    }
    if (d.kind !== 'ADD') {
      return { ...base, verdict: 'REFUSÉE', reason: `${d.kind} : seul un ajout est admis` };
    }
    const entry = entries.get(d.pointer);
    if (!entry) {
      return { ...base, verdict: 'REFUSÉE', reason: 'ajout hors de la liste blanche exacte' };
    }
    if (subtreeHash(d.after) !== entry.sha256) {
      return {
        ...base,
        verdict: 'REFUSÉE',
        reason: 'contenu différent de celui épinglé dans la liste blanche',
      };
    }
    if (entry.kind === 'parameter') {
      const p = d.after;
      if (!isObject(p) || p.in !== 'query' || p.required === true || p.name !== entry.name) {
        return { ...base, verdict: 'REFUSÉE', reason: 'paramètre : query et facultatif exigés' };
      }
    }
    return { ...base, verdict: 'ADMISE', reason: `liste blanche (${entry.kind})` };
  });

  const admittedRoots = results.filter((r) => r.verdict === 'ADMISE').map((r) => r.pointer);
  const refused = (pointer, reason) =>
    results.push({ verdict: 'REFUSÉE', kind: 'REF', pointer, reason });

  // Condition 4 : aucun `$ref` hors périmètre ne pointe vers un schéma nouveau.
  const baseSchemas = new Set(Object.keys(baseline.components?.schemas ?? {}));
  const newSchemas = new Set(
    Object.keys(candidate.components?.schemas ?? {}).filter((n) => !baseSchemas.has(n)),
  );
  for (const ref of collectRefs(candidate)) {
    const name = schemaOfRef(ref.target);
    if (name && newSchemas.has(name) && !admittedRoots.some((root) => isUnder(ref.at, root))) {
      refused(ref.at, `$ref vers le schéma nouveau ${name} depuis un emplacement hors périmètre`);
    }
    if (name && EDGE_ONLY_SCHEMAS[name]) {
      const allowed = EDGE_ONLY_SCHEMAS[name].some((prefix) => ref.at.startsWith(prefix));
      const baseHasIt = collectRefs(baseline).some((r) => r.at === ref.at);
      if (!allowed && !baseHasIt)
        refused(ref.at, `${name} ne doit être référencé que sous /edge/*`);
    }
  }

  // Décompte et ensemble des opérations x-edge-available : inchangés (16).
  const before = edgeAvailableOperations(baseline);
  const after = edgeAvailableOperations(candidate);
  if (before.join('|') !== after.join('|')) {
    refused(
      'x-edge-available',
      `ensemble des opérations modifié (${before.length} -> ${after.length})`,
    );
  }
  return results;
}

function parseArgs(argv) {
  const opts = {};
  const known = new Set(['--candidate', '--baseline-file', '--baseline-json']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || argv[i + 1] === undefined) {
      throw new ToolFailure(`usage : option inconnue ou sans valeur : ${argv[i]}`);
    }
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  return opts;
}

function readText(file, what) {
  if (!existsSync(file)) throw new ToolFailure(`${what} introuvable : ${file}`);
  return readFileSync(file, 'utf8');
}

async function loadYaml() {
  try {
    return (await import('yaml')).parse;
  } catch (err) {
    throw new ToolFailure(`module yaml absent : ${err.message}`);
  }
}

function parseSpec(parse, text, what) {
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ToolFailure(`${what} : YAML invalide : ${String(err.message).split('\n')[0]}`);
  }
  if (!isObject(doc) || !isObject(doc.paths) || !isObject(doc.components)) {
    throw new ToolFailure(`${what} : pas un contrat OpenAPI (paths ou components absent)`);
  }
  return doc;
}

function loadPinned(file) {
  let pinned;
  try {
    pinned = JSON.parse(readText(file, 'référence épinglée'));
  } catch (err) {
    if (err instanceof ToolFailure) throw err;
    throw new ToolFailure(`référence épinglée : JSON invalide : ${err.message}`);
  }
  const ok =
    typeof pinned?.baseline?.commit === 'string' &&
    /^[0-9a-f]{64}$/.test(pinned?.baseline?.sha256 ?? '') &&
    typeof pinned.baseline.path === 'string' &&
    Array.isArray(pinned.admitted_additions);
  if (!ok) throw new ToolFailure('référence épinglée : structure invalide');
  return pinned;
}

function loadBaselineText(pinned, opts) {
  let text;
  if (opts['baseline-file']) {
    text = readText(opts['baseline-file'], 'fichier de référence');
  } else {
    try {
      text = execFileSync('git', ['show', `${pinned.baseline.commit}:${pinned.baseline.path}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new ToolFailure(
        `référence introuvable (git show ${pinned.baseline.commit}) : ${String(err.stderr ?? err.message).trim()}`,
      );
    }
  }
  const actual = sha256Hex(text);
  if (actual !== pinned.baseline.sha256) {
    throw new ToolFailure(
      `référence falsifiée ou différente : SHA-256 ${actual} au lieu de ${pinned.baseline.sha256}`,
    );
  }
  return text;
}

export async function run(argv) {
  const opts = parseArgs(argv);
  const pinned = loadPinned(opts['baseline-json'] ?? DEFAULT_BASELINE_JSON);
  const parse = await loadYaml();
  const baseline = parseSpec(parse, loadBaselineText(pinned, opts), 'référence');
  const candidate = parseSpec(
    parse,
    readText(opts.candidate ?? DEFAULT_CANDIDATE, 'contrat candidat'),
    'candidat',
  );
  const expected = pinned.baseline.x_edge_available_operations;
  if (expected !== undefined && edgeAvailableOperations(baseline).length !== expected) {
    throw new ToolFailure(`référence : le décompte x-edge-available n'est pas ${expected}`);
  }

  const results = classify(baseline, candidate, pinned.admitted_additions);
  for (const r of results) console.log(`${r.verdict} ${r.kind} ${r.pointer} (${r.reason})`);
  const refused = results.filter((r) => r.verdict === 'REFUSÉE');
  console.log(
    `Total : ${results.length} différence(s), ${results.length - refused.length} admise(s), ${refused.length} refusée(s)`,
  );
  for (const r of refused) console.log(`Pointeur refusé : ${r.pointer}`);
  return refused.length ? EXIT_REFUSED : EXIT_OK;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (err) {
    console.error(
      `[contract-stability] PANNE : ${err instanceof ToolFailure ? err.message : err.stack}`,
    );
    process.exitCode = EXIT_FAIL;
  }
}
