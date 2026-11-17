// Versements (mission 9b, lot WP08). Importé par AppModule (API publique) ; `ApprovalModule` est
// global.
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { EntitlementService } from './entitlements';
import { PayoutBatchesController } from './payout-batches.controller';
import { PayoutActions } from './payout-action';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [TenantModule],
  controllers: [PayoutBatchesController, PayoutsController],
  providers: [EntitlementService, PayoutActions, PayoutsService],
})
export class PayoutsModule {}
