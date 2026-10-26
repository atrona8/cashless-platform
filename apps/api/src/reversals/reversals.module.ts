// Annulation d'une vente (mission 5b, lot WP12) : `reversePayment` (vendeur de la vente, ou `SUPERVISOR` au terminal
// par jeton sur place) et l'action à deux personnes `SALE_REVERSAL` du back-office. Importé par AppModule (API
// publique seule). Réutilise sans les modifier le registre des numéros (WP11), la garde de session de vendeur (WP09)
// et le moteur d'écritures.
import { Module } from '@nestjs/common';
import { DeviceOnsiteApprovalGuard } from '../approval/onsite/device-onsite-approval';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { PaymentsModule } from '../payments/payments.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ReversalsController } from './reversals.controller';
import { ReversalService } from './reversal.service';
import { SaleReversalActions } from './sale-reversal-action';

@Module({
  imports: [ConfigResolverModule, TenantModule, PaymentsModule, VendorsModule],
  controllers: [ReversalsController],
  providers: [ReversalService, SaleReversalActions, DeviceOnsiteApprovalGuard],
})
export class ReversalsModule {}
