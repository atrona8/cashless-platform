// Verrou de requête pris AVANT l'intercepteur d'idempotence et tenu jusqu'à la fin de la requête
// (mission 5b, lot WP09, cycle 3 ; ADR-126). Raison d'être : à l'ouverture d'une session de vendeur,
// l'intercepteur d'idempotence calcule un dérivé argon2 du PIN pour l'empreinte ; sans ce verrou, des
// essais simultanés d'un même terminal payeraient chacun cet argon2 avant d'être refusés. Pris ici, le
// second essai reçoit son refus sans aucun calcul argon2.
//
// Ordre : les intercepteurs globaux s'exécutent dans l'ordre d'enregistrement des fournisseurs
// `APP_INTERCEPTOR` (idempotency.module.ts : celui-ci AVANT `IdempotencyInterceptor`) ; un test
// d'intégration prouve l'ordre (aucun argon2 pour l'essai refusé). Le verrou est tenu pendant tout le
// reste de la chaîne (idempotence, contrôleur, transactions) et relâché quand elle se termine, par un
// succès, un refus ou une erreur. Le mécanisme est celui de la base (verrou consultatif de session,
// db/session-lock.ts), donc valable pour tous les processus de l'API.
import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';
import { LOCK_BUSY, SessionLock } from '../db/session-lock';
import type { ProblemException } from '../errors/problem';

export const REQUEST_LOCK = Symbol('REQUEST_LOCK');

export interface RequestLockOptions {
  /** Espace de noms du verrou consultatif. */
  namespace: string;
  /** Identifiant verrouillé, calculé depuis ce que les gardes ont posé (ex. le terminal authentifié). */
  id: (req: Request) => string;
  /** Refus rendu quand le verrou est déjà tenu (`429 RATE_LIMITED` pour un essai de PIN). */
  busy: () => ProblemException;
}

/** Route dont le verrou est pris avant l'idempotence et tenu jusqu'à la fin de la requête. */
export const RequestLock = (options: RequestLockOptions): MethodDecorator =>
  SetMetadata(REQUEST_LOCK, options);

@Injectable()
export class RequestLockInterceptor implements NestInterceptor {
  private lock?: SessionLock;

  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<RequestLockOptions | undefined>(
      REQUEST_LOCK,
      context.getHandler(),
    );
    if (!options || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    // Fourni par VendorsModule : résolu sans dépendance de module, comme le contexte du prestataire.
    this.lock ??= this.moduleRef.get(SessionLock, { strict: false });
    const held = await this.lock.tryAcquire(options.namespace, options.id(req));
    if (held === LOCK_BUSY) throw options.busy();
    // `finalize` : fin normale, erreur ou abandon de l'abonnement ; le verrou ne reste jamais tenu.
    return next.handle().pipe(finalize(() => void held.release()));
  }
}
