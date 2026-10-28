// Refus définitifs du moteur et de la base pour un crédit PSP (mission 6, lot WP11, T056 point 5 ; A4) : un
// refus connu devient une recharge `FAILED` et une anomalie portant l'argent à rendre, jamais un `500` en
// boucle. Fonction pure : le code du problème (`resolveProblem`) décide, jamais le texte d'un message.
import type { ProblemCode } from '@cashless/contracts';

/** Motifs acceptés par `fail_psp_topup` (migration 0038, `psp_topup_failure_reason`). */
export const FAILURE_REASONS = [
  'THREE_DS',
  'NO_FINGERPRINT',
  'CARD_DAILY_LIMIT',
  'LEDGER_STATUS',
  'WALLET_LIMIT',
  'MONTHLY_LIMIT',
  'WALLET_BLOCKED',
  'PERIOD_CLOSED',
  'DEBIT_AUTHORITY_EDGE',
  'FEES_EXCEED_AMOUNT',
  'ACCOUNT_INACTIVE',
  'PSP_FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export type AnomalyKind = 'PSP_TOPUP_NOT_CREDITED' | 'PSP_TOPUP_OVER_LIMIT';

export interface Refusal {
  reason: FailureReason;
  anomalyKind: AnomalyKind;
}

/** Frais calculés par le constructeur supérieurs ou égaux au montant : rien ne reste pour le portefeuille. */
export class FeesExceedAmount extends Error {
  constructor() {
    super('frais supérieurs ou égaux au montant de la recharge');
    this.name = 'FeesExceedAmount';
  }
}

/** Plafond par carte et par jour refusé par la base à la complétion (même verrou, même jour). */
export class CardDailyLimit extends Error {
  constructor() {
    super('plafond de la carte du jour dépassé');
    this.name = 'CardDailyLimit';
  }
}

const NOT_CREDITED = 'PSP_TOPUP_NOT_CREDITED';
const OVER_LIMIT = 'PSP_TOPUP_OVER_LIMIT';

const BY_PROBLEM: Partial<Record<ProblemCode, Refusal>> = {
  PERIOD_CLOSED: { reason: 'PERIOD_CLOSED', anomalyKind: NOT_CREDITED },
  DEBIT_AUTHORITY_EDGE: { reason: 'DEBIT_AUTHORITY_EDGE', anomalyKind: NOT_CREDITED },
  WALLET_BLOCKED: { reason: 'WALLET_BLOCKED', anomalyKind: NOT_CREDITED },
  WALLET_LIMIT_EXCEEDED: { reason: 'WALLET_LIMIT', anomalyKind: OVER_LIMIT },
  MONTHLY_TOPUP_LIMIT_EXCEEDED: { reason: 'MONTHLY_LIMIT', anomalyKind: OVER_LIMIT },
  EVENT_CLOSING: { reason: 'LEDGER_STATUS', anomalyKind: NOT_CREDITED },
  LEDGER_LOCKED: { reason: 'LEDGER_STATUS', anomalyKind: NOT_CREDITED },
  // Clé d'écriture déjà prise par un autre contenu (CL002) : aucune écriture de plus, argent à rendre.
  IDEMPOTENCY_KEY_REUSED: { reason: 'PSP_FAILED', anomalyKind: NOT_CREDITED },
};

/**
 * Refus définitif connu, ou `null` : toute autre erreur est inattendue et remonte (le travailleur de WP12
 * enregistre `RETRY`). `code` est le code de problème de l'erreur (`resolveProblem(error).code`).
 */
export function classifyRefusal(error: unknown, code: ProblemCode): Refusal | null {
  if (error instanceof FeesExceedAmount)
    return { reason: 'FEES_EXCEED_AMOUNT', anomalyKind: NOT_CREDITED };
  if (error instanceof CardDailyLimit)
    return { reason: 'CARD_DAILY_LIMIT', anomalyKind: OVER_LIMIT };
  return BY_PROBLEM[code] ?? null;
}
