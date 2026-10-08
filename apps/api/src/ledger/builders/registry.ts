// Registre : chacun des 26 types associé à son constructeur de lignes ou à sa fonction SQL déléguée
// (contracts/engine-command.md, « Types délégués à la base »). L'oubli d'un type est une erreur de compilation.
import { BuildError, type BuildContext, type LedgerCommand, type Line, type TransactionType } from '../types';
import {
  buildAdjustment,
  buildAnomalyResolution,
  buildBreakage,
  buildBreakageReversal,
  buildCashClose,
  buildCashDeposit,
  buildMerchantDebtTransfer,
  buildOperatorFee,
  buildPayoutConfirmed,
  buildPayoutFailed,
  buildPayoutInitiated,
  buildPitchFee,
  buildPlatformFee,
  buildPspSettlement,
  requireApprovers,
} from './closing';
import {
  buildActivationFee,
  buildChargeback,
  buildPromoCredit,
  buildPromoExpiry,
  buildPurchase,
  buildReversal,
  buildTopup,
  buildTopupCash,
  buildWalletRefund,
} from './festival';

export type DelegatedFunction = 'take_deposit' | 'refund_deposit' | 'forfeit_deposit' | 'preload_media' | 'refund_cash_due';

interface LinesEntry {
  kind: 'lines';
  // Syntaxe de méthode : chaque constructeur accepte sa propre forme de commande.
  build(command: LedgerCommand, ctx: BuildContext): Line[];
}
interface DelegatedEntry {
  kind: 'delegated';
  fn: DelegatedFunction;
}
/** Selon `payload.variant` : délégation à une fonction SQL, sinon constructeur de lignes. */
interface MixedEntry {
  kind: 'mixed';
  delegated: Record<string, DelegatedFunction>;
  build(command: LedgerCommand, ctx: BuildContext): Line[];
}
export type RegistryEntry = LinesEntry | DelegatedEntry | MixedEntry;

const lines = (build: LinesEntry['build']): LinesEntry => ({ kind: 'lines', build });
const delegated = (fn: DelegatedFunction): DelegatedEntry => ({ kind: 'delegated', fn });

export const BUILDERS = {
  TOPUP: lines(buildTopup),
  TOPUP_CASH: lines(buildTopupCash),
  PROMO_CREDIT: { kind: 'mixed', delegated: { PRELOAD: 'preload_media' }, build: buildPromoCredit },
  PROMO_EXPIRY: lines(buildPromoExpiry),
  ACTIVATION_FEE: lines(buildActivationFee),
  DEPOSIT_TAKEN: delegated('take_deposit'),
  DEPOSIT_REFUNDED: delegated('refund_deposit'),
  DEPOSIT_FORFEITED: delegated('forfeit_deposit'),
  PURCHASE: lines(buildPurchase),
  REVERSAL: lines(buildReversal),
  PITCH_FEE: lines(buildPitchFee),
  OPERATOR_FEE: lines(buildOperatorFee),
  PLATFORM_FEE: lines(buildPlatformFee),
  ANOMALY_RESOLUTION: lines(buildAnomalyResolution),
  CASH_CLOSE: lines(buildCashClose),
  CASH_DEPOSIT: lines(buildCashDeposit),
  PSP_SETTLEMENT: lines(buildPspSettlement),
  CHARGEBACK: lines(buildChargeback),
  WALLET_REFUND: { kind: 'mixed', delegated: { CASH_DUE: 'refund_cash_due' }, build: buildWalletRefund },
  BREAKAGE: lines(buildBreakage),
  PAYOUT_INITIATED: lines(buildPayoutInitiated),
  PAYOUT_CONFIRMED: lines(buildPayoutConfirmed),
  PAYOUT_FAILED: lines(buildPayoutFailed),
  ADJUSTMENT: lines(buildAdjustment),
  MERCHANT_DEBT_TRANSFER: lines(buildMerchantDebtTransfer),
  BREAKAGE_REVERSAL: lines(buildBreakageReversal),
} satisfies Record<TransactionType, RegistryEntry>;

/** Ce que le service doit faire d'une commande : écrire des lignes, ou appeler une fonction SQL. */
export type Plan = { kind: 'lines'; lines: Line[] } | { kind: 'delegated'; fn: DelegatedFunction };

function variantOf(command: LedgerCommand): string | undefined {
  const payload = command.payload as { variant?: unknown } | null | undefined;
  return typeof payload?.variant === 'string' ? payload.variant : undefined;
}

export function plan(command: LedgerCommand, ctx: BuildContext): Plan {
  const entry: RegistryEntry | undefined = (BUILDERS as Record<string, RegistryEntry>)[command.type];
  if (!entry) throw new BuildError('VALIDATION_FAILED', `type de transaction inconnu : ${command.type}`);
  // Toute écriture de back-office est validée à deux, quel que soit son type (contrainte de journal_transaction).
  if (command.source === 'BACKOFFICE') requireApprovers(command);
  if (entry.kind === 'delegated') return { kind: 'delegated', fn: entry.fn };
  if (entry.kind === 'mixed') {
    const variant = variantOf(command);
    const fn = variant === undefined ? undefined : entry.delegated[variant];
    if (fn) return { kind: 'delegated', fn };
  }
  return { kind: 'lines', lines: entry.build(command, ctx) };
}
