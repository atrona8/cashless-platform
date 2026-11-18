// Étapes de clôture d'un événement (mission 9b, SPECIFICATION §12.1 ; contrat : ClosingStep, ClosingStepState,
// ClosingStepPreview, ClosingStepResult). Les sept étapes, leur ordre et leur phase sont ceux de `closing_step`
// (migration 0084) : une seule liste, ici, pour l'API.
import { invalid } from '../organization/platform/platform.dto';

export const CLOSING_STEPS = [
  'PITCH_FEES',
  'OPERATOR_FEE',
  'PLATFORM_FEE',
  'OPERATOR_FEE_REGULARIZATION',
  'BREAKAGE',
  'DEPOSIT_FORFEIT',
  'PROMO_EXPIRY',
] as const;
export type ClosingStep = (typeof CLOSING_STEPS)[number];

/** Phase d'une étape : `SETTLING` (étapes 1 à 3) ou `REFUND_WINDOW` (étapes 4 à 7, après l'échéance). */
export type ClosingPhase = 'SETTLING' | 'REFUND_WINDOW';

export const phaseOf = (step: ClosingStep): ClosingPhase =>
  CLOSING_STEPS.indexOf(step) < 3 ? 'SETTLING' : 'REFUND_WINDOW';

/** Étape précédente dans l'ordre de clôture ; `undefined` pour la première. */
export const previousOf = (step: ClosingStep): ClosingStep | undefined =>
  CLOSING_STEPS[CLOSING_STEPS.indexOf(step) - 1];

/** `step` du chemin : hors des sept valeurs, `400`. */
export function parseStep(value: string): ClosingStep {
  if (!(CLOSING_STEPS as readonly string[]).includes(value)) {
    throw invalid(`step : étape de clôture inconnue (${CLOSING_STEPS.join(', ')}).`);
  }
  return value as ClosingStep;
}

/** Montant entier du contrat (`int64`) : un nombre JSON, jamais un flottant ; hors des entiers sûrs, refusé. */
export function amountJson(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`montant hors des entiers sûrs : ${value}`);
  return n;
}

export interface PreviewLineDto {
  party_id: string;
  label?: string;
  amount: number;
  reference?: string | null;
}

export interface ClosingStepStateDto {
  step: ClosingStep;
  status: 'TODO' | 'DONE' | 'NOT_APPLICABLE';
  done_by: string | null;
  done_at: string | null;
  transaction_ids: string[];
  summary: Record<string, unknown>;
}

export interface ClosingStepPreviewDto {
  event_id: string;
  step: ClosingStep;
  currency: string;
  applicable: boolean;
  lines: PreviewLineDto[];
  total: number;
}

export interface ClosingStepResultDto {
  event_id: string;
  step: ClosingStep;
  status: 'DONE' | 'NOT_APPLICABLE';
  transaction_ids: string[];
  summary: Record<string, unknown>;
  done_by: string;
  done_at: string;
}
