// Intercepteur d'idempotence (SPECIFICATION §10.2, contracts/idempotency.md) : ne s'applique qu'aux routes marquées
// `@Idempotent`. Réserve la clé (transaction 1), fournit au contrôleur la transaction métier qui enregistre la réponse
// avant son COMMIT (transaction 2), rejoue les réponses enregistrées, enregistre les erreurs 4xx et relâche la clé
// sur une erreur 5xx. Deux extensions (mission identite-roles, WP07) : `CommittedProblem` levé dans la transaction
// métier valide le travail fait et enregistre le problème comme réponse ; une route `writes` (défaut) qui rend sa
// valeur sans `IdempotentTx.run` échoue en 500 (RISK-2). Mission 5b (WP08) : clé `<serial>:<seq>`
// d'une route de terminal (`deviceSeq`) et refus non définitifs relâchés (device-key.ts).
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, mergeMap, catchError, type Observable } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import {
  logProblem,
  PROBLEM_CONTENT_TYPE,
  problemBody,
  resolveProblem,
} from '../errors/problem.filter';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import { VendorPinHasher } from '../vendor-pin/vendor-pin.hasher';
import { requestDevice, type DeviceRequest } from '../device-identity/device-identity.port';
import { CommittedProblem } from './committed-problem';
import { NON_FINAL_CODES, parseDeviceKey, type DeviceSeqRequest } from './device-key';
import {
  IdempotencyRepository,
  LeaseLostError,
  type Reservation,
  type StoredResponse,
} from './idempotency.repository';
import { IDEMPOTENT, type IdempotentOptions, type IdempotentRequest } from './idempotent.decorator';
import { assertPlatformAdmin, isPlatformPerson } from './platform-person';
import { concretePath, requestCaller, requestHash, routeTemplate } from './request-hash';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotency-Replayed';
/** Code interne journalisé quand une route d'écriture n'a pas ouvert sa transaction métier (client : INTERNAL_ERROR). */
export const ROUTE_WITHOUT_TX = 'IDEMPOTENT_ROUTE_WITHOUT_TX';
/** Marqueur rendu par la transaction métier quand un `CommittedProblem` y a été enregistré. */
const COMMITTED = Symbol('COMMITTED');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** En-têtes rejoués (liste blanche du data-model). */
const REPLAYED_HEADERS = ['Location', 'Content-Type'] as const;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private tenantContext?: TenantContextProvider;

  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly repository: IdempotencyRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<IdempotentOptions | undefined>(
      IDEMPOTENT,
      context.getHandler(),
    );
    if (!options || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<IdempotentRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined || key === '') throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
    if (key.length > 255) {
      throw new ProblemException('VALIDATION_FAILED', {
        status: 400,
        detail: 'Idempotency-Key : 255 caractères au plus.',
      });
    }
    const uuidKey =
      options.keyUuid === true ||
      (options.keyUuid === 'without-device' && (req as DeviceRequest).device === undefined);
    if (uuidKey && !UUID_PATTERN.test(key)) {
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Idempotency-Key : UUID attendu.',
      });
    }
    // Route de terminal à clé `<serial>:<seq>` : contrôlée avant toute écriture (A14).
    if (
      options.deviceSeq === true ||
      (options.deviceSeq === 'when-device' && (req as DeviceRequest).device !== undefined)
    )
      (req as DeviceSeqRequest).deviceSeq = parseDeviceKey(key, requestDevice(req));
    // Niveau de la clé : décidé par l'option de la route ; le prestataire n'est pas résolu au niveau plateforme.
    const platform =
      options.platform === true || (options.platform === 'principal' && isPlatformPerson(req));
    if (platform) assertPlatformAdmin(req);
    const operatorId = platform ? null : this.tenant().current(req).operatorId;
    const scope = typeof options.scope === 'function' ? options.scope(req) : options.scope;
    // Empreinte sur le chemin concret et liée à l'appelant (ADR-116) : la même clé sur une autre
    // ressource, ou présentée par un autre appelant, ne rejoue jamais la réponse d'origine.
    const hash = requestHash(
      req.method,
      concretePath(req),
      requestCaller(req),
      options.pinFields?.length
        ? await this.pinHasher().idempotencyBody(req.body, options.pinFields, scope, key)
        : req.body,
      this.config.idempotencyHmacKey,
    );
    const outcome = await this.repository.reserve(operatorId, scope, key, hash);

    if (outcome.kind === 'replay') {
      res.setHeader(REPLAYED_HEADER, 'true');
      return from([send(res, outcome.response)]);
    }

    const reservation = outcome.reservation;
    let recorded: StoredResponse | undefined;
    // Réponse réellement envoyée quand elle diffère de celle qui est enregistrée (route `transient`).
    let live: StoredResponse | undefined;
    req.idempotentTx = {
      run: async <T>(fn: (client: TxClient) => Promise<T>): Promise<T> => {
        if (recorded)
          throw new Error('IdempotentTx.run : une seule transaction métier par requête');
        let response: StoredResponse | undefined;
        let committed: CommittedProblem | undefined;
        const result = await this.repository.transaction(operatorId, async (client) => {
          let value: T;
          try {
            value = await fn(client);
          } catch (error) {
            if (!(error instanceof CommittedProblem)) throw error;
            // Le travail fait est l'état voulu : le problème devient la réponse, validée avec lui (COMMIT).
            committed = error;
            response = this.problemResponse(error, req);
            await this.repository.complete(client, reservation, response);
            return COMMITTED;
          }
          const actual: StoredResponse = {
            status: res.statusCode,
            body: value,
            headers: replayedHeaders(res),
          };
          // Route `transient` : la réponse part une fois et n'est écrite nulle part ; le registre garde un refus.
          response = options.transient ? this.notReplayable(req) : actual;
          await this.repository.complete(client, reservation, response);
          if (options.transient) live = actual;
          return value;
        });
        recorded = response;
        if (committed) throw committed;
        return result as T;
      },
    };

    return next.handle().pipe(
      mergeMap(async (value) => {
        if (!recorded && options.writes !== false) {
          // Route d'écriture sans transaction métier : ce qu'elle a écrit n'est pas lié à la clé (RISK-2).
          throw new Error(
            `${ROUTE_WITHOUT_TX} : ${req.method} ${routeTemplate(req)} a rendu sa valeur sans IdempotentTx.run`,
          );
        }
        // Route déclarée sans écriture : la réponse est enregistrée seule.
        if (!recorded) {
          const response: StoredResponse = {
            status: res.statusCode,
            body: value,
            headers: replayedHeaders(res),
          };
          await this.repository.completeAlone(reservation, response);
          recorded = response;
        }
        // Ce qui part est exactement ce qui est enregistré (et sera rejoué), sauf pour une route `transient`.
        return send(res, live ?? recorded);
      }),
      catchError((error: unknown) =>
        from(this.onError(error, req, res, reservation, recorded, options)),
      ),
    );
  }

  private async onError(
    error: unknown,
    req: Request,
    res: Response,
    reservation: Reservation,
    recorded: StoredResponse | undefined,
    options: IdempotentOptions,
  ): Promise<unknown> {
    // Problème validé avec le travail métier : déjà journalisé et enregistré, il part tel quel.
    if (error instanceof CommittedProblem && recorded) return send(res, recorded);
    const problem = resolveProblem(error);
    if (recorded) {
      // Le travail métier et sa réponse sont validés : la réponse enregistrée fait foi.
      logProblem(error, { ...problem, status: Math.max(problem.status, 500) }, req);
      return send(res, recorded);
    }
    if (error instanceof LeaseLostError) throw error;
    // 5xx, ou refus non définitif du contrat (`DEBIT_AUTHORITY_MOVING`, `DEBIT_AUTHORITY_EDGE`,
    // liste fermée, A14) : la clé est relâchée, rien n'est enregistré ; le client rejoue la clé.
    if (
      problem.status >= 500 ||
      NON_FINAL_CODES.has(problem.code) ||
      options.nonFinal?.includes(problem.code)
    ) {
      await this.repository.release(reservation).catch((releaseError: unknown) => {
        logProblem(releaseError, { code: 'INTERNAL_ERROR', status: 500 }, req);
      });
      throw error;
    }
    // Erreur 4xx : réponse définitive, enregistrée telle que le filtre l'aurait produite, puis rejouée à l'identique.
    const response = this.problemResponse(error, req);
    await this.repository.completeAlone(reservation, response);
    return send(res, response);
  }

  /** Ce que le registre garde d'une route `transient` : un refus, sans rien de la réponse d'origine. */
  private notReplayable(req: Request): StoredResponse {
    const problem = resolveProblem(
      new ProblemException('CONFLICT_STATE', {
        status: 409,
        detail:
          'Cette demande a déjà été exécutée ; sa réponse n’est pas conservée et ne peut pas être renvoyée.',
      }),
    );
    return {
      status: problem.status,
      body: problemBody(problem, req, this.config),
      headers: { 'Content-Type': PROBLEM_CONTENT_TYPE },
    };
  }

  /** Réponse problème enregistrée (même forme que le filtre), après journalisation. */
  private problemResponse(error: unknown, req: Request): StoredResponse {
    const problem = resolveProblem(error);
    logProblem(error, problem, req);
    return {
      status: problem.status,
      body: problemBody(problem, req, this.config),
      headers: { ...problem.headers, 'Content-Type': PROBLEM_CONTENT_TYPE },
    };
  }

  private pinHasher(): VendorPinHasher {
    // Fourni par VendorPinModule (ADR-126) : résolu sans dépendance de module, comme le contexte du prestataire.
    return this.moduleRef.get(VendorPinHasher, { strict: false });
  }

  private tenant(): TenantContextProvider {
    // Fourni par AppModule (remplacé en test) : résolu sans dépendance de module (strict: false).
    this.tenantContext ??= this.moduleRef.get<TenantContextProvider>(TENANT_CONTEXT, {
      strict: false,
    });
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
