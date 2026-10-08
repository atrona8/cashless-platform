// Erreur métier portant un ProblemCode (réponse application/problem+json, SPECIFICATION §10.1).
import type { ProblemCode } from '@cashless/contracts';
import { PROBLEM_STATUSES } from '@cashless/contracts';

export interface ProblemOptions {
  /** Statut HTTP ; par défaut le premier statut du contrat pour ce code. */
  status?: number;
  /** Détail propre à ce cas (sinon celui du catalogue, dans la langue de la requête). */
  detail?: string;
}

export class ProblemException extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(
    readonly code: ProblemCode,
    options: ProblemOptions = {},
  ) {
    super(code);
    this.name = 'ProblemException';
    this.status = options.status ?? defaultStatus(code);
    this.detail = options.detail;
  }
}

export function defaultStatus(code: ProblemCode): number {
  const statuses = PROBLEM_STATUSES[code];
  return statuses[0] ?? 500;
}
