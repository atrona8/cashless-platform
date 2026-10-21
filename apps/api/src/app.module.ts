// Module racine : accès base, santé, idempotence, X-Request-Id, filtre problem+json, authentification OIDC et
// contexte de prestataire tiré de la personne authentifiée (IdentityModule).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApprovalModule } from './approval/approval.module';
import { AuditModule } from './audit/audit.module';
import { ConfigResolverModule } from './configuration/config-resolver.module';
import { ConfigurationCoreModule } from './configuration/configuration-core.module';
import { CustomerIdentityModule } from './customer-identity/customer-identity.module';
import { DbModule } from './db/db.module';
import { DeviceIdentityModule } from './device-identity/device-identity.module';
import { DevicesModule } from './devices/devices.module';
import { ProblemFilter } from './errors/problem.filter';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { IdentityModule } from './identity/identity.module';
import { MediaPublicModule } from './media/media-public.module';
import { UsersModule } from './identity/users/users.module';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { PlatformModule } from './organization/platform/platform.module';
import { TenantModule } from './organization/tenant/tenant.module';
import { WorkerRegistry } from './processes/worker';

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
    // Mission bracelets-nfc : identités du terminal et du festivalier (ports), puis les routes des bracelets servies
    // par l'API publique. Aucun port du service de clés n'est chargé ici (voir processes/public.module.ts).
    DeviceIdentityModule,
    CustomerIdentityModule,
    MediaPublicModule,
    // Mission identite-enrolement-terminaux : routes des terminaux (enrôlement, jetons, configuration, back-office).
    DevicesModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }, WorkerRegistry],
  exports: [IdentityModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
