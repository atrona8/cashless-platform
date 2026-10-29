import { ProblemException } from '../errors/problem';

/** Lancé par un adaptateur : le PSP ne répond pas (503) ou refuse (422). */
export class PspProviderError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'PspProviderError';
  }
}

/** Problème HTTP d'une erreur d'adaptateur ; aucune donnée du PSP dans le message. Autre erreur : 500. */
export function pspProblem(error: unknown): ProblemException {
  if (error instanceof PspProviderError)
    return error.kind === 'UNAVAILABLE'
      ? new ProblemException('PSP_UNAVAILABLE', { status: 503 })
      : new ProblemException('PSP_REJECTED', { status: 422 });
  return new ProblemException('INTERNAL_ERROR');
}
