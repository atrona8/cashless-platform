// Socle commun des processus des clés de bracelet (mission bracelets-nfc, research R-01) : filtre problem+json,
// X-Request-Id, registre des travailleurs, et refus par défaut de toute route non déclarée.
import {
  Global,
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { ProblemException } from '../errors/problem';
import { ProblemFilter } from '../errors/problem.filter';
import { RequestIdMiddleware } from '../http/request-id.middleware';
import { IS_PUBLIC } from '../identity/public.decorator';
import { WorkerRegistry } from './worker';

/**
 * Processus sans garde d'authentification des personnes (clés de bracelet) : toute route doit être marquée
 * (`@DeviceAuth()`, `@Public()`), sinon elle est refusée. Une route oubliée n'est donc jamais ouverte.
 */
@Injectable()
export class DenyUnmarkedRoutesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    throw new ProblemException('UNAUTHENTICATED');
  }
}

@Global()
@Module({
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }, WorkerRegistry],
  exports: [WorkerRegistry],
})
export class ProcessBaseModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
