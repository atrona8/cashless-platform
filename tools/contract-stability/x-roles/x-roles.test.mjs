// Garde de `x-roles` (WP04, T016) : présence, valeurs de la liste fermée, accord avec la table relue, rôles exacts
// des 11 opérations de la mission (interfaces.md §3), et mutations qui doivent faire échouer chaque contrôle.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { DOUBTS_ACCEPTED, guardProblems } from './guard.mjs';
import { loadTable, operationsOf, ROLE_VALUES } from './apply.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const OPENAPI = join(ROOT, 'packages/contracts/openapi.yaml');
const TABLE = loadTable();
const load = () => parse(readFileSync(OPENAPI, 'utf8'));

/** interfaces.md §3 : rôles exacts des opérations de la mission (l'ordre est celui de la liste fermée). */
const MISSION_11B = {
  getStaffProfile: [
    'PLATFORM_ADMIN',
    'OPERATOR_ADMIN',
    'ORGANIZER_ADMIN',
    'MERCHANT_ADMIN',
    'SUPERVISOR',
    'CASHIER',
    'PERSONALIZER',
  ],
  listEventSales: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'MERCHANT_ADMIN', 'SUPERVISOR'],
  getSale: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'MERCHANT_ADMIN', 'SUPERVISOR'],
  listAnomalies: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'],
  classifyAnomaly: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'],
  searchMedia: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'MERCHANT_ADMIN', 'SUPERVISOR', 'CASHIER'],
  getWalletOverview: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER'],
  searchCustomerByPhone: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR'],
  listPhoneModels: ['PLATFORM_ADMIN', 'OPERATOR_ADMIN', 'ORGANIZER_ADMIN'],
  upsertPhoneModel: ['PLATFORM_ADMIN'],
  deletePhoneModel: ['PLATFORM_ADMIN'],
};

const operation = (doc, id) => operationsOf(doc).find((o) => o.operationId === id).op;

test('le contrat réel : aucune opération sans x-roles, valeurs de la liste, table à jour', () => {
  assert.deepEqual(guardProblems(load(), TABLE), []);
});

test('la liste fermée compte 12 valeurs', () => {
  assert.equal(ROLE_VALUES.length, 12);
  assert.equal(new Set(ROLE_VALUES).size, 12);
});

test('les 11 opérations de la mission ont exactement les rôles de interfaces.md §3', () => {
  const doc = load();
  for (const [id, roles] of Object.entries(MISSION_11B)) {
    assert.deepEqual(operation(doc, id)['x-roles'], roles, id);
  }
  // `searchCustomerByPhone` n'admet pas PLATFORM_ADMIN (renforcement du 24/11/2026).
  assert.ok(!operation(doc, 'searchCustomerByPhone')['x-roles'].includes('PLATFORM_ADMIN'));
});

test('aucun doute silencieux : seuls les doutes acceptés explicitement restent sans x-roles', () => {
  const doubts = Object.entries(TABLE)
    .filter(([, v]) => v.doubt)
    .map(([k]) => k)
    .sort();
  assert.deepEqual(doubts, [...DOUBTS_ACCEPTED].sort());
  const doc = load();
  for (const id of doubts) assert.equal(operation(doc, id)['x-roles'], undefined, id);
  // Sans la liste acceptée, chaque doute est une erreur nommée.
  const named = guardProblems(doc, TABLE, []).filter((p) => p.includes('DOUTE non tranché'));
  assert.equal(named.length, doubts.length);
});

test("chaque ligne de la table a une source fichier:ligne (ou le contrôle prévu d'un lot)", () => {
  for (const [id, entry] of Object.entries(TABLE)) {
    assert.match(entry.source, /^[\w./-]+:\d+$|^packages\/contracts\/openapi\.yaml /, id);
    if (!entry.doubt) assert.ok(entry.roles.length > 0, id);
  }
});

// Mutations : chacune doit faire échouer la garde, avec l'opération nommée.
test("mutation : retirer x-roles d'une opération", () => {
  const doc = load();
  delete operation(doc, 'listDevices')['x-roles'];
  const problems = guardProblems(doc, TABLE);
  assert.ok(problems.some((p) => p.startsWith('listDevices') && p.includes('x-roles absent')));
});

test('mutation : une valeur hors liste (ADMIN)', () => {
  const doc = load();
  operation(doc, 'listDevices')['x-roles'] = ['ADMIN'];
  const problems = guardProblems(doc, TABLE);
  assert.ok(problems.some((p) => p.startsWith('listDevices') && p.includes('valeur hors liste')));
});

test('mutation : vider le tableau', () => {
  const doc = load();
  operation(doc, 'listDevices')['x-roles'] = [];
  const problems = guardProblems(doc, TABLE);
  assert.ok(problems.some((p) => p.startsWith('listDevices') && p.includes('x-roles vide')));
});

test('mutation : un doublon', () => {
  const doc = load();
  operation(doc, 'listDevices')['x-roles'] = ['OPERATOR_ADMIN', 'OPERATOR_ADMIN'];
  assert.ok(guardProblems(doc, TABLE).some((p) => p.includes('doublon')));
});

test('mutation : changer les rôles de upsertPhoneModel (contrat ou table)', () => {
  const doc = load();
  operation(doc, 'upsertPhoneModel')['x-roles'] = ['PLATFORM_ADMIN', 'OPERATOR_ADMIN'];
  assert.ok(guardProblems(doc, TABLE).some((p) => p.startsWith('upsertPhoneModel')));
});

test('mutation : une opération du contrat absente de roles.json', () => {
  const table = JSON.parse(JSON.stringify(TABLE));
  delete table.getSale;
  assert.ok(guardProblems(load(), table).some((p) => p.startsWith('getSale')));
});

test('mutation : une entrée de roles.json sans opération', () => {
  const table = {
    ...JSON.parse(JSON.stringify(TABLE)),
    fantome: { roles: ['DEVICE'], source: 'a:1' },
  };
  assert.ok(guardProblems(load(), table).some((p) => p.startsWith('fantome')));
});

// apply.mjs --check et check.mjs sur des copies d'essai (jamais le dépôt).
const TMP = mkdtempSync(join(tmpdir(), 'x-roles-'));
const run = (script, args) => {
  const r = spawnSync('node', [join(HERE, script), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const copies = () => {
  const dir = mkdtempSync(join(TMP, 'c-'));
  const openapi = join(dir, 'openapi.yaml');
  const baseline = join(dir, 'contract-baseline.json');
  cpSync(OPENAPI, openapi);
  cpSync(join(HERE, '..', 'contract-baseline.json'), baseline);
  return { openapi, baseline };
};

test('apply --check : conforme sur le dépôt, échoue si une valeur est modifiée à la main', () => {
  const ok = copies();
  assert.equal(
    run('apply.mjs', ['--check', '--openapi', ok.openapi, '--baseline-json', ok.baseline]).code,
    0,
  );
  const bad = copies();
  const text = readFileSync(bad.openapi, 'utf8');
  const mutated = text.replace('x-roles: [PLATFORM_ADMIN]', 'x-roles: [PLATFORM_ADMIN, CASHIER]');
  assert.notEqual(mutated, text);
  writeFileSync(bad.openapi, mutated);
  const result = run('apply.mjs', [
    '--check',
    '--openapi',
    bad.openapi,
    '--baseline-json',
    bad.baseline,
  ]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /x-roles/);
});

test('apply est idempotent : un second passage ne change rien', () => {
  const c = copies();
  const args = ['--openapi', c.openapi, '--baseline-json', c.baseline];
  assert.equal(run('apply.mjs', args).code, 0);
  const first = [readFileSync(c.openapi, 'utf8'), readFileSync(c.baseline, 'utf8')];
  assert.equal(run('apply.mjs', args).code, 0);
  assert.deepEqual([readFileSync(c.openapi, 'utf8'), readFileSync(c.baseline, 'utf8')], first);
  assert.equal(first[0], readFileSync(OPENAPI, 'utf8'));
});

test("check.mjs refuse un x-roles dont l'entrée de référence a été retirée", () => {
  const c = copies();
  const pinned = JSON.parse(readFileSync(c.baseline, 'utf8'));
  const before = pinned.admitted_additions.length;
  pinned.admitted_additions = pinned.admitted_additions.filter(
    (e) => e.pointer !== '/paths/~1devices/get/x-roles',
  );
  assert.equal(pinned.admitted_additions.length, before - 1);
  writeFileSync(c.baseline, `${JSON.stringify(pinned, null, 2)}\n`);
  const result = run('../check.mjs', ['--candidate', c.openapi, '--baseline-json', c.baseline]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /Pointeur refusé : \/paths\/~1devices\/get\/x-roles/);
});

test("check.mjs refuse un x-roles dont le contenu diffère de l'empreinte épinglée", () => {
  const c = copies();
  const text = readFileSync(c.openapi, 'utf8');
  const mutated = text.replace(
    /(operationId: listDevices\n\s+x-roles: )\[OPERATOR_ADMIN, ORGANIZER_ADMIN\]/,
    '$1[OPERATOR_ADMIN, ORGANIZER_ADMIN, CASHIER]',
  );
  assert.notEqual(mutated, text);
  writeFileSync(c.openapi, mutated);
  const result = run('../check.mjs', ['--candidate', c.openapi]);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /Pointeur refusé : \/paths\/~1devices\/get\/x-roles/);
});
