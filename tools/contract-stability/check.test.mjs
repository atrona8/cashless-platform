// Tests du contrôle de stabilité (T1 à T14 de contract-stability-check.md et cas additionnels).
// Chaque cas fabrique un contrat d'essai dans un dossier temporaire à partir de la référence (jamais le dépôt), appelle
// l'outil comme un processus et vérifie le code de sortie ET le pointeur nommé. Un comparateur « toujours 0 » ferait
// échouer chaque cas de refus (code 0 au lieu de 2) ; un comparateur « toujours 2 » ferait échouer T10 et T11.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { canonical } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const TOOL = join(HERE, 'check.mjs');
const PINNED = JSON.parse(readFileSync(join(HERE, 'contract-baseline.json'), 'utf8'));
const REAL = join(ROOT, 'packages/contracts/openapi.yaml');
const ADDITIONS = join(
  ROOT,
  'kitty-specs/passerelle-locale-01M6NM1S/contracts/replication-page-additions.yaml',
);
const TMP = mkdtempSync(join(tmpdir(), 'contract-stability-'));
const BASE_TEXT = execFileSync(
  'git',
  ['show', `${PINNED.baseline.commit}:${PINNED.baseline.path}`],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const fresh = () => parse(BASE_TEXT);
let counter = 0;

function runTool(args) {
  const r = spawnSync('node', [TOOL, ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Écrit un contrat muté et prouve que la mutation a eu lieu avant l'appel. */
function candidate(mutate, { expectDifferent = true } = {}) {
  const doc = fresh();
  mutate(doc);
  assert.equal(
    expectDifferent,
    canonical(doc) !== canonical(fresh()),
    'la mutation doit changer le contrat',
  );
  counter += 1;
  const file = join(TMP, `candidate-${counter}.yaml`);
  writeFileSync(file, stringify(doc));
  return file;
}

function expectRefused(mutate, pointer) {
  const { code, out } = runTool(['--candidate', candidate(mutate)]);
  assert.equal(code, 2, out);
  assert.ok(out.includes(`Pointeur refusé : ${pointer}`) || out.includes(pointer), out);
}

const feed = (d) => d.paths['/edge/replication-feed'].get;

test('T1 operationId renommé', () => {
  expectRefused((d) => {
    d.paths['/payments'].post.operationId = 'createPaymentX';
  }, '/paths/~1payments/post/operationId');
});
test('T2 code 409 retiré de POST /payments', () => {
  expectRefused((d) => {
    delete d.paths['/payments'].post.responses['409'];
  }, '/paths/~1payments/post/responses/409');
});
test('T3 required ajouté à ReplicationPage', () => {
  expectRefused((d) => {
    d.components.schemas.ReplicationPage.required.push('has_more_x');
  }, '/components/schemas/ReplicationPage/required/7');
});
test('T4 propriété ajoutée à OfflineSnapshot (schéma partagé)', () => {
  expectRefused((d) => {
    d.components.schemas.OfflineSnapshot.properties.extra = { type: 'string' };
  }, '/components/schemas/OfflineSnapshot/properties/extra');
});
test('T5 paramètre obligatoire ajouté', () => {
  expectRefused((d) => {
    feed(d).parameters.push({
      name: 'x',
      in: 'query',
      required: true,
      schema: { type: 'integer' },
    });
  }, '/paths/~1edge~1replication-feed/get/parameters/4');
});
test('T6 description de getEdgeReplicationFeed modifiée', () => {
  expectRefused((d) => {
    feed(d).description += ' ';
  }, '/paths/~1edge~1replication-feed/get/description');
});
test('T7 x-edge-available retiré', () => {
  const op = Object.entries(fresh().paths).find(([, i]) =>
    Object.values(i).some((o) => o && o['x-edge-available'] !== undefined),
  );
  const method = Object.keys(op[1]).find((m) => op[1][m]?.['x-edge-available'] !== undefined);
  expectRefused((d) => {
    delete d.paths[op[0]][method]['x-edge-available'];
  }, 'x-edge-available');
});
test('T8 route nouvelle POST /edge/nouvelle', () => {
  expectRefused((d) => {
    d.paths['/edge/nouvelle'] = {
      post: { operationId: 'nouvelle', responses: { 200: { description: 'x' } } },
    };
  }, '/paths/~1edge~1nouvelle');
});
test('T9 valeur retirée de DeviceStatus', () => {
  expectRefused((d) => {
    d.components.schemas.DeviceStatus.enum.pop();
  }, '/components/schemas/DeviceStatus/enum');
});
test('T10 copie identique : code 0, zéro différence', () => {
  const file = candidate(() => {}, { expectDifferent: false });
  const { code, out } = runTool(['--candidate', file]);
  assert.equal(code, 0, out);
  assert.match(out, /Total : 0 différence/);
});

/** Fusion programmatique de l'extrait, indépendante de l'édition de openapi.yaml. */
function mergeAdditions(d) {
  const add = parse(readFileSync(ADDITIONS, 'utf8'));
  feed(d).parameters.push(...add.paths['/edge/replication-feed'].get.parameters);
  const rp = add.components.schemas.ReplicationPage.properties;
  const target = d.components.schemas.ReplicationPage.properties;
  for (const [k, v] of Object.entries(rp)) {
    if (k === 'wallets') {
      Object.assign(target.wallets.items.properties, v.items.properties);
    } else target[k] = v;
  }
  Object.assign(
    d.components.schemas.EdgeSyncBatch.properties,
    add.components.schemas.EdgeSyncBatch.properties,
  );
  for (const [k, v] of Object.entries(add.components.schemas)) {
    if (k.startsWith('Edge') && k !== 'EdgeSyncBatch') d.components.schemas[k] = v;
  }
}
test('T11 les seuls ajouts de l extrait : code 0, uniquement ADMISE', () => {
  const { code, out } = runTool(['--candidate', candidate(mergeAdditions)]);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /REFUSÉE/);
  assert.match(out, /Total : 23 différence\(s\), 23 admise\(s\), 0 refusée/);
});
test('T11 bis : le openapi.yaml réel du dépôt est admis', () => {
  const { code, out } = runTool(['--candidate', REAL]);
  assert.equal(code, 0, out);
  assert.match(out, /29 admise\(s\), 0 refusée/);
});
test('T12 SHA-256 épinglée fausse : code 1', () => {
  const wrong = join(TMP, 'baseline-wrong.json');
  writeFileSync(
    wrong,
    JSON.stringify({ ...PINNED, baseline: { ...PINNED.baseline, sha256: '0'.repeat(64) } }),
  );
  const { code, out } = runTool(['--baseline-json', wrong, '--candidate', REAL]);
  assert.equal(code, 1, out);
  assert.doesNotMatch(out, /ADMISE/);
});
test('T12 bis : fichier de référence falsifié : code 1', () => {
  const fake = join(TMP, 'fake-baseline.yaml');
  writeFileSync(fake, `${BASE_TEXT}\n# falsifié\n`);
  assert.equal(runTool(['--baseline-file', fake, '--candidate', REAL]).code, 1);
});
test('T12 ter : commit de référence absent : code 1', () => {
  const missing = join(TMP, 'baseline-missing.json');
  writeFileSync(
    missing,
    JSON.stringify({ ...PINNED, baseline: { ...PINNED.baseline, commit: 'f'.repeat(40) } }),
  );
  assert.equal(runTool(['--baseline-json', missing, '--candidate', REAL]).code, 1);
});
test('T13 valeur ajoutée à ShortfallReason ou OfflineRejectReason', () => {
  for (const name of ['ShortfallReason', 'OfflineRejectReason']) {
    expectRefused((d) => {
      d.components.schemas[name].enum.push('NOUVELLE_VALEUR');
    }, `/components/schemas/${name}/enum/`);
  }
});
test('T14 autre propriété sur EdgeSyncBatch, ou staff_token_audit dans required', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.EdgeSyncBatch.properties.autre = { type: 'string' };
  }, '/components/schemas/EdgeSyncBatch/properties/autre');
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.EdgeSyncBatch.required.push('staff_token_audit');
  }, '/components/schemas/EdgeSyncBatch/required/');
});

// ---- Cas additionnels visant les trous
test('propriété ajoutée à EdgeDevice hors de la liste blanche exacte', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.EdgeDevice.properties.secret = { type: 'string' };
  }, '/components/schemas/EdgeDevice');
});
test('$ref de DeviceConfig vers EdgeDevice', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.DeviceConfig.properties.edge = { $ref: '#/components/schemas/EdgeDevice' };
  }, '/components/schemas/DeviceConfig/properties/edge');
});
test('nouveau schéma sans préfixe Edge', () => {
  expectRefused((d) => {
    d.components.schemas.Passerelle = { type: 'object' };
  }, '/components/schemas/Passerelle');
});
test('schéma Edge* nouveau non listé', () => {
  expectRefused((d) => {
    d.components.schemas.EdgeAutre = { type: 'object' };
  }, '/components/schemas/EdgeAutre');
});
test('schéma Edge* atteint depuis une route hors /edge/*', () => {
  const { code, out } = runTool([
    '--candidate',
    candidate((d) => {
      mergeAdditions(d);
      d.paths['/payments'].post.requestBody.content['application/json'].schema = {
        $ref: '#/components/schemas/EdgeDevice',
      };
    }),
  ]);
  assert.equal(code, 2, out);
  assert.match(out, /\$ref vers le schéma nouveau EdgeDevice/);
});
test('ReplicationPage référencé hors /edge/*', () => {
  const { code, out } = runTool([
    '--candidate',
    candidate((d) => {
      d.paths['/payments'].post.requestBody.content['application/json'].schema = {
        $ref: '#/components/schemas/ReplicationPage',
      };
    }),
  ]);
  assert.equal(code, 2, out);
});
test('paramètre ajouté non facultatif ou à un autre rang', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    feed(d).parameters[4].required = true;
  }, '/paths/~1edge~1replication-feed/get/parameters/4');
  expectRefused((d) => {
    mergeAdditions(d);
    const p = feed(d).parameters;
    p.unshift(p.pop());
  }, '/paths/~1edge~1replication-feed/get/parameters');
});
test('contenu d un ajout admis modifié', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.EdgeStaff.properties.email = { type: 'string' };
  }, '/components/schemas/EdgeStaff');
});
test('required préexistant de wallets touché', () => {
  expectRefused((d) => {
    mergeAdditions(d);
    d.components.schemas.ReplicationPage.properties.wallets.items.required.push('kyc_verified');
  }, '/components/schemas/ReplicationPage/properties/wallets/items/required/4');
});
test('x-edge-available ajouté à une 17e opération', () => {
  expectRefused((d) => {
    d.paths['/edge/sync-batches'].post['x-edge-available'] = true;
  }, 'x-edge-available');
});
test('ordre des clés et commentaires changés : pas de refus à tort', () => {
  const doc = fresh();
  const reordered = Object.fromEntries(Object.entries(doc).reverse());
  const file = join(TMP, 'reordered.yaml');
  writeFileSync(file, `# commentaire\n${stringify(reordered)}\n# autre commentaire\n`);
  assert.notEqual(readFileSync(file, 'utf8'), BASE_TEXT);
  const { code, out } = runTool(['--candidate', file]);
  assert.equal(code, 0, out);
});
test('pannes : candidat inexistant, YAML invalide, option inconnue : code 1', () => {
  assert.equal(runTool(['--candidate', join(TMP, 'nexiste-pas.yaml')]).code, 1);
  const bad = join(TMP, 'bad.yaml');
  writeFileSync(bad, 'a: [unclosed\n  b: : :\n');
  assert.equal(runTool(['--candidate', bad]).code, 1);
  assert.equal(runTool(['--bogus', 'x']).code, 1);
});

// --- WP25 partie A (ADR-185, ADR-187) : le relâchement de minItems est admis à UN pointeur et à UNE valeur.
const REAL_DOC = () => parse(readFileSync(REAL, 'utf8'));
function realCandidate(mutate) {
  const doc = REAL_DOC();
  mutate(doc);
  counter += 1;
  const file = join(TMP, `real-${counter}.yaml`);
  writeFileSync(file, stringify(doc));
  return file;
}
const ops = (d) => d.components.schemas.EdgeSyncBatch.properties.operations;
test('WP25 relâchement de minItems : seule la valeur 0 au pointeur épinglé est admise', () => {
  assert.equal(ops(REAL_DOC()).minItems, 0);
  const wrongValue = runTool(['--candidate', realCandidate((d) => (ops(d).minItems = 2))]);
  assert.equal(wrongValue.code, 2, wrongValue.out);
  assert.match(
    wrongValue.out,
    /Pointeur refusé : \/components\/schemas\/EdgeSyncBatch\/properties\/operations\/minItems/,
  );
});
test('WP25 le relâchement ne vaut pas pour un autre pointeur (maxItems de operations)', () => {
  const r = runTool(['--candidate', realCandidate((d) => (ops(d).maxItems = 501))]);
  assert.equal(r.code, 2, r.out);
  assert.match(
    r.out,
    /Pointeur refusé : \/components\/schemas\/EdgeSyncBatch\/properties\/operations\/maxItems/,
  );
});
test('WP25 le relâchement de minItems ailleurs (autre tableau) reste refusé', () => {
  const r = runTool([
    '--candidate',
    realCandidate((d) => {
      d.components.schemas.EdgeSyncBatch.properties.device_batches.minItems = 0;
    }),
  ]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /device_batches\/minItems/);
});
test('WP25 le texte de x-empty-batch et spend_order sont épinglés (contenu modifié : refusé)', () => {
  const a = runTool([
    '--candidate',
    realCandidate((d) => {
      d.components.schemas.EdgeSyncBatch['x-empty-batch'].description += ' x';
    }),
  ]);
  assert.equal(a.code, 2, a.out);
  const b = runTool([
    '--candidate',
    realCandidate((d) => {
      d.components.schemas.ReplicationPage.properties.edge_terms.properties.spend_order.enum.push(
        'X',
      );
    }),
  ]);
  assert.equal(b.code, 2, b.out);
  assert.match(b.out, /ReplicationPage\/properties\/edge_terms/);
});
