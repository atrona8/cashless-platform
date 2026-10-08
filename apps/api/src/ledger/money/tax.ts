// Extraction de taxe d'un montant TTC (split_tax de moteur_ecritures_reference.py).
import { BPS_SCALE, roundDiv } from './rounding';

export interface TaxSplit {
  ht: bigint;
  tax: bigint;
}

/** Taxe arrondie, HT par différence : HT + taxe = TTC exactement. */
export function extractTax(ttc: bigint, taxBps: bigint): TaxSplit {
  const tax = roundDiv(ttc * taxBps, BPS_SCALE + taxBps);
  return { ht: ttc - tax, tax };
}

export interface TaxItem {
  beneficiary: string;
  taxBps: bigint;
  ttc: bigint;
}

export interface TaxGroup extends TaxItem, TaxSplit {}

/**
 * Dans une transaction, les montants TTC de même bénéficiaire et de même taux sont additionnés, puis la taxe est
 * extraite une seule fois sur la somme (cas 2 et 18). L'ordre de première apparition est conservé.
 */
export function groupForTax(items: readonly TaxItem[]): TaxGroup[] {
  const groups = new Map<string, TaxItem>();
  for (const item of items) {
    const key = `${item.beneficiary}\u0000${item.taxBps}`;
    const group = groups.get(key);
    if (group) group.ttc += item.ttc;
    else groups.set(key, { ...item });
  }
  return [...groups.values()].map((group) => ({ ...group, ...extractTax(group.ttc, group.taxBps) }));
}
