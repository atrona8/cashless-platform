// Remboursements des festivaliers (mission 9a, WP04) : création, listes et refus. WP05 y ajoutera l'approbation et la
// confirmation. Le parcours du titulaire (WP03) vit dans `RefundsHolderModule`, importé ici.
import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { MyRefundRequestsController } from './my-refund-requests.controller';
import { RefundApproveController } from './refund-approve.controller';
import { RefundConfirmService } from './refund-confirm.service';
import { RefundRequestsController } from './refund-requests.controller';
import { RefundRequestsService } from './refund-requests.service';
import { RefundsHolderModule } from './refunds-holder.module';
import { WalletRefundActions } from './wallet-refund-action';

@Module({
  imports: [RefundsHolderModule, CustomerAuthModule, TenantModule, ConfigResolverModule],
  controllers: [MyRefundRequestsController, RefundRequestsController, RefundApproveController],
  providers: [RefundRequestsService, RefundConfirmService, WalletRefundActions],
  exports: [RefundRequestsService],
})
export class RefundsModule {}
