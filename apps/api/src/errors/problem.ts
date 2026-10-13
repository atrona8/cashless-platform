// Erreur métier portant un ProblemCode (réponse application/problem+json, SPECIFICATION §10.1).
import type { ProblemCode } from '@cashless/contracts';
import { PROBLEM_STATUSES } from '@cashless/contracts';

export interface ProblemOptions {
  /** Statut HTTP ; par défaut le premier statut du contrat pour ce code. */
  status?: number;
  /** Détail propre à ce cas (sinon celui du catalogue, dans la langue de la requête). */
  detail?: string;
  /** Membres d'extension du problème (RFC 9457), par exemple `violations` d'un refus de bornes. */
  extensions?: Record<string, unknown>;
}

export class ProblemException extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly extensions?: Record<string, unknown>;

  constructor(
    readonly code: ProblemCode,
    options: ProblemOptions = {},
  ) {
    super(code);
    this.name = 'ProblemException';
    this.status = options.status ?? defaultStatus(code);
    this.detail = options.detail;
    this.extensions = options.extensions;
  }
}

export function defaultStatus(code: ProblemCode): number {
  const statuses = PROBLEM_STATUSES[code];
  return statuses[0] ?? 500;
}
