// Format commun des journaux d'alerte du circuit PSP (réception des notifications et travailleurs, mission 6, lot
// WP12, T063 point 3) : une ligne JSON `{event, severity, reason, ...champs non sensibles}`, pour qu'UN seul filtre
// d'exploitation attrape les deux. Jamais de secret, de signature reçue, de corps ni d'empreinte de carte.
import type { Logger } from '@nestjs/common';

export type AlertSeverity = 'WARN' | 'ERROR';
export type AlertField = string | number | boolean | null;

export interface PspAlert {
  event: string;
  severity: AlertSeverity;
  reason: string;
  [field: string]: AlertField;
}

export function logPspAlert(logger: Pick<Logger, 'warn' | 'error'>, alert: PspAlert): void {
  const line = JSON.stringify(alert);
  if (alert.severity === 'ERROR') logger.error(line);
  else logger.warn(line);
}

/** Motif d'erreur sans donnée sensible : nom de la classe seulement (jamais le message, qui peut citer une valeur). */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
