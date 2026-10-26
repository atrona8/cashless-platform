// Unitaires : bornes des corps du back-office du catalogue (mission 5b, lot WP10, T047 ; FR-007 ;
// openapi.yaml `CatalogCategoryCreate`, `CatalogItemCreate`, `CatalogItemUpdate`, `CatalogPolicy`)
// et
// règle d'accès (`catalogAccess`). Refus : 422 VALIDATION_FAILED avec `violations` ; corps non
// objet :
// 400.
import {
  parseCategoryCreate,
  parseCategoryUpdate,
  parseItemCreate,
  parseItemUpdate,
  parsePolicy,
  parseVersionNumber,
  type CatalogViolation,
} from '../../../src/catalog/catalog.dto';
import { catalogAccess, type PosScope } from '../../../src/catalog/catalog.service';
import { ProblemException } from '../../../src/errors/problem';
import type { Assignment } from '../../../src/identity/principal';

const ITEM = { label_fr: 'Bissap', label_en: 'Bissap', unit_price: 1000, vat_rate_bps: 1800 };

/** Problème levé par `fn` (échec du test sinon). */
function problemOf(fn: () => unknown): ProblemException {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error('aucun refus');
}

const violations = (fn: () => unknown): CatalogViolation[] => {
  const problem = problemOf(fn);
  expect(problem.code).toBe('VALIDATION_FAILED');
  expect(problem.status).toBe(422);
  return problem.extensions!.violations as CatalogViolation[];
};
const fields = (fn: () => unknown) => violations(fn).map((v) => `${v.field}:${v.rule}`);

describe('corps du catalogue : bornes (T047)', () => {
  it('article valide : prix lu en bigint, libellés rognés', () => {
    const item = parseItemCreate({ ...ITEM, label_fr: '  Bissap 33 cl  ' }, 'fr');
    expect(item).toEqual({
      labelFr: 'Bissap 33 cl',
      labelEn: 'Bissap',
      unitPrice: 1000n,
      vatRateBps: 1800,
    });
    expect(typeof item.unitPrice).toBe('bigint');
  });

  it.each([
    ['prix 0', 0],
    ['prix négatif', -1],
    ['prix décimal', 10.5],
    ['prix en texte', '1000'],
    ['prix au-delà de 2^53 − 1 (précision perdue)', 2 ** 53],
    ['prix 9007199254740993 (arrondi par JSON)', JSON.parse('9007199254740993') as number],
    ['prix 1e30', 1e30],
  ])('%s → 422 unit_price', (_name, price) => {
    expect(fields(() => parseItemCreate({ ...ITEM, unit_price: price }, 'fr'))).toEqual([
      'unit_price:catalog_admin.unit_price',
    ]);
  });

  it('prix 2^53 − 1 accepté, lu exactement', () => {
    expect(parseItemCreate({ ...ITEM, unit_price: Number.MAX_SAFE_INTEGER }, 'fr').unitPrice).toBe(
      9007199254740991n,
    );
    expect(parseItemCreate({ ...ITEM, unit_price: 1 }, 'fr').unitPrice).toBe(1n);
  });

  it.each([
    ['taux −1', -1],
    ['taux 10 001', 10_001],
    ['taux décimal', 18.5],
  ])('%s → 422 vat_rate_bps', (_name, rate) => {
    expect(fields(() => parseItemCreate({ ...ITEM, vat_rate_bps: rate }, 'fr'))).toEqual([
      'vat_rate_bps:catalog_admin.vat_rate_bps',
    ]);
  });

  it('taux 0 et 10 000 acceptés', () => {
    expect(parseItemCreate({ ...ITEM, vat_rate_bps: 0 }, 'fr').vatRateBps).toBe(0);
    expect(parseItemCreate({ ...ITEM, vat_rate_bps: 10_000 }, 'fr').vatRateBps).toBe(10_000);
  });

  it.each([
    ['vide', ''],
    ['espaces seuls', '   '],
    ['121 caractères', 'x'.repeat(121)],
    ['121 points de code (accents)', 'é'.repeat(121)],
    ['nombre', 12],
  ])('libellé %s → 422 label', (_name, label) => {
    expect(
      fields(() => parseCategoryCreate({ label_fr: label, label_en: 'Drinks' }, 'fr')),
    ).toEqual(['label_fr:catalog_admin.label']);
    expect(fields(() => parseItemCreate({ ...ITEM, label_en: label }, 'fr'))).toEqual([
      'label_en:catalog_admin.label',
    ]);
  });

  it('libellé de 120 caractères (et 120 emojis) accepté', () => {
    expect(parseCategoryCreate({ label_fr: 'x'.repeat(120), label_en: 'y' }, 'fr').labelFr).toBe(
      'x'.repeat(120),
    );
    expect(parseCategoryCreate({ label_fr: '🍺'.repeat(120), label_en: 'y' }, 'fr').labelFr).toBe(
      '🍺'.repeat(120),
    );
  });

  it('champs manquants, inconnus et plusieurs refus : toutes les violations', () => {
    expect(fields(() => parseItemCreate({ operator_id: 'x' }, 'fr'))).toEqual([
      'operator_id:catalog_admin.unknown_field',
      'label_fr:catalog_admin.required',
      'label_en:catalog_admin.required',
      'unit_price:catalog_admin.required',
      'vat_rate_bps:catalog_admin.required',
    ]);
    const all = violations(() =>
      parseItemCreate({ ...ITEM, unit_price: 0, vat_rate_bps: -1 }, 'en'),
    );
    expect(all).toEqual([
      {
        field: 'unit_price',
        rule: 'catalog_admin.unit_price',
        requested: 0,
        limit: [1, Number.MAX_SAFE_INTEGER],
        source: 'contract',
      },
      {
        field: 'vat_rate_bps',
        rule: 'catalog_admin.vat_rate_bps',
        requested: -1,
        limit: [0, 10_000],
        source: 'contract',
      },
    ]);
  });

  it('détail dans la langue demandée', () => {
    const fr = problemOf(() => parseItemCreate({ ...ITEM, unit_price: 0 }, 'fr'));
    const en = problemOf(() => parseItemCreate({ ...ITEM, unit_price: 0 }, 'en'));
    expect(fr.detail).toContain('unités mineures');
    expect(en.detail).toContain('minor units');
  });

  it('rang : entier ≥ 0 ; facultatif à la création', () => {
    expect(parseCategoryCreate({ label_fr: 'a', label_en: 'b' }, 'fr').position).toBeUndefined();
    expect(parseCategoryCreate({ label_fr: 'a', label_en: 'b', position: 0 }, 'fr').position).toBe(
      0,
    );
    expect(
      fields(() => parseCategoryCreate({ label_fr: 'a', label_en: 'b', position: -1 }, 'fr')),
    ).toEqual(['position:catalog_admin.position']);
    expect(
      fields(() => parseCategoryCreate({ label_fr: 'a', label_en: 'b', position: 2 ** 31 }, 'fr')),
    ).toEqual(['position:catalog_admin.position']);
  });

  it('modification : au moins un champ ; active booléen ; catégorie en UUID', () => {
    expect(fields(() => parseCategoryUpdate({}, 'fr'))).toEqual([
      'body:catalog_admin.min_properties',
    ]);
    expect(fields(() => parseItemUpdate({}, 'fr'))).toEqual(['body:catalog_admin.min_properties']);
    expect(fields(() => parseCategoryUpdate({ active: 'false' }, 'fr'))).toEqual([
      'active:catalog_admin.boolean',
    ]);
    expect(fields(() => parseItemUpdate({ category_id: 'pas-un-uuid' }, 'fr'))).toEqual([
      'category_id:catalog_admin.uuid',
    ]);
    expect(parseItemUpdate({ active: false }, 'fr')).toEqual({
      categoryId: undefined,
      labelFr: undefined,
      labelEn: undefined,
      unitPrice: undefined,
      vatRateBps: undefined,
      active: false,
    });
    expect(fields(() => parseItemUpdate({ unit_price: 0 }, 'fr'))).toEqual([
      'unit_price:catalog_admin.unit_price',
    ]);
  });

  it('délégation : booléen obligatoire ; pos_id (lecture seule) ignoré', () => {
    expect(parsePolicy({ merchant_manages: true, pos_id: 'x' }, 'fr')).toEqual({
      merchantManages: true,
    });
    expect(fields(() => parsePolicy({}, 'fr'))).toEqual([
      'merchant_manages:catalog_admin.required',
    ]);
    expect(fields(() => parsePolicy({ merchant_manages: 1 }, 'fr'))).toEqual([
      'merchant_manages:catalog_admin.boolean',
    ]);
  });

  it('corps non objet → 400 ; version du chemin invalide → 400', () => {
    for (const raw of [null, [], 'texte', 3]) {
      const problem = problemOf(() => parseItemCreate(raw, 'fr'));
      expect([problem.code, problem.status]).toEqual(['VALIDATION_FAILED', 400]);
    }
    for (const raw of ['0', '-1', '1.5', 'abc', '2147483648', '01']) {
      expect(problemOf(() => parseVersionNumber(raw)).status).toBe(400);
    }
    expect(parseVersionNumber('3')).toBe(3);
  });
});

describe('catalogAccess : portée et délégation', () => {
  const operatorId = 'op-a';
  const scope = (merchantManages: boolean): PosScope => ({
    posId: 'pos',
    organizerId: 'org-a',
    merchantId: 'm-a',
    merchantManages,
  });
  const actor = (...assignments: Assignment[]) => ({
    operatorId,
    principal: { userId: 'u', operatorId, assignments, issuer: 'i', subject: 's' },
  });
  const code = (fn: () => unknown) => problemOf(fn).code;

  const opAdmin: Assignment = {
    role: 'OPERATOR_ADMIN',
    scopeType: 'OPERATOR',
    scopeId: operatorId,
  };
  const orgAdmin: Assignment = {
    role: 'ORGANIZER_ADMIN',
    scopeType: 'ORGANIZER',
    scopeId: 'org-a',
  };
  const otherOrg: Assignment = {
    role: 'ORGANIZER_ADMIN',
    scopeType: 'ORGANIZER',
    scopeId: 'org-b',
  };
  const merchant: Assignment = { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: 'm-a' };
  const otherMerchant: Assignment = {
    role: 'MERCHANT_ADMIN',
    scopeType: 'MERCHANT',
    scopeId: 'm-b',
  };

  it('prestataire et organisateur : lecture, gestion et délégation', () => {
    for (const a of [opAdmin, orgAdmin]) {
      for (const need of ['read', 'manage', 'policy'] as const) {
        expect(catalogAccess(actor(a), scope(false), need)).toBe(a.role);
      }
    }
  });

  it('commerçant : lit ; gère seulement avec délégation (sinon 403) ; jamais la délégation', () => {
    expect(catalogAccess(actor(merchant), scope(false), 'read')).toBe('MERCHANT_ADMIN');
    expect(code(() => catalogAccess(actor(merchant), scope(false), 'manage'))).toBe('FORBIDDEN');
    expect(catalogAccess(actor(merchant), scope(true), 'manage')).toBe('MERCHANT_ADMIN');
    expect(code(() => catalogAccess(actor(merchant), scope(true), 'policy'))).toBe('FORBIDDEN');
  });

  it('hors portée : 404 neutre (autre organisateur, autre commerçant, OPERATOR_ADMIN d’un autre prestataire)', () => {
    const foreignOp: Assignment = {
      role: 'OPERATOR_ADMIN',
      scopeType: 'OPERATOR',
      scopeId: 'op-b',
    };
    for (const a of [otherOrg, otherMerchant, foreignOp]) {
      for (const need of ['read', 'manage', 'policy'] as const) {
        expect(code(() => catalogAccess(actor(a), scope(true), need))).toBe('NOT_FOUND');
      }
    }
  });
});
