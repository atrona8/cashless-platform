// Intercepteur d'idempotence (SPECIFICATION §10.2, contracts/idempotency.md) : ne s'applique qu'aux routes marquées
// `@Idempotent`. Réserve la clé (transaction 1), fournit au contrôleur la transaction métier qui enregistre la réponse
// avant son COMMIT (transaction 2), rejoue les réponses enregistrées, enregistre les erreurs 4xx et relâche la clé
// sur une erreur 5xx.
import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, mergeMap, catchError, type Observable } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { TxClient } from '../db/tenant-tx';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { logProblem, PROBLEM_CONTENT_TYPE, problemBody, resolveProblem } from '../errors/problem.filter';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { IdempotencyRepository, LeaseLostError, type Reservation, type StoredResponse } from './idempotency.repository';
import { IDEMPOTENT, type IdempotentOptions, type IdempotentRequest } from './idempotent.decorator';
import { requestHash, routeTemplate } from './request-hash';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotency-Replayed';
/** En-têtes rejoués (liste blanche du data-model). */
const REPLAYED_HEADERS = ['Location', 'Content-Type'] as const;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private tenantContext?: TenantContextProvider;

  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly repository: IdempotencyRepository,
    private readonly tenantTx: TenantTx,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<IdempotentOptions | undefined>(IDEMPOTENT, context.getHandler());
    if (!options || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<IdempotentRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined || key === '') throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
    if (key.length > 255) {
      throw new ProblemException('VALIDATION_FAILED', { status: 400, detail: 'Idempotency-Key : 255 caractères au plus.' });
    }
    const { operatorId } = this.tenant().current(req);
    const scope = typeof options.scope === 'function' ? options.scope(req) : options.scope;
    const outcome = await this.repository.reserve(operatorId, scope, key, requestHash(req.method, routeTemplate(req), req.body));

    if (outcome.kind === 'replay') {
      res.setHeader(REPLAYED_HEADER, 'true');
      return from([send(res, outcome.response)]);
    }

    const reservation = outcome.reservation;
    let recorded: StoredResponse | undefined;
    req.idempotentTx = {
      run: async <T>(fn: (client: TxClient) => Promise<T>): Promise<T> => {
        if (recorded) throw new Error('IdempotentTx.run : une seule transaction métier par requête');
        let response: StoredResponse | undefined;
        const result = await this.tenantTx.run(operatorId, async (client) => {
          const value = await fn(client);
          response = { status: res.statusCode, body: value, headers: replayedHeaders(res) };
          await this.repository.complete(client, reservation, response);
          return value;
        });
        recorded = response;
        return result;
      },
    };

    return next.handle().pipe(
      mergeMap(async (value) => {
        // Le contrôleur n'a pas ouvert de transaction métier : la réponse est enregistrée seule.
        if (!recorded) {
          const response: StoredResponse = { status: res.statusCode, body: value, headers: replayedHeaders(res) };
          await this.repository.completeAlone(reservation, response);
          recorded = response;
        }
        // Ce qui part est exactement ce qui est enregistré (et sera rejoué).
        return send(res, recorded);
      }),
      catchError((error: unknown) => from(this.onError(error, req, res, reservation, recorded))),
    );
  }

  private async onError(
    error: unknown,
    req: Request,
    res: Response,
    reservation: Reservation,
    recorded: StoredResponse | undefined,
  ): Promise<unknown> {
    const problem = resolveProblem(error);
    if (recorded) {
      // Le travail métier et sa réponse sont validés : la réponse enregistrée fait foi.
      logProblem(error, { ...problem, status: Math.max(problem.status, 500) }, req);
      return send(res, recorded);
    }
    if (error instanceof LeaseLostError) throw error;
    if (problem.status >= 500) {
      await this.repository.release(reservation).catch((releaseError: unknown) => {
        logProblem(releaseError, { code: 'INTERNAL_ERROR', status: 500 }, req);
      });
      throw error;
    }
    // Erreur 4xx : réponse définitive, enregistrée telle que le filtre l'aurait produite, puis rejouée à l'identique.
    logProblem(error, problem, req);
    const response: StoredResponse = {
      status: problem.status,
      body: problemBody(problem, req, this.config),
      headers: { 'Content-Type': PROBLEM_CONTENT_TYPE },
    };
    await this.repository.completeAlone(reservation, response);
    return send(res, response);
  }

  private tenant(): TenantContextProvider {
    // Fourni par AppModule (remplacé en test) : résolu sans dépendance de module (strict: false).
    this.tenantContext ??= this.moduleRef.get<TenantContextProvider>(TENANT_CONTEXT, { strict: false });
    return this.tenantContext;
  }
}

function replayedHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of REPLAYED_HEADERS) {
    const value = res.getHeader(name);
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

/** Applique statut et en-têtes enregistrés ; le corps est rendu à Nest, qui l'envoie (JSON, ou vide si null). */
function send(res: Response, response: StoredResponse): unknown {
  res.status(response.status);
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  return response.body ?? undefined;
}
