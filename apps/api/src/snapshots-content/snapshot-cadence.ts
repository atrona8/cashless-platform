// Cadence de production des snapshots (research R-30.5), en fonctions PURES : l'horloge est un
// paramètre, un âge
// négatif (horloge de la base qui recule) vaut 0.
import type { SnapshotEntry } from './content-hash';

export type Decision = 'none' | 'DELTA' | 'FULL' | 'KEEPALIVE';

export const BLOCKING_STATUSES: ReadonlySet<string> = new Set([
  'SUSPENDED',
  'BLACKLISTED',
  'REPLACED',
  'RETIRED',
]);

/** Délai avant un DELTA ordinaire, en millisecondes (R-30.5). */
export const DELTA_AFTER_MS = 60_000;
/** Part des entrées au-delà de laquelle un DELTA devient un FULL. */
export const FULL_RATIO = 0.2;

/** Un changement : entrée modifiée (`entry`) ou retirée (`entry` nul). */
export interface Change {
  entry: Pick<SnapshotEntry, 'status' | 'batch_status' | 'wallet_status'> | null;
}

/** Bloquant : retrait, statut suspendu/liste noire/remplacé/retiré, lot non ACTIVE, portefeuille
 * BLOCKED. */
export function isBlocking(change: Change): boolean {
  const e = change.entry;
  if (e === null) return true;
  return (
    BLOCKING_STATUSES.has(e.status) ||
    (e.batch_status !== null && e.batch_status !== 'ACTIVE') ||
    e.wallet_status === 'BLOCKED'
  );
}

export interface CadenceState {
  /** Dernière version publiée du grand livre (0 : aucune). */
  lastVersion: number;
  lastGeneratedAt: Date | null;
  /** Date du dernier FULL ; inconnue (null) = traitée comme maintenant. */
  lastFullAt: Date | null;
  eligibleDevices: number;
  /** Un terminal est devenu éligible depuis le dernier passage (R-30.5). */
  eligibleIncreased: boolean;
  /** Dénominateur des 20 % : entrées vivantes de l'état courant. */
  totalEntries: number;
}

export interface CadenceOptions {
  fullEveryMs: number;
  /** `valid_until − generated_at`, soit `max_snapshot_age`. */
  validityMs: number;
}

const age = (since: Date | null, now: Date): number =>
  since === null ? 0 : Math.max(0, now.getTime() - since.getTime());

/** Prochaine version due : aucune, DELTA, FULL ou version de maintien (DELTA vide). */
export function decideNext(
  state: CadenceState,
  changes: readonly Change[],
  now: Date,
  options: CadenceOptions,
): Decision {
  if (state.eligibleDevices <= 0) return 'none';
  if (state.lastVersion === 0) return 'FULL';
  if (state.lastFullAt !== null && age(state.lastFullAt, now) > options.fullEveryMs) return 'FULL';
  const sinceLast = age(state.lastGeneratedAt, now);
  if (changes.length === 0) {
    return state.eligibleIncreased || sinceLast >= options.validityMs / 3 ? 'KEEPALIVE' : 'none';
  }
  if (!changes.some(isBlocking) && sinceLast < DELTA_AFTER_MS) return 'none';
  if (state.totalEntries > 0 && changes.length / state.totalEntries > FULL_RATIO) return 'FULL';
  return 'DELTA';
}
