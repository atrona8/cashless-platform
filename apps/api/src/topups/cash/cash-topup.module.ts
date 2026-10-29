// Recharge en espèces au guichet (mission 6, lot WP09). Importé par AppModule (API publique seule).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../../configuration/config-resolver.module';
import { LifecycleModule } from '../../media/lifecycle/lifecycle.module';
import { TapsModule } from '../../media/taps/taps.module';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { PaymentsModule } from '../../payments/payments.module';
import { CashTopupController } from './cash-topup.controller';
import { CashTopupService } from './cash-topup.service';

@Module({
  imports: [LifecycleModule, TapsModule, PaymentsModule, ConfigResolverModule, TenantModule],
  controllers: [CashTopupController],
  providers: [CashTopupService],
})
export class CashTopupModule {}
