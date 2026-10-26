// Heure d'une opération de terminal (mission 5b, lot WP11, T051 ; A5, A27 ; SPECIFICATION §9.5, §9.6 ;
// contracts/payments.md, « Heure de l'opération »). `occurred_at` reçu du terminal est borné à ±120 s de
// l'heure de la BASE (`clock_timestamp()` lu dans la transaction, jamais l'horloge de Node) : au-delà,
// l'écriture porte l'heure de la base, l'heure reçue est gardée dans `metadata.device_occurred_at` et une
// anomalie `CLOCK_SKEW` est ouverte dans la même transaction.
import { ProblemException } from '../errors/problem';

/** Tolérance de l'heure d'une opération de terminal (§9.6). */
export const OCCURRED_AT_TOLERANCE_SECONDS = 120;

export interface OperationTime {
  /** Heure écrite au grand livre : celle du terminal si elle est dans la tolérance, sinon celle de la base. */
  occurredAt: Date;
  /** Heure reçue du terminal quand elle a été écartée (`metadata.device_occurred_at`), sinon `null`. */
  deviceOccurredAt: Date | null;
  /** Vrai si l'écart dépasse la tolérance : une anomalie `CLOCK_SKEW` doit être ouverte. */
  skewed: boolean;
}

/** Borne inclusive : un écart de 120 s exactement est admis, 120,001 s ne l'est pas. */
export function resolveOperationTime(received: Date, databaseNow: Date): OperationTime {
  const gap = Math.abs(received.getTime() - databaseNow.getTime());
  if (gap > OCCURRED_AT_TOLERANCE_SECONDS * 1000)
    return { occurredAt: databaseNow, deviceOccurredAt: received, skewed: true };
  return { occurredAt: received, deviceOccurredAt: null, skewed: false };
}

/**
 * `X-Authority-Epoch` (A27) : obligatoire sur une opération de débit (arbitrage de l'orchestrateur du
 * 22/10/2026 : le contrat dit « DOIT être envoyée », l'absence est refusée) ; différente de l'époque du grand
 * livre → `409 STALE_AUTHORITY_EPOCH`, avec l'époque courante.
 */
export function assertAuthorityEpoch(header: string | undefined, current: number): void {
  if (header === undefined || header.trim() === '')
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'X-Authority-Epoch : en-tête obligatoire sur une opération de débit.',
    });
  if (!/^[0-9]{1,15}$/.test(header.trim()))
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'X-Authority-Epoch : entier positif ou nul attendu.',
    });
  if (Number(header.trim()) !== current)
    throw new ProblemException('STALE_AUTHORITY_EPOCH', {
      extensions: { authority_epoch: current },
    });
}
