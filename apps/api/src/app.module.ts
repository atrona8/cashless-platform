// Module racine : accès base, santé, idempotence, X-Request-Id, filtre problem+json, authentification OIDC et
// contexte de prestataire tiré de la personne authentifiée (IdentityModule).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApprovalModule } from './approval/approval.module';
import { AuditModule } from './audit/audit.module';
import { ConfigResolverModule } from './configuration/config-resolver.module';
import { ConfigurationCoreModule } from './configuration/configuration-core.module';
import { DbModule } from './db/db.module';
import { ProblemFilter } from './errors/problem.filter';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './identity/users/users.module';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { PlatformModule } from './organization/platform/platform.module';
import { TenantModule } from './organization/tenant/tenant.module';

@Module({
  imports: [
    DbModule,
    HealthModule,
    IdempotencyModule,
    IdentityModule,
    AuditModule,
    UsersModule,
    ApprovalModule,
    // Mission configuration-parties-evenements : cœur de la configuration, puis routes dans l'ordre des dépendances.
    ConfigurationCoreModule,
    PlatformModule,
    TenantModule,
    EventsModule,
    // Moteur d'écritures branché sur la configuration réelle (SqlConfigResolver).
    ConfigResolverModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
  exports: [IdentityModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
