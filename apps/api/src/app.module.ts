// Module racine : accès base, santé, X-Request-Id, filtre problem+json, contexte de prestataire (refus par défaut).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { ProblemFilter } from './errors/problem.filter';
import { HealthModule } from './health/health.controller';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { TENANT_CONTEXT, UnauthenticatedTenantContext } from './tenancy/tenant-context';

@Module({
  imports: [DbModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: TENANT_CONTEXT, useClass: UnauthenticatedTenantContext },
  ],
  exports: [TENANT_CONTEXT],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
