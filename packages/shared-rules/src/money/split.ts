// Partage d'un total en deux parts (split_share de moteur_ecritures_reference.py).
import { BPS_SCALE, roundDiv } from './rounding';

/** 1re part arrondie, la 2e reçoit le reste (ex. casse organisateur / prestataire). */
export function splitShare(total: bigint, firstBps: bigint): [bigint, bigint] {
  const first = roundDiv(total * firstBps, BPS_SCALE);
  return [first, total - first];
}
