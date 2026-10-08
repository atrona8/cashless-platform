// Filtre global : toute erreur devient une réponse application/problem+json (SPECIFICATION §10.1, research R-04).
// Le message d'une erreur SQL n'atteint jamais le client : il est journalisé côté serveur avec le X-Request-Id.
// `resolveProblem`, `problemBody` et `logProblem` sont aussi utilisés par l'idempotence (WP11), qui enregistre la
// réponse d'erreur 4xx telle que ce filtre l'aurait produite.
import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ProblemCode } from '@cashless/contracts';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { messageFor, pickLanguage } from '../http/language';
import { requestIdOf } from '../http/request-id.middleware';
import { ProblemException } from './problem';
import { isSqlError, mapSqlState } from './sqlstate-map';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface ResolvedProblem {
  code: ProblemCode;
  status: number;
  detail?: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ProblemCode;
  instance: string;
}

export function resolveProblem(error: unknown): ResolvedProblem {
  if (error instanceof ProblemException) return { code: error.code, status: error.status, detail: error.detail };
  if (isSqlError(error)) return mapSqlState(error.code, error.constraint);
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return { code: 'NOT_FOUND', status };
    if (status === 400 || status === 413 || status === 415 || status === 422) return { code: 'VALIDATION_FAILED', status: status === 422 ? 422 : 400 };
    if (status === 401) return { code: 'UNAUTHENTICATED', status };
    if (status === 403) return { code: 'FORBIDDEN', status };
    if (status === 429) return { code: 'RATE_LIMITED', status };
  }
  return { code: 'INTERNAL_ERROR', status: 500 };
}

export function problemBody(problem: ResolvedProblem, req: Request, config: AppConfig): ProblemBody {
  const message = messageFor(problem.code, pickLanguage(req.header('Accept-Language')));
  return {
    type: `${config.problemTypeBase}${problem.code}`,
    title: message.title,
    status: problem.status,
    detail: problem.detail ?? message.detail,
    code: problem.code,
    instance: requestIdOf(req),
  };
}

/** Journal serveur des erreurs 5xx et SQL (le client ne reçoit que le code). */
export function logProblem(error: unknown, problem: ResolvedProblem, req: Request): void {
  if (problem.status < 500 && !isSqlError(error)) return;
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      requestId: requestIdOf(req),
      code: problem.code,
      sqlstate: isSqlError(error) ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = resolveProblem(error);
    logProblem(error, problem, req);
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problemBody(problem, req, this.config)));
  }
}
