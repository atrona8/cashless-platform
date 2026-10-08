// Types du moteur d'écritures (SPECIFICATION §5.2 à §5.5, contracts/engine-command.md).
// Les constructeurs sont purs : commande + contexte → lignes. Aucun accès base ici.
import type { FeeRule } from './money';

/** Les 26 types de transaction, dans l'ordre de la contrainte CHECK de journal_transaction.type. */
export const TRANSACTION_TYPES = [
  'TOPUP',
  'TOPUP_CASH',
  'PROMO_CREDIT',
  'PROMO_EXPIRY',
  'ACTIVATION_FEE',
  'DEPOSIT_TAKEN',
  'DEPOSIT_REFUNDED',
  'DEPOSIT_FORFEITED',
  'PURCHASE',
  'REVERSAL',
  'PITCH_FEE',
  'OPERATOR_FEE',
  'PLATFORM_FEE',
  'ANOMALY_RESOLUTION',
  'CASH_CLOSE',
  'CASH_DEPOSIT',
  'PSP_SETTLEMENT',
  'CHARGEBACK',
  'WALLET_REFUND',
  'BREAKAGE',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
  'PAYOUT_FAILED',
  'ADJUSTMENT',
  'MERCHANT_DEBT_TRANSFER',
  'BREAKAGE_REVERSAL',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const SOURCES = ['ONLINE', 'OFFLINE_SYNC', 'EDGE_SYNC', 'PSP_WEBHOOK', 'BATCH', 'BACKOFFICE'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Désignation d'un compte, résolue plus tard en identifiant (port de résolution, WP09) :
 * un compte d'argent par son code (`A-PSP-WAVE`, `A-CAISSE-C1`, `A-BANQUE`…), ou un droit par sa fonction
 * (`purpose`) et son titulaire (partie, portefeuille ou participation).
 */
export type AccountRef =
  | { code: string }
  | { purpose: string; ownerPartyId?: string; walletId?: string; participationId?: string };

/** Ligne d'écriture : débit positif, crédit négatif. */
export interface Line {
  account: AccountRef;
  amount: bigint;
  memo?: string;
}

export interface Parties {
  platformId: string;
  operatorId: string;
  organizerId: string;
}

export type PspFeeBearer = 'ORGANIZER' | 'OPERATOR' | 'CUSTOMER';
export type LossBearer = 'ORGANIZER' | 'OPERATOR';
/** Assiette d'une règle de frais du prestataire : recharges payées de la période, ou nombre de supports activés. */
export type OperatorFeeBasis = 'TOPUP_AMOUNT' | 'PER_MEDIA';
export type BreakageDestination = 'ORGANIZER' | 'LEGAL_ACCOUNT' | 'NONE';

/** Configuration figée à la date de l'opération (fournie par ConfigResolver, WP09). Montants et taux en bigint. */
export interface ResolvedConfig {
  parties: Parties;
  configVersionId?: string;
  taxBps: bigint;
  commissions: Record<string, FeeRule>;
  pspFees: Record<string, FeeRule>;
  pspFeeBearer: PspFeeBearer;
  activationFee: FeeRule;
  refundFee: FeeRule;
  operatorFees: { basis: OperatorFeeBasis; rule: FeeRule }[];
  platformFee: FeeRule;
  breakageOrganizerBps: bigint;
  pitchFees: Record<string, bigint>;
  spendOrder: 'PROMO_FIRST' | 'PAID_FIRST';
  chargebackBearer: LossBearer;
  /** Contrat organisateur / prestataire (SPECIFICATION §4.4) : qui supporte écarts de caisse et pertes hors ligne. */
  cashDiffBearer: LossBearer;
  offlineLossBearer: LossBearer;
  /** Profil de législation : destination de la casse (ADR-67). */
  breakageDestination: BreakageDestination;
}

/** Soldes d'un portefeuille en convention « positif = disponible » (convertis par le service). */
export interface WalletBalances {
  promo: bigint;
  paid: bigint;
}

export interface BuildContext {
  config: ResolvedConfig;
  balances?: WalletBalances;
  /** Lignes de la transaction contre-passée (REVERSAL). */
  original?: readonly Line[];
}

/** Champs communs d'une commande d'écriture (contracts/engine-command.md) ; `payload` propre à chaque type. */
export interface LedgerCommand<T extends TransactionType = TransactionType, P = unknown> {
  type: T;
  idempotencyKey: string;
  occurredAt: Date;
  source: Source;
  ledgerId: string;
  eventId?: string;
  currency: string;
  payload: P;
  deviceId?: string;
  mediaId?: string;
  reversesId?: string;
  createdBy?: string;
  approvedBy?: string;
  metadata?: Record<string, unknown>;
}

export type BuildErrorCode = 'VALIDATION_FAILED' | 'INSUFFICIENT_FUNDS';

/** Commande incohérente pour son constructeur (montant ≤ 0, portefeuille manquant…). */
export class BuildError extends Error {
  constructor(
    readonly code: BuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}

// ------------------------------------------------------------------ fabriques de références de comptes

export const money = (code: string): AccountRef => ({ code });
export const wallet = (walletId: string, kind: 'P' | 'X'): AccountRef => ({
  purpose: kind === 'P' ? 'WALLET_PAID' : 'WALLET_PROMO',
  walletId,
});
export const merchant = (participationId: string): AccountRef => ({ purpose: 'MERCHANT', participationId });
export const suspense = (): AccountRef => ({ purpose: 'SUSPENSE' });
export const payoutPending = (): AccountRef => ({ purpose: 'PAYOUT_PENDING' });
/** Espèces dues au client (ADR-63), tenues par portefeuille. */
export const cashDue = (walletId: string): AccountRef => ({ purpose: 'CUSTOMER_CASH_DUE', walletId });
export const legalBreakage = (): AccountRef => ({ purpose: 'LEGAL_BREAKAGE' });

/** Comptes des parties du grand livre (organisateur, prestataire, plateforme), titulaire pris dans la configuration. */
export function partyAccounts({ parties }: Pick<ResolvedConfig, 'parties'>) {
  return {
    org: (purpose: string): AccountRef => ({ purpose, ownerPartyId: parties.organizerId }),
    ope: (purpose: string): AccountRef => ({ purpose, ownerPartyId: parties.operatorId }),
    plt: (purpose: string): AccountRef => ({ purpose, ownerPartyId: parties.platformId }),
  };
}
