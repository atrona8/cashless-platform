// Répartition d'une dépense entre crédits offerts et crédits payés (purchase_lines / offline_sync_lines).

export type SpendMode = 'ONLINE' | 'OFFLINE';

export interface SpendInput {
  amount: bigint;
  /** Soldes en convention « positif = disponible » (le service convertit depuis les soldes signés du grand livre). */
  promoBalance: bigint;
  paidBalance: bigint;
  promoFirst: boolean;
  mode: SpendMode;
}

export interface SpendSplit {
  fromPromo: bigint;
  fromPaid: bigint;
  /** Part non couverte (hors ligne seulement) : portée au compte d'attente. */
  uncovered: bigint;
}

export class InsufficientFundsError extends Error {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor() {
    super('INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
  }
}

const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function spendSplit({ amount, promoBalance, paidBalance, promoFirst, mode }: SpendInput): SpendSplit {
  if (mode === 'ONLINE') {
    if (promoBalance + paidBalance < amount) throw new InsufficientFundsError();
    const fromPromo = promoFirst ? min(amount, promoBalance) : max(0n, amount - paidBalance);
    return { fromPromo, fromPaid: amount - fromPromo, uncovered: 0n };
  }
  // Hors ligne : la vente a eu lieu, le commerçant est garanti ; on couvre ce que les soldes permettent.
  const covered = min(amount, max(paidBalance, 0n) + max(promoBalance, 0n));
  const fromPromo = promoFirst ? min(covered, promoBalance) : max(0n, covered - paidBalance);
  return { fromPromo, fromPaid: covered - fromPromo, uncovered: amount - covered };
}
