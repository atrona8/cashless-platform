// Erreurs d'API de la passerelle, au format `application/problem+json` du contrat (schéma `Problem`
// de openapi.yaml : `type`, `title`, `status`, `code`, `request_id`). Les codes et leurs statuts
// viennent de `@cashless/contracts` (PROBLEM_STATUSES) : la passerelle n'invente aucun code.
// Utilisé par les lots 19 à 23 pour toutes les routes servies aux terminaux. Le message d'une
// erreur interne (SQL, cryptographie) n'atteint jamais le client.
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { PROBLEM_STATUSES, type ProblemCode } from '@cashless/contracts';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_BASE = 'https://docs.cashless.test/problems/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TITLES: Partial<Record<ProblemCode, string>> = {
  UNAUTHENTICATED: 'Authentification requise',
  DEVICE_SIGNATURE_INVALID: 'Signature de requête invalide',
  REFRESH_TOKEN_INVALID: 'Jeton de rafraîchissement invalide',
  DEVICE_SUSPENDED: 'Terminal suspendu',
  DEVICE_REVOKED: 'Terminal révoqué',
  CLOCK_SKEW_TOO_LARGE: 'Écart d’horloge trop grand',
  IDEMPOTENCY_KEY_REUSED: 'Clé d’idempotence déjà employée',
  VALIDATION_FAILED: 'Requête invalide',
  CONFLICT_STATE: 'Conflit d’état',
  INTERNAL_ERROR: 'Erreur interne',
  NOT_FOUND: 'Introuvable',
};

export interface ProblemOptions {
  status?: number;
  detail?: string;
  extensions?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ProblemException extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly extensions?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    readonly code: ProblemCode,
    options: ProblemOptions = {},
  ) {
    super(code);
    this.name = 'ProblemException';
    this.status = options.status ?? PROBLEM_STATUSES[code][0] ?? 500;
    this.detail = options.detail;
    this.extensions = options.extensions;
    this.headers = options.headers;
  }
}

export function problemBody(
  error: ProblemException,
  req: Pick<Request, 'header'>,
): Record<string, unknown> {
  const header = req.header('x-request-id');
  return {
    ...error.extensions,
    type: `${PROBLEM_TYPE_BASE}${error.code}`,
    title: TITLES[error.code] ?? error.code,
    status: error.status,
    ...(error.detail ? { detail: error.detail } : {}),
    code: error.code,
    request_id: header !== undefined && UUID.test(header) ? header : randomUUID(),
  };
}

function resolve(error: unknown): ProblemException {
  if (error instanceof ProblemException) return error;
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return new ProblemException('NOT_FOUND');
    if (status === 401) return new ProblemException('UNAUTHENTICATED');
    if (status === 400 || status === 413 || status === 415)
      return new ProblemException('VALIDATION_FAILED', { status: 400 });
  }
  return new ProblemException('INTERNAL_ERROR');
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('DeviceApi');

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = resolve(error);
    if (problem.status >= 500) {
      // Ni message d'erreur SQL ni cause : le type seul (jamais un jeton, une clé ou une empreinte).
      this.logger.error(
        JSON.stringify({ event: 'device_api_error', kind: (error as Error)?.name ?? 'unknown' }),
      );
    }
    for (const [name, value] of Object.entries(problem.headers ?? {})) res.setHeader(name, value);
    res
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(problemBody(problem, req)));
  }
}
