// Filtre global : toute erreur devient une réponse application/problem+json (SPECIFICATION §10.1, research R-04).
// Le message d'une erreur SQL n'atteint jamais le client : il est journalisé côté serveur avec le X-Request-Id.
import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ProblemCode } from '@cashless/contracts';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { messageFor, pickLanguage } from '../http/language';
import { requestIdOf } from '../http/request-id.middleware';
import { ProblemException } from './problem';
import { isSqlError, mapSqlState } from './sqlstate-map';

interface Resolved {
  code: ProblemCode;
  status: number;
  detail?: string;
}

function resolve(error: unknown): Resolved {
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

@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = requestIdOf(req);
    const { code, status, detail } = resolve(error);
    if (status >= 500 || isSqlError(error)) {
      // Journal serveur seulement (le client ne reçoit que le code).
      process.stderr.write(
        `${JSON.stringify({
          level: 'error',
          requestId,
          code,
          sqlstate: isSqlError(error) ? error.code : undefined,
          message: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
    }
    const message = messageFor(code, pickLanguage(req.header('Accept-Language')));
    res
      .status(status)
      .type('application/problem+json')
      .send(
        JSON.stringify({
          type: `${this.config.problemTypeBase}${code}`,
          title: message.title,
          status,
          detail: detail ?? message.detail,
          code,
          instance: requestId,
        }),
      );
  }
}
