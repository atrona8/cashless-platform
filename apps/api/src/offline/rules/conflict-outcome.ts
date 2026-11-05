// Issue d'un passage hors ligne en conflit (sync_protocol.md §7.3 ; contracts/compliance.md).
// Décide qui perd de l'argent : à relire ligne à ligne avec la table du protocole.
import type { ShortfallReason, TapResult } from './types';

export interface ConflictInput {
  tapResult: TapResult;
  amount: bigint;
  /** PAID + PROMO lus sous verrou. */
  spendable: bigint;
  walletStatus: string;
  /** Date de blocage la plus ancienne ; `null` ou `'UNKNOWN'` : bloqué avant la vente. */
  blockTime: Date | null | 'UNKNOWN';
  occurredAt: Date;
  snapshotGeneratedAt: Date;
  tolMs: number;
}

export type ConflictOutcome =
  | { kind: 'WRITE'; covered: bigint; shortfall: bigint; shortfallReason?: ShortfallReason }
  | { kind: 'REJECT'; reason: 'MEDIA_NOT_IN_SNAPSHOT' | 'MEDIA_WRONG_EVENT' };

function write(covered: bigint, amount: bigint, reason: ShortfallReason): ConflictOutcome {
  const shortfall = amount - covered;
  return shortfall === 0n
    ? { kind: 'WRITE', covered, shortfall }
    : { kind: 'WRITE', covered, shortfall, shortfallReason: reason };
}

// États de support absents de la table (choix prudent, décision de l'orchestrateur) : traités comme
// un blocage de date inconnue, donc manque entier.
const BLOCKING_LIKE: ReadonlySet<TapResult> = new Set([
  'BLOCKED',
  'RETIRED',
  'REPLACED',
  'RELEASED',
  'BATCH_INACTIVE',
]);

export function conflictOutcome(i: ConflictInput): ConflictOutcome {
  if (i.amount < 0n) throw new Error('amount négatif');
  const spendable = i.spendable < 0n ? 0n : i.spendable;
  const covers = (): bigint => (spendable < i.amount ? spendable : i.amount);

  switch (i.tapResult) {
    case 'UNKNOWN':
    case 'NOT_ACTIVATED':
      return { kind: 'REJECT', reason: 'MEDIA_NOT_IN_SNAPSHOT' };
    case 'WRONG_EVENT':
      return { kind: 'REJECT', reason: 'MEDIA_WRONG_EVENT' };
    case 'CLONE_SUSPECTED':
      return write(0n, i.amount, 'MEDIA_CLONE_SUSPECTED');
    case 'UID_MISMATCH':
      return write(0n, i.amount, 'MEDIA_UID_MISMATCH');
    case 'SIGNATURE_MISMATCH':
      return write(0n, i.amount, 'MEDIA_SIGNATURE_MISMATCH');
    default:
      break;
  }

  if (i.walletStatus === 'BLOCKED' || i.walletStatus === 'CLOSED') {
    return write(0n, i.amount, 'WALLET_BLOCKED');
  }

  if (BLOCKING_LIKE.has(i.tapResult)) {
    if (i.tapResult !== 'BLOCKED' || i.blockTime === null || i.blockTime === 'UNKNOWN') {
      return write(0n, i.amount, 'MEDIA_BLOCKED_AFTER_SNAPSHOT');
    }
    const block = i.blockTime.getTime();
    // Blocage connu du terminal (≤ génération du snapshot) : la conformité l'aurait rejeté ;
    // manque entier.
    if (block <= i.snapshotGeneratedAt.getTime()) {
      return write(0n, i.amount, 'MEDIA_BLOCKED_AFTER_SNAPSHOT');
    }
    if (i.occurredAt.getTime() < block + i.tolMs)
      return write(covers(), i.amount, 'INSUFFICIENT_FUNDS');
    return write(0n, i.amount, 'MEDIA_BLOCKED_AFTER_SNAPSHOT');
  }

  // `OK`, et `SIGNATURE_MISSING` (résultat inchangé ; l'anomalie s'ajoute côté appelant).
  return write(covers(), i.amount, 'INSUFFICIENT_FUNDS');
}
