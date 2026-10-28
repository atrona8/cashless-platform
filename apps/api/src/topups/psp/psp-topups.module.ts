// Recharges PSP : demande, suivi, annulation et traitement d'un paiement (mission 6, lot WP11). Importé par
// AppModule (API publique seule). `PspPaymentProcessor`, `PspTopupLookup` sont exportés pour WP12 et WP13.
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../../configuration/config-resolver.module';
import { LifecycleModule } from '../../media/lifecycle/lifecycle.module';
import { TapsModule } from '../../media/taps/taps.module';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { CardChecks } from './card-checks';
import { PspPaymentProcessor } from './psp-payment-processor';
import { PspTopupCallerGuard } from './psp-topup-caller.guard';
import { PspTopupLookup } from './psp-topup-lookup';
import { PspTopupsController } from './psp-topups.controller';
import { PspTopupsService } from './psp-topups.service';

@Module({
  imports: [LifecycleModule, TapsModule, ConfigResolverModule, TenantModule],
  controllers: [PspTopupsController],
  providers: [
    PspTopupsService,
    PspPaymentProcessor,
    PspTopupLookup,
    CardChecks,
    PspTopupCallerGuard,
  ],
  exports: [PspPaymentProcessor, PspTopupLookup],
})
export class PspTopupsModule {}
