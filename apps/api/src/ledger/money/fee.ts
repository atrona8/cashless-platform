// Frais : arrondi(base × taux) + fixe, puis bornes (fee de moteur_ecritures_reference.py).
import { BPS_SCALE, roundDiv } from './rounding';

export interface FeeRule {
  rateBps?: bigint;
  fixed?: bigint;
  min?: bigint | null;
  max?: bigint | null;
}

/** Le minimum s'applique avant le maximum, comme dans l'implémentation de référence. */
export function fee(base: bigint, rule: FeeRule = {}): bigint {
  let f = roundDiv(base * (rule.rateBps ?? 0n), BPS_SCALE) + (rule.fixed ?? 0n);
  if (rule.min !== undefined && rule.min !== null && f < rule.min) f = rule.min;
  if (rule.max !== undefined && rule.max !== null && f > rule.max) f = rule.max;
  return f;
}
