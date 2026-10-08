// Types acceptés selon le statut de l'événement (SPECIFICATION §12.1, contracts/status-type-matrix.md).
// Le moteur refuse VALIDATION_FAILED avant d'appeler la base ; la base applique en plus le statut du grand livre.
import type { Source, TransactionType } from './types';

export const EVENT_STATUSES = ['DRAFT', 'LIVE', 'CLOSING', 'RECONCILING', 'SETTLING', 'REFUND_WINDOW', 'CLOSED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type LedgerStatus = 'OPEN' | 'CLOSING' | 'LOCKED';

export interface StatusCheckInput {
  eventStatus: EventStatus;
  ledgerStatus: LedgerStatus;
  type: TransactionType;
  source: Source;
  /** Fonctions (`purpose`) des comptes débités par l'écriture. */
  debitPurposes?: readonly string[];
  /** Variante de la commande : `PRELOAD` (PROMO_CREDIT), `REGULARIZATION` (OPERATOR_FEE)… */
  variant?: string;
  /** Mode de caution de l'événement : `FROM_BALANCE` (C) ou `SEPARATE` (D). */
  depositMode?: 'FROM_BALANCE' | 'SEPARATE';
}

export type StatusCheck = { ok: true } | { ok: false; reason: string };

/** Condition d'une cellule acceptée ; `true` = sans condition. */
type Rule =
  | true
  | {
      sources?: readonly Source[];
      variant?: string;
      depositMode?: 'SEPARATE';
      debitPurpose?: string;
    };

const SYNC: readonly Source[] = ['OFFLINE_SYNC', 'EDGE_SYNC'];
const ALL_TYPES_BUT_BREAKAGE: Partial<Record<TransactionType, Rule>> = Object.fromEntries(
  (
    [
      'TOPUP', 'TOPUP_CASH', 'PROMO_CREDIT', 'PROMO_EXPIRY', 'ACTIVATION_FEE', 'DEPOSIT_TAKEN', 'DEPOSIT_REFUNDED',
      'DEPOSIT_FORFEITED', 'PURCHASE', 'REVERSAL', 'PITCH_FEE', 'OPERATOR_FEE', 'PLATFORM_FEE', 'ANOMALY_RESOLUTION',
      'CASH_CLOSE', 'CASH_DEPOSIT', 'PSP_SETTLEMENT', 'CHARGEBACK', 'WALLET_REFUND', 'PAYOUT_INITIATED',
      'PAYOUT_CONFIRMED', 'PAYOUT_FAILED', 'ADJUSTMENT', 'MERCHANT_DEBT_TRANSFER', 'BREAKAGE_REVERSAL',
    ] as const
  ).map((type) => [type, true]),
);

/** Matrice par statut de l'événement ; `CLOSED` se lit selon le statut du grand livre (voir `matrixFor`). */
const MATRIX: Record<Exclude<EventStatus, 'CLOSED'>, Partial<Record<TransactionType, Rule>>> = {
  DRAFT: {
    PROMO_CREDIT: { variant: 'PRELOAD' },
    DEPOSIT_TAKEN: { depositMode: 'SEPARATE' },
    DEPOSIT_REFUNDED: { depositMode: 'SEPARATE' },
  },
  LIVE: ALL_TYPES_BUT_BREAKAGE,
  CLOSING: {
    PURCHASE: { sources: SYNC },
    TOPUP_CASH: { sources: SYNC },
    DEPOSIT_TAKEN: { sources: SYNC },
    TOPUP: { sources: ['PSP_WEBHOOK'] },
    REVERSAL: true,
    CASH_CLOSE: true,
    DEPOSIT_REFUNDED: true,
    WALLET_REFUND: true,
    PROMO_EXPIRY: true,
    CHARGEBACK: true,
  },
  RECONCILING: {
    PURCHASE: { sources: SYNC },
    TOPUP_CASH: { sources: SYNC },
    DEPOSIT_TAKEN: { sources: SYNC },
    // « les synchronisations et leurs REVERSAL » : seulement les annulations synchronisées.
    REVERSAL: { sources: SYNC },
    CASH_CLOSE: true,
    CASH_DEPOSIT: true,
    PSP_SETTLEMENT: true,
    ANOMALY_RESOLUTION: true,
    ADJUSTMENT: true,
    WALLET_REFUND: true,
    DEPOSIT_REFUNDED: true,
    PROMO_EXPIRY: true,
    CHARGEBACK: true,
  },
  SETTLING: {
    PITCH_FEE: true,
    MERCHANT_DEBT_TRANSFER: true,
    OPERATOR_FEE: true,
    PLATFORM_FEE: true,
    PAYOUT_INITIATED: true,
    PAYOUT_CONFIRMED: true,
    PAYOUT_FAILED: true,
    WALLET_REFUND: true,
    DEPOSIT_REFUNDED: true,
    PROMO_EXPIRY: true,
    CHARGEBACK: true,
    ADJUSTMENT: true,
  },
  REFUND_WINDOW: {
    WALLET_REFUND: true,
    DEPOSIT_REFUNDED: true,
    PROMO_EXPIRY: true,
    CHARGEBACK: true,
    BREAKAGE: true,
    DEPOSIT_FORFEITED: true,
    OPERATOR_FEE: { variant: 'REGULARIZATION' },
    PAYOUT_INITIATED: true,
    PAYOUT_CONFIRMED: true,
    PAYOUT_FAILED: true,
    ADJUSTMENT: true,
  },
};

/** `CLOSED`, grand livre encore `CLOSING` (soldes restants tolérés). */
const CLOSED_WITH_BALANCES: Partial<Record<TransactionType, Rule>> = {
  WALLET_REFUND: true,
  // Seuls les versements depuis L-LEGAL-CASSE sont initiés ; confirmer ou constater l'échec d'un versement en cours
  // débite L-VERS-ENCOURS, pas le compte légal (sinon le versement légal ne pourrait jamais aboutir).
  PAYOUT_INITIATED: { debitPurpose: 'LEGAL_BREAKAGE' },
  PAYOUT_CONFIRMED: true,
  PAYOUT_FAILED: true,
  // §12.1 : une contestation « reçue entre CLOSED et le verrouillage est écrite normalement ».
  CHARGEBACK: true,
};

/** `CLOSED`, grand livre `LOCKED` : réclamations tardives seulement, à deux, en back-office. */
const CLOSED_LOCKED: Partial<Record<TransactionType, Rule>> = {
  BREAKAGE_REVERSAL: { sources: ['BACKOFFICE'] },
  ADJUSTMENT: { sources: ['BACKOFFICE'] },
  WALLET_REFUND: { sources: ['BACKOFFICE'] },
  CHARGEBACK: { sources: ['BACKOFFICE'] },
};

function matrixFor(eventStatus: EventStatus, ledgerStatus: LedgerStatus): Partial<Record<TransactionType, Rule>> {
  if (eventStatus !== 'CLOSED') return MATRIX[eventStatus];
  return ledgerStatus === 'LOCKED' ? CLOSED_LOCKED : CLOSED_WITH_BALANCES;
}

export function isAccepted(input: StatusCheckInput): StatusCheck {
  const { eventStatus, ledgerStatus, type, source } = input;
  const where = `événement ${eventStatus}${eventStatus === 'CLOSED' ? ` (grand livre ${ledgerStatus})` : ''}`;
  const rule = matrixFor(eventStatus, ledgerStatus)[type];
  if (!rule) return { ok: false, reason: `${type} non accepté : ${where}` };
  if (rule === true) return { ok: true };
  if (rule.sources && !rule.sources.includes(source)) {
    return { ok: false, reason: `${type} accepté seulement en ${rule.sources.join(' ou ')} : ${where}` };
  }
  if (rule.variant && input.variant !== rule.variant) {
    return { ok: false, reason: `${type} accepté seulement en variante ${rule.variant} : ${where}` };
  }
  if (rule.depositMode && input.depositMode !== rule.depositMode) {
    return { ok: false, reason: `${type} accepté seulement en caution ${rule.depositMode} : ${where}` };
  }
  if (rule.debitPurpose && !input.debitPurposes?.includes(rule.debitPurpose)) {
    return { ok: false, reason: `${type} accepté seulement au débit de ${rule.debitPurpose} : ${where}` };
  }
  return { ok: true };
}
