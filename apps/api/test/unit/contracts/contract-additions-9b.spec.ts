// C-002 : le contrat de la mission 9b n'ajoute que ce que `contract-additions.md` liste, validé
// par le porteur le 17/11/2026, et ne modifie rien d'existant. Base : contrat de la fin de la 9a.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Fin de la 9a (fusion de la PR #17) : base de comparaison de la mission. */
const BASE_COMMIT = 'b537c16d';
const CONTRACT = 'packages/contracts/openapi.yaml';
const ROOT = join(__dirname, '../../../../..');
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

function loadBase(): Obj {
  let text: string;
  try {
    text = execFileSync('git', ['show', `${BASE_COMMIT}:${CONTRACT}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Contrat de base introuvable (git show ${BASE_COMMIT}:${CONTRACT}) : ` +
        'le checkout doit avoir ' +
        `l'historique de la 9a. ${String(error)}`,
    );
  }
  return parse(text) as Obj;
}

const base = loadBase();
const next = parse(readFileSync(join(ROOT, CONTRACT), 'utf8')) as Obj;

const ADDED_OPERATIONS = [
  'listEventClosingSteps',
  'previewEventClosingStep',
  'executeEventClosingStep',
  'getEventRemainingBalances',
  'listPayoutEntitlements',
  'requestPayoutBatch',
  'listPayouts',
  'exportPayoutBatch',
  'confirmPayout',
  'importAccountStatement',
  'listStatementLines',
  'matchStatementLine',
  'getLedgerReconciliation',
  'postLateAdjustment',
  'createRefundRequest',
  'getPartyStatement',
  'getMyWalletStatement',
  'listAccountMappings',
  'createAccountMappingVersion',
  'exportAccounting',
];
const ADDED_SCHEMAS = [
  'ClosingStep',
  'ClosingStepState',
  'ClosingStepPreview',
  'ClosingStepResult',
  'RemainingBalances',
  'PayoutEntitlement',
  'PayoutBatchRequest',
  'PayoutLine',
  'Payout',
  'PayoutConfirm',
  'StatementImportResult',
  'StatementLine',
  'StatementLineMatch',
  'AccountReconciliation',
  'LateAdjustmentRequest',
  'RefundRequestBackofficeCreate',
  'PartyStatement',
  'AccountMapping',
  'AccountMappingVersion',
];
const ADDED_PATHS = [
  '/operators/{operator_id}/events/{event_id}/closing-steps',
  '/operators/{operator_id}/events/{event_id}/closing-steps/{step}/preview',
  '/operators/{operator_id}/events/{event_id}/closing-steps/{step}',
  '/operators/{operator_id}/events/{event_id}/remaining-balances',
  '/ledgers/{ledger_id}/payout-entitlements',
  '/ledgers/{ledger_id}/payout-batches/approval-requests',
  '/ledgers/{ledger_id}/payouts',
  '/ledgers/{ledger_id}/payout-batches/{approval_request_id}/export',
  '/payouts/{payout_id}/confirm',
  '/ledgers/{ledger_id}/accounts/{account_id}/statements',
  '/ledgers/{ledger_id}/statement-lines',
  '/statement-lines/{statement_line_id}/match',
  '/ledgers/{ledger_id}/reconciliation',
  '/ledgers/{ledger_id}/late-adjustments',
  '/operators/{operator_id}/events/{event_id}/statements/{party_kind}',
  '/me/wallets/{wallet_id}/statement',
  '/operators/{operator_id}/account-mappings',
  '/operators/{operator_id}/accounting-exports',
];
const ADDED_CONDITION_CODES = [
  'NO_OPEN_CASH_SESSION',
  'REFUND_DEADLINE_REACHED',
  'CLOSING_STEPS_DONE',
];
// Texte de la puce tel que l'analyseur YAML le rend (indentation du bloc retirée).
const PROBLEM_BULLET =
  "- `PAYOUT_EXCEEDS_ENTITLEMENT` (409, `CL055`) : montant d'un versement supérieur au droit net " +
  'disponible du\n' +
  '  bénéficiaire, versements en cours déduits (mission 9b).\n';

/**
 * Mission serveur-app-festivalier (10a), décision du porteur du 20/11/2026, ADR-225 : trois ajouts rétrocompatibles
 * au contrat, inscrits dans `contract-baseline.json`. Ce sont les SEULS écarts admis, par chemin exact ; chacun est
 * vérifié à part (`contrat de la mission 10a`) et tout autre écart reste un échec.
 */
const ADDED_BY_10A = [
  "paths['/kyc-verifications/{kyc_verification_id}/revoke'].post.responses.422 : clé ajoutée",
  "paths['/operators/{operator_id}/media-batches/{batch_id}/claim-code-associations'].post.requestBody.content['text/csv'].schema.description : valeur modifiée",
  'components.schemas.ClaimCodeAssociationResult.properties.rejected.items.properties.reason.enum : longueur modifiée',
];

/**
 * Mission remboursement-partiel-especes (9c), décision du porteur du 23/11/2026, ADR-233 : l'opération
 * `refundPartialCash`, ses deux schémas, la propriété facultative `cash_partial_refund_enabled` d'`Event` et
 * d'`EventUpdate`, et quatre descriptions. Seuls écarts admis, par chemin exact, avec ceux de la 10a. Le chemin et
 * les deux schémas sont des objets nouveaux : ils ne sont pas des modifications d'existant.
 */
const ADDED_BY_9C = [
  "paths['/operators/{operator_id}/config-versions'].post.description : valeur modifiée",
  "paths['/operators/{operator_id}/events/{event_id}/config'].get.description : valeur modifiée",
  'components.schemas.Event.description : valeur modifiée',
  'components.schemas.Event.properties.cash_partial_refund_enabled : clé ajoutée',
  'components.schemas.EventUpdate.description : valeur modifiée',
  'components.schemas.EventUpdate.properties.cash_partial_refund_enabled : clé ajoutée',
];
const ADDED_OPERATIONS_9C = ['refundPartialCash'];
const ADDED_SCHEMAS_9C = ['PartialCashRefundCreate', 'PartialCashRefund'];
const ADDED_PATHS_9C = ['/media/{media_id}/partial-cash-refunds'];

function obj(value: Json | undefined, what: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} : objet attendu`);
  }
  return value;
}

function operations(doc: Obj): Map<string, { method: string; path: string; op: Obj }> {
  const found = new Map<string, { method: string; path: string; op: Obj }>();
  for (const [path, item] of Object.entries(obj(doc.paths, 'paths'))) {
    for (const [method, op] of Object.entries(obj(item, path))) {
      if (!METHODS.includes(method)) continue;
      const operation = obj(op, `${method} ${path}`);
      const id = operation.operationId;
      if (typeof id !== 'string') throw new Error(`${method} ${path} : operationId absent`);
      if (found.has(id)) throw new Error(`operationId en double : ${id}`);
      found.set(id, { method, path, op: operation });
    }
  }
  return found;
}

/** Chemins où des clés peuvent être ajoutées (le contenu exact des ajouts est vérifié à part). */
const EXTENSIBLE = new Set(['paths', 'components.schemas', "paths['/refund-requests']"]);
/** Textes qui changent, avec la règle propre à chacun (vérifiée dans les tests de description). */
const EDITED_TEXT = new Set([
  'components.schemas.ProblemCode.description',
  'components.schemas.StatusCondition.properties.code.description',
  'components.parameters.IdempotencyKey.description',
]);
const EXTENDED_ENUM = 'components.schemas.ProblemCode.enum';

/** Écarts entre le contrat de base et le nouveau : l'existant reste à l'identique. */
function violations(a: Json, b: Json | undefined, path: string, out: string[]): void {
  if (b === undefined) {
    out.push(`${path} : retiré`);
  } else if (Array.isArray(a)) {
    if (!Array.isArray(b)) return void out.push(`${path} : n'est plus une liste`);
    if (path === EXTENDED_ENUM) {
      if (JSON.stringify(b.slice(0, a.length)) !== JSON.stringify(a)) {
        out.push(`${path} : valeurs existantes modifiées ou réordonnées`);
      }
      return;
    }
    if (a.length !== b.length) return void out.push(`${path} : longueur modifiée`);
    a.forEach((item, i) => violations(item, b[i], `${path}[${i}]`, out));
  } else if (typeof a === 'object' && a !== null) {
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      return void out.push(`${path} : n'est plus un objet`);
    }
    for (const [key, value] of Object.entries(a)) {
      const sub = /^[A-Za-z0-9_]+$/.test(key) ? `${path}.${key}` : `${path}['${key}']`;
      violations(value, b[key], sub.replace(/^\./, ''), out);
    }
    if (!EXTENSIBLE.has(path)) {
      for (const key of Object.keys(b)) {
        if (!(key in a)) out.push(`${path}.${key} : clé ajoutée`);
      }
    }
  } else if (a !== b && !EDITED_TEXT.has(path)) {
    out.push(`${path} : valeur modifiée`);
  }
}

function hasRefOneOf(node: Json | undefined): boolean {
  if (Array.isArray(node)) return node.some(hasRefOneOf);
  if (typeof node !== 'object' || node === null) return false;
  const one = node.oneOf;
  if (Array.isArray(one) && one.some((x) => typeof x === 'object' && x !== null && '$ref' in x)) {
    return true;
  }
  return Object.values(node).some(hasRefOneOf);
}

describe('contrat de la mission 9b (C-002)', () => {
  const baseOps = operations(base);
  const nextOps = operations(next);

  it('conserve tout operationId de la base, avec la même méthode et le même chemin', () => {
    for (const [id, { method, path }] of baseOps) {
      const now = nextOps.get(id);
      expect(now ? `${now.method} ${now.path}` : `${id} absent`).toBe(`${method} ${path}`);
    }
  });

  it('conserve tout chemin de la base et toutes ses méthodes', () => {
    const basePaths = obj(base.paths, 'paths');
    const nextPaths = obj(next.paths, 'paths');
    for (const [path, item] of Object.entries(basePaths)) {
      const now = obj(nextPaths[path], `chemin ${path} absent`);
      for (const method of Object.keys(obj(item, path))) {
        expect(method in now ? method : `${method} ${path} absent`).toBe(method);
      }
    }
  });

  it('ne modifie ni ne retire rien d existant (champs, required, enum, réponses)', () => {
    const found: string[] = [];
    violations(base, next, '', found);
    // Seuls les ajouts de la 10a (ADR-225) et de la 9c (ADR-233) sont admis ; chacun est vérifié à part.
    expect(
      found.filter((entry) => !ADDED_BY_10A.includes(entry) && !ADDED_BY_9C.includes(entry)),
    ).toEqual([]);
  });

  it('contrat de la mission 10a (ADR-225) : exactement les trois ajouts décidés, rien de plus', () => {
    const found: string[] = [];
    violations(base, next, '', found);
    expect(found.filter((entry) => ADDED_BY_10A.includes(entry)).sort()).toEqual(
      [...ADDED_BY_10A].sort(),
    );
    const at = (doc: Obj, ...keys: string[]): Json | undefined =>
      keys.reduce<Json | undefined>(
        (node, key) => (typeof node === 'object' && node !== null ? (node as Obj)[key] : undefined),
        doc,
      );
    // 1. `422` sur revokeKycVerification : la réponse commune, rien d'autre ne change dans les réponses.
    const revoke = [
      'paths',
      '/kyc-verifications/{kyc_verification_id}/revoke',
      'post',
      'responses',
    ];
    const before = Object.keys(at(base, ...revoke) as Obj);
    const after = at(next, ...revoke) as Obj;
    expect(Object.keys(after).filter((code) => !before.includes(code))).toEqual(['422']);
    expect(after['422']).toEqual({ $ref: '#/components/responses/Unprocessable' });
    // 2. description du corps text/csv : seule la description change (même type), colonne `printed_number`.
    const csv = [
      'paths',
      '/operators/{operator_id}/media-batches/{batch_id}/claim-code-associations',
      'post',
      'requestBody',
      'content',
      'text/csv',
      'schema',
    ];
    expect({ ...(at(next, ...csv) as Obj), description: null }).toEqual({
      ...(at(base, ...csv) as Obj),
      description: null,
    });
    expect(at(next, ...csv, 'description')).toContain('printed_number');
    // 3. motifs de rejet : les anciennes valeurs, dans l'ordre, puis exactement les deux nouveaux.
    const reason = [
      'components',
      'schemas',
      'ClaimCodeAssociationResult',
      'properties',
      'rejected',
      'items',
      'properties',
      'reason',
    ];
    const oldReasons = at(base, ...reason, 'enum') as string[];
    expect(at(next, ...reason, 'enum')).toEqual([
      ...oldReasons,
      'BAD_PRINTED_NUMBER',
      'PRINTED_NUMBER_TAKEN',
    ]);
  });

  it('contrat de la mission 9c (ADR-233) : exactement les ajouts décidés, rien de plus', () => {
    const found: string[] = [];
    violations(base, next, '', found);
    expect(found.filter((entry) => ADDED_BY_9C.includes(entry)).sort()).toEqual(
      [...ADDED_BY_9C].sort(),
    );
    const added = (names: string[], all: string[]): string[] =>
      all.filter((name) => !names.includes(name));
    // Un seul objet nouveau de chaque sorte : l'opération, son chemin et ses deux schémas.
    const newOps = [...nextOps.keys()].filter((id) => !baseOps.has(id));
    expect(added(ADDED_OPERATIONS, newOps)).toEqual(ADDED_OPERATIONS_9C);
    const basePaths = Object.keys(obj(base.paths, 'paths'));
    const newPaths = Object.keys(obj(next.paths, 'paths')).filter((p) => !basePaths.includes(p));
    expect(added(ADDED_PATHS, newPaths)).toEqual(ADDED_PATHS_9C);
    const schemas = (doc: Obj): Obj => obj(obj(doc.components, 'c').schemas, 's');
    const newSchemas = Object.keys(schemas(next)).filter((n) => !(n in schemas(base)));
    expect(added(ADDED_SCHEMAS, newSchemas).sort()).toEqual([...ADDED_SCHEMAS_9C].sort());
    // Aucun code d'erreur nouveau : l'énumération des problèmes garde ses seules valeurs de la 9b.
    const codes = (doc: Obj): Json[] => (obj(schemas(doc).ProblemCode, 'p').enum as Json[]) ?? [];
    expect(codes(next)).toEqual([...codes(base), 'PAYOUT_EXCEEDS_ENTITLEMENT']);
    // Propriété d'événement : facultative, booléenne, jamais dans `required`.
    for (const name of ['Event', 'EventUpdate']) {
      const event = obj(schemas(next)[name], name);
      expect(obj(obj(event.properties, 'p').cash_partial_refund_enabled, 'c').type).toBe('boolean');
      expect((event.required as string[] | undefined) ?? []).not.toContain(
        'cash_partial_refund_enabled',
      );
      const old = obj(schemas(base)[name], name);
      expect(event.required).toEqual(old.required);
    }
    // Opération : mêmes en-têtes et sécurité que `releaseMedia`, `Idempotency-Key` obligatoire.
    const refund = nextOps.get('refundPartialCash');
    const release = nextOps.get('releaseMedia');
    expect(refund?.method).toBe('post');
    expect(refund?.op.security).toEqual(release?.op.security);
    expect(refund?.op.parameters).toEqual(release?.op.parameters);
    expect(refund?.op['x-process']).toBe('public');
    // Aucune réponse hors des codes communs existants.
    expect(Object.keys(obj(refund?.op.responses, 'responses')).sort()).toEqual(
      ['201', '400', '401', '403', '404', '409', '422'].sort(),
    );
  });

  it('ajoute exactement les 20 opérations listées', () => {
    const added = [...nextOps.keys()].filter(
      (id) => !baseOps.has(id) && !ADDED_OPERATIONS_9C.includes(id),
    );
    expect(added.sort()).toEqual([...ADDED_OPERATIONS].sort());
    expect(added).toHaveLength(20);
  });

  it('ajoute exactement 18 chemins (le 19e est un ajout de méthode à /refund-requests)', () => {
    const basePaths = Object.keys(obj(base.paths, 'paths'));
    const added = Object.keys(obj(next.paths, 'paths')).filter(
      (p) => !basePaths.includes(p) && !ADDED_PATHS_9C.includes(p),
    );
    expect(added.sort()).toEqual([...ADDED_PATHS].sort());
    const refund = obj(obj(next.paths, 'paths')['/refund-requests'], '/refund-requests');
    expect(Object.keys(refund).sort()).toEqual(['get', 'post']);
    expect(nextOps.get('createRefundRequest')).toMatchObject({
      method: 'post',
      path: '/refund-requests',
    });
  });

  it('ajoute exactement les 19 schémas listés', () => {
    const baseSchemas = Object.keys(obj(obj(base.components, 'c').schemas, 's'));
    const added = Object.keys(obj(obj(next.components, 'c').schemas, 's')).filter(
      (name) => !baseSchemas.includes(name) && !ADDED_SCHEMAS_9C.includes(name),
    );
    expect(added.sort()).toEqual([...ADDED_SCHEMAS].sort());
    expect(added).toHaveLength(19);
  });

  it('ajoute à ProblemCode la seule valeur PAYOUT_EXCEEDS_ENTITLEMENT et sa puce', () => {
    const code = (doc: Obj): Obj =>
      obj(obj(obj(doc.components, 'c').schemas, 's').ProblemCode, 'p');
    const baseValues = code(base).enum as string[];
    expect((code(next).enum as string[]).slice(baseValues.length)).toEqual([
      'PAYOUT_EXCEEDS_ENTITLEMENT',
    ]);
    expect((code(next).description as string).replace(PROBLEM_BULLET, '')).toBe(
      code(base).description,
    );
    expect(code(next).description).toContain('`PAYOUT_EXCEEDS_ENTITLEMENT` (409, `CL055`)');
  });

  it('ajoute exactement trois codes à la description de StatusCondition.code', () => {
    const description = (doc: Obj): string => {
      const schema = obj(obj(obj(doc.components, 'c').schemas, 's').StatusCondition, 'sc');
      const props = obj(schema.properties, 'props');
      return String(obj(props.code, 'code').description);
    };
    const codes = (text: string): Set<string> =>
      new Set([...text.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1] as string));
    const before = codes(description(base));
    const after = codes(description(next));
    expect([...before].filter((c) => !after.has(c))).toEqual([]);
    expect([...after].filter((c) => !before.has(c)).sort()).toEqual(
      [...ADDED_CONDITION_CODES].sort(),
    );
    // PSP_RECONCILED passe de la liste « externe » à la liste « calculée » : même valeur.
    expect(description(next)).toMatch(/POSITIONS_SETTLED[^.]*PSP_RECONCILED[^.]*\(calculée/);
    expect(description(next)).not.toMatch(/EXTERNAL[^.]*PSP_RECONCILED/);
  });

  it('n ajoute que exportPayoutBatch à la liste des routes à réponse non conservée', () => {
    const text = (doc: Obj): string =>
      String(obj(obj(obj(doc.components, 'c').parameters, 'p').IdempotencyKey, 'k').description);
    expect(text(next).replace(', `exportPayoutBatch`', '')).toBe(text(base));
    expect(text(next)).toContain('`exportPayoutBatch`');
  });

  it('déclare toute opération ajoutée x-process: public, sans sécurité propre', () => {
    for (const id of ADDED_OPERATIONS) {
      const entry = nextOps.get(id);
      expect(entry?.op['x-process']).toBe('public');
      expect(entry?.op.security).toBeUndefined();
    }
  });

  it('toute écriture ajoutée porte Idempotency-Key, aucune lecture ne la porte', () => {
    for (const id of ADDED_OPERATIONS) {
      const entry = nextOps.get(id);
      const params = JSON.stringify(entry?.op.parameters ?? []);
      const keyed = params.includes('#/components/parameters/IdempotencyKey');
      expect([id, keyed]).toEqual([id, entry?.method !== 'get']);
    }
  });

  it('n ajoute aucun oneOf de $ref dans les schémas ajoutés (piège Dart)', () => {
    const schemas = obj(obj(next.components, 'c').schemas, 's');
    for (const name of ADDED_SCHEMAS)
      expect([name, hasRefOneOf(schemas[name])]).toEqual([name, false]);
  });

  it('aucun schéma de lecture ajouté ne porte IBAN ni numéro de destination', () => {
    const schemas = obj(obj(next.components, 'c').schemas, 's');
    for (const name of ['Payout', 'PayoutEntitlement', 'StatementLine', 'PartyStatement']) {
      const text = JSON.stringify(schemas[name]);
      expect([name, /"(iban|msisdn)"/.test(text)]).toEqual([name, false]);
    }
  });
});
