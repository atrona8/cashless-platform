// Contestations et déblocage (mission 6, lot WP13). Importé par AppModule (API publique) ; GLOBAL pour que le
// `EventDispatcher` de WP12 (WebhooksModule, non modifié) reçoive `PSP_DISPUTE_HANDLER`. Le processus `psp-poller`
// (reprise des événements) déclare les mêmes fournisseurs par `CHARGEBACK_DISPUTE_PROVIDERS` (dispute-providers.ts).
import { Global, Module } from '@nestjs/common';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { PspTopupsModule } from '../topups/psp/psp-topups.module';
import { PSP_DISPUTE_HANDLER } from '../webhooks/event-dispatcher';
import { ChargebacksController } from './chargebacks.controller';
import { CHARGEBACK_DISPUTE_PROVIDERS } from './dispute-providers';
import { LateChargebackActions } from './late-chargeback-action';
import { WalletUnblockActions } from './wallet-unblock-action';

@Global()
@Module({
  imports: [ConfigResolverModule, TenantModule, PspTopupsModule],
  controllers: [ChargebacksController],
  providers: [...CHARGEBACK_DISPUTE_PROVIDERS, LateChargebackActions, WalletUnblockActions],
  exports: [PSP_DISPUTE_HANDLER],
})
export class ChargebacksModule {}
