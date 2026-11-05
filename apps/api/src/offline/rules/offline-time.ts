// Heure corrigée et inversions (sync_protocol.md §7.4 ; contracts/compliance.md § Temps).
// Arithmétique en millisecondes entières ; aucune horloge lue ici.
export type OfflineSkew = 'NONE' | 'FUTURE' | 'BEFORE_SNAPSHOT';

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: string): number {
  if (!ISO_WITH_ZONE.test(value)) throw new Error('occurred_at: ISO 8601 avec fuseau attendu');
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error('occurred_at: date invalide');
  return ms;
}

export function resolveOfflineTime(
  occurredAt: string,
  recordedAt: Date,
  snapshotGeneratedAt: Date | null,
  tolMs: number,
): { corrected: Date; skew: OfflineSkew } {
  const occurred = parseInstant(occurredAt);
  const recorded = recordedAt.getTime();
  if (occurred > recorded + tolMs) return { corrected: new Date(recorded), skew: 'FUTURE' };
  if (snapshotGeneratedAt !== null) {
    const generated = snapshotGeneratedAt.getTime();
    if (occurred < generated - tolMs) {
      return { corrected: new Date(generated), skew: 'BEFORE_SNAPSHOT' };
    }
  }
  return { corrected: new Date(occurred), skew: 'NONE' };
}

/** Numéros dont la date est antérieure de plus de `tolMs` à la plus grande date vue avant eux. */
export function detectInversions(
  ops: { seq: bigint; occurredAt: Date }[],
  tolMs: number,
): bigint[] {
  const flagged: bigint[] = [];
  let max: number | null = null;
  for (const op of ops) {
    const t = op.occurredAt.getTime();
    if (max !== null && max - t > tolMs) flagged.push(op.seq);
    if (max === null || t > max) max = t;
  }
  return flagged;
}
