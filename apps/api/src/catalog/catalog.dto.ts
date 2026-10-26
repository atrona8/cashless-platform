// Corps et réponses du back-office du catalogue (openapi.yaml, tag Catalogue :
// `CatalogCategoryCreate`,
// `CatalogCategoryUpdate`, `CatalogItemCreate`, `CatalogItemUpdate`, `CatalogPolicy` ; mission 5b,
// lot WP10,
// FR-007). Validation avant écriture : corps qui n'est pas un objet JSON → 400 ; tout champ mal
// formé,
// hors bornes, inconnu ou manquant → `422 VALIDATION_FAILED`, extension `violations[]` (une entrée
// par
// champ refusé). La base revérifie les mêmes bornes (0032 : CL001) : ce contrôle ne fait que la
// précéder.
//
// Bornes : libellés FR et EN de 1 à 120 caractères (comptés en points de code après rognage, comme
// `length(btrim(…))` de la base) ; `unit_price` entier > 0 en unités mineures, lu en `bigint` et
// refusé
// au-delà de 2^53 − 1 (un nombre JSON plus grand a déjà perdu sa précision : jamais d'arrondi
// silencieux) ;
// `vat_rate_bps` entier de 0 à 10 000 ; `position` entier de 0 à 2^31 − 1 (colonne `int`) ;
// `active`
// booléen. Pas de suppression : la désactivation passe par `active: false`.
import type { components } from '@cashless/contracts';
import { ProblemException } from '../errors/problem';
import type { Language } from '../http/language';

export type CatalogCategoryBody = components['schemas']['CatalogCategory'];
export type CatalogItemAdminBody = components['schemas']['CatalogItemAdmin'];
export type CatalogBody = components['schemas']['Catalog'];
export type CatalogVersionBody = components['schemas']['CatalogVersion'];
export type CatalogPolicyBody = components['schemas']['CatalogPolicy'];
export type CatalogCategoryResultBody = components['schemas']['CatalogCategoryResult'];
export type CatalogItemResultBody = components['schemas']['CatalogItemResult'];

export const LABEL_MAX = 120;
export const VAT_MAX = 10_000;
export const POSITION_MAX = 2_147_483_647;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Champ refusé (même forme que les refus de bornes de la configuration, `Problem.violations`). */
export interface CatalogViolation {
  field: string;
  /** Identifiant stable de la règle : `catalog_admin.<règle>`. */
  rule: string;
  requested: unknown;
  limit: unknown;
  source: 'contract';
}

export interface CategoryCreate {
  labelFr: string;
  labelEn: string;
  /** Absent : après la dernière catégorie (calculé par le service). */
  position?: number;
}

export interface CategoryUpdate {
  labelFr?: string;
  labelEn?: string;
  position?: number;
  active?: boolean;
}

export interface ItemCreate {
  labelFr: string;
  labelEn: string;
  unitPrice: bigint;
  vatRateBps: number;
}

export interface ItemUpdate {
  categoryId?: string;
  labelFr?: string;
  labelEn?: string;
  unitPrice?: bigint;
  vatRateBps?: number;
  active?: boolean;
}

export interface PolicySet {
  merchantManages: boolean;
}

const MESSAGES: Record<string, Record<Language, (field: string, limit: unknown) => string>> = {
  required: {
    fr: (f) => `${f} : champ obligatoire.`,
    en: (f) => `${f}: required field.`,
  },
  unknown_field: {
    fr: (f) => `${f} : champ inconnu.`,
    en: (f) => `${f}: unknown field.`,
  },
  min_properties: {
    fr: () => 'Au moins un champ à modifier.',
    en: () => 'At least one field to change.',
  },
  label: {
    fr: (f, l) => `${f} : texte non vide de ${String(l)} caractères au plus.`,
    en: (f, l) => `${f}: non-empty text of at most ${String(l)} characters.`,
  },
  unit_price: {
    fr: (f) => `${f} : entier strictement positif en unités mineures (au plus 2^53 − 1).`,
    en: (f) => `${f}: strictly positive integer in minor units (at most 2^53 − 1).`,
  },
  vat_rate_bps: {
    fr: (f) => `${f} : entier de 0 à 10 000 points de base.`,
    en: (f) => `${f}: integer from 0 to 10,000 basis points.`,
  },
  position: {
    fr: (f) => `${f} : entier positif ou nul.`,
    en: (f) => `${f}: non-negative integer.`,
  },
  boolean: {
    fr: (f) => `${f} : booléen attendu.`,
    en: (f) => `${f}: boolean expected.`,
  },
  uuid: {
    fr: (f) => `${f} : identifiant (UUID) attendu.`,
    en: (f) => `${f}: identifier (UUID) expected.`,
  },
};

/** Problème 422 : le détail cite le premier champ refusé ; tous sont joints dans `violations`. */
export function catalogProblem(
  violations: CatalogViolation[],
  language: Language,
): ProblemException {
  const first = violations[0]!;
  const rule = first.rule.replace(/^catalog_admin\./, '');
  const message = MESSAGES[rule]?.[language](first.field, first.limit) ?? first.field;
  return new ProblemException('VALIDATION_FAILED', {
    status: 422,
    detail: message,
    extensions: { violations },
  });
}

/** Collecteur de violations d'un corps. */
class Checker {
  readonly violations: CatalogViolation[] = [];

  constructor(readonly body: Record<string, unknown>) {}

  private refuse(field: string, rule: string, requested: unknown, limit: unknown): undefined {
    this.violations.push({
      field,
      rule: `catalog_admin.${rule}`,
      requested: printable(requested),
      limit,
      source: 'contract',
    });
    return undefined;
  }

  only(allowed: readonly string[]): void {
    for (const key of Object.keys(this.body)) {
      if (!allowed.includes(key)) this.refuse(key, 'unknown_field', null, allowed);
    }
  }

  atLeastOne(fields: readonly string[]): void {
    if (!fields.some((f) => this.body[f] !== undefined)) {
      this.refuse('body', 'min_properties', null, 1);
    }
  }

  private missing(name: string, required: boolean): boolean {
    if (this.body[name] !== undefined) return false;
    if (required) this.refuse(name, 'required', null, null);
    return true;
  }

  label(name: string, required: boolean): string | undefined {
    if (this.missing(name, required)) return undefined;
    const value = this.body[name];
    if (typeof value !== 'string') return this.refuse(name, 'label', value, LABEL_MAX);
    const trimmed = value.trim();
    const length = [...trimmed].length;
    if (length < 1 || length > LABEL_MAX) return this.refuse(name, 'label', value, LABEL_MAX);
    return trimmed;
  }

  unitPrice(name: string, required: boolean): bigint | undefined {
    if (this.missing(name, required)) return undefined;
    const value = this.body[name];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      return this.refuse(name, 'unit_price', value, [1, Number.MAX_SAFE_INTEGER]);
    }
    return BigInt(value);
  }

  int(name: string, required: boolean, rule: string, min: number, max: number): number | undefined {
    if (this.missing(name, required)) return undefined;
    const value = this.body[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return this.refuse(name, rule, value, [min, max]);
    }
    return value;
  }

  bool(name: string, required: boolean): boolean | undefined {
    if (this.missing(name, required)) return undefined;
    const value = this.body[name];
    if (typeof value !== 'boolean') return this.refuse(name, 'boolean', value, null);
    return value;
  }

  uuid(name: string, required: boolean): string | undefined {
    if (this.missing(name, required)) return undefined;
    const value = this.body[name];
    if (typeof value !== 'string' || !UUID.test(value))
      return this.refuse(name, 'uuid', value, null);
    return value.toLowerCase();
  }

  done(language: Language): void {
    if (this.violations.length > 0) throw catalogProblem(this.violations, language);
  }
}

/** Valeur demandée, rendue lisible dans le problème (texte court, jamais un objet entier). */
function printable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return typeof value;
}

function objectBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProblemException('VALIDATION_FAILED', { status: 400, detail: 'Corps JSON attendu.' });
  }
  return raw as Record<string, unknown>;
}

const CATEGORY_CREATE = ['label_fr', 'label_en', 'position'] as const;
const CATEGORY_UPDATE = ['label_fr', 'label_en', 'position', 'active'] as const;
const ITEM_CREATE = ['label_fr', 'label_en', 'unit_price', 'vat_rate_bps'] as const;
const ITEM_UPDATE = [
  'category_id',
  'label_fr',
  'label_en',
  'unit_price',
  'vat_rate_bps',
  'active',
] as const;

export function parseCategoryCreate(raw: unknown, language: Language): CategoryCreate {
  const c = new Checker(objectBody(raw));
  c.only(CATEGORY_CREATE);
  const labelFr = c.label('label_fr', true);
  const labelEn = c.label('label_en', true);
  const position = c.int('position', false, 'position', 0, POSITION_MAX);
  c.done(language);
  return { labelFr: labelFr!, labelEn: labelEn!, position };
}

export function parseCategoryUpdate(raw: unknown, language: Language): CategoryUpdate {
  const c = new Checker(objectBody(raw));
  c.only(CATEGORY_UPDATE);
  c.atLeastOne(CATEGORY_UPDATE);
  const update: CategoryUpdate = {
    labelFr: c.label('label_fr', false),
    labelEn: c.label('label_en', false),
    position: c.int('position', false, 'position', 0, POSITION_MAX),
    active: c.bool('active', false),
  };
  c.done(language);
  return update;
}

export function parseItemCreate(raw: unknown, language: Language): ItemCreate {
  const c = new Checker(objectBody(raw));
  c.only(ITEM_CREATE);
  const labelFr = c.label('label_fr', true);
  const labelEn = c.label('label_en', true);
  const unitPrice = c.unitPrice('unit_price', true);
  const vatRateBps = c.int('vat_rate_bps', true, 'vat_rate_bps', 0, VAT_MAX);
  c.done(language);
  return { labelFr: labelFr!, labelEn: labelEn!, unitPrice: unitPrice!, vatRateBps: vatRateBps! };
}

export function parseItemUpdate(raw: unknown, language: Language): ItemUpdate {
  const c = new Checker(objectBody(raw));
  c.only(ITEM_UPDATE);
  c.atLeastOne(ITEM_UPDATE);
  const update: ItemUpdate = {
    categoryId: c.uuid('category_id', false),
    labelFr: c.label('label_fr', false),
    labelEn: c.label('label_en', false),
    unitPrice: c.unitPrice('unit_price', false),
    vatRateBps: c.int('vat_rate_bps', false, 'vat_rate_bps', 0, VAT_MAX),
    active: c.bool('active', false),
  };
  c.done(language);
  return update;
}

/** `CatalogPolicy` : `pos_id` est en lecture seule (contrat) ; reçu, il est ignoré (chemin). */
export function parsePolicy(raw: unknown, language: Language): PolicySet {
  const c = new Checker(objectBody(raw));
  c.only(['merchant_manages', 'pos_id']);
  const merchantManages = c.bool('merchant_manages', true);
  c.done(language);
  return { merchantManages: merchantManages! };
}

/** Numéro de version du chemin : entier de 1 à 2^31 − 1 ; sinon 400. */
export function parseVersionNumber(raw: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > POSITION_MAX) {
    throw new ProblemException('VALIDATION_FAILED', {
      status: 400,
      detail: 'version : entier de 1 à 2147483647 attendu.',
    });
  }
  return Number(raw);
}

// ------------------------------------------------------------------ Réponses

export interface CategoryRow {
  id: string;
  label_fr: string;
  label_en: string;
  position: number;
  active: boolean;
}

export interface ItemRow {
  id: string;
  category_id: string;
  label_fr: string;
  label_en: string;
  /** `bigint` lu en texte (jamais par un flottant de la base). */
  unit_price: string;
  vat_rate_bps: number;
  active: boolean;
}

export interface VersionItemRow {
  item_id: string;
  category_id: string;
  label_fr: string;
  label_en: string;
  unit_price: string;
  vat_rate_bps: number;
}

export const categoryDto = (row: CategoryRow): CatalogCategoryBody => ({
  category_id: row.id,
  label_fr: row.label_fr,
  label_en: row.label_en,
  position: row.position,
  active: row.active,
});

export const itemDto = (row: ItemRow): CatalogItemAdminBody => ({
  item_id: row.id,
  category_id: row.category_id,
  label_fr: row.label_fr,
  label_en: row.label_en,
  unit_price: Number(row.unit_price),
  vat_rate_bps: row.vat_rate_bps,
  active: row.active,
});

export const versionItemDto = (row: VersionItemRow): CatalogVersionBody['items'][number] => ({
  item_id: row.item_id,
  category_id: row.category_id,
  label_fr: row.label_fr,
  label_en: row.label_en,
  unit_price: Number(row.unit_price),
  vat_rate_bps: row.vat_rate_bps,
});
