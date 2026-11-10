// Module racine : accès base, santé, idempotence, X-Request-Id, filtre problem+json, authentification OIDC et
// contexte de prestataire tiré de la personne authentifiée (IdentityModule).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApprovalModule } from './approval/approval.module';
import { AuditModule } from './audit/audit.module';
import { ConfigResolverModule } from './configuration/config-resolver.module';
import { ConfigurationCoreModule } from './configuration/configuration-core.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { CustomerIdentityModule } from './customer-identity/customer-identity.module';
import { DbModule } from './db/db.module';
import { PublicDeviceIdentityModule } from './device-identity/device-identity.module';
import { DevicesModule } from './devices/devices.module';
import { ProblemFilter } from './errors/problem.filter';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { IdentityModule } from './identity/identity.module';
import { MediaPublicModule } from './media/media-public.module';
import { OfflineBatchesModule } from './offline/batches/offline-batches.module';
import { OfflineJournalModule } from './offline/journal/offline-journal.module';
import { OfflineSeqModule } from './offline/seq/offline-seq.module';
import { PaymentRequestsModule } from './payment-requests/payment-requests.module';
import { PaymentsModule } from './payments/payments.module';
import { CashSessionsModule } from './cash-sessions/cash-sessions.module';
import { OfflinePolicyModule } from './offline/policy/offline-policy.module';
import { PspConfigurationsModule } from './psp-configurations/psp-configurations.module';
import { PspModule } from './psp/psp.module';
import { ReversalsModule } from './reversals/reversals.module';
import { UsersModule } from './identity/users/users.module';
import { CashTopupModule } from './topups/cash/cash-topup.module';
import { PspTopupsModule } from './topups/psp/psp-topups.module';
import { ChargebacksModule } from './chargebacks/chargebacks.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { VendorPinModule } from './vendor-pin/vendor-pin.module';
import { VendorsModule } from './vendors/vendors.module';
import { MeModule } from './customer-app/me.module';
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
    PublicDeviceIdentityModule,
    CustomerIdentityModule,
    MediaPublicModule,
    // Lectures de l'app festivalier (/me), servies avant la mission 10a (porteur, 10/11/2026).
    MeModule,
    // Authentification des festivaliers par code à usage unique (faux envoyeur jusqu'à la mission 12b).
    CustomerAuthModule,
    // Mission identite-enrolement-terminaux : routes des terminaux (enrôlement, jetons, configuration, back-office).
    DevicesModule,
    // Mission 5b : PIN des vendeurs (argon2 éprouvé au démarrage, sinon démarrage refusé).
    VendorPinModule,
    VendorsModule,
    PaymentsModule,
    ReversalsModule,
    PaymentRequestsModule,
    // Mission 6 : ports PSP et coffre, faux hors production seulement.
    PspModule,
    PspConfigurationsModule,
    CashSessionsModule,
    // Mission hors-ligne-snapshots-lots (lot WP14) : politique hors ligne et risque.
    OfflinePolicyModule,
    CashTopupModule,
    PspTopupsModule,
    WebhooksModule,
    ChargebacksModule,
    // Mission 7 (lot WP18) : réception des lots hors ligne.
    OfflineBatchesModule,
    // Mission 7 (lot WP20) : levée de trou de séquence et import du journal d'un terminal révoqué.
    OfflineSeqModule,
    OfflineJournalModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }, WorkerRegistry],
  exports: [IdentityModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
