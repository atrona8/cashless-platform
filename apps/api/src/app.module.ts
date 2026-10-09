// Module racine : accès base, santé, idempotence, X-Request-Id, filtre problem+json, authentification OIDC et
// contexte de prestataire tiré de la personne authentifiée (IdentityModule).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { DbModule } from './db/db.module';
import { ProblemFilter } from './errors/problem.filter';
import { HealthModule } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './identity/users/users.module';
import { RequestIdMiddleware } from './http/request-id.middleware';

@Module({
  imports: [DbModule, HealthModule, IdempotencyModule, IdentityModule, AuditModule, UsersModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
  exports: [IdentityModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
