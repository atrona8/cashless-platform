// Guichet de retour (mission bracelets-nfc, WP16) : restitution et remise en stock, remplacement, perte et bracelet
// retrouvé, rendu des espèces dues.
import { Module } from '@nestjs/common';
import { OnsiteApprovalModule } from '../../approval/onsite/onsite-approval.module';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { TapsModule } from '../taps/taps.module';
import { CashDueController } from './cash-due.controller';
import { CashDueService } from './cash-due.service';
import { LifecycleModule } from './lifecycle.module';
import { LossController } from './loss.controller';
import { LossService } from './loss.service';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';
import { ReplaceController } from './replace.controller';
import { ReplaceService } from './replace.service';

@Module({
  imports: [TenantModule, TapsModule, LifecycleModule, OnsiteApprovalModule],
  controllers: [ReleaseController, ReplaceController, LossController, CashDueController],
  providers: [ReleaseService, ReplaceService, LossService, CashDueService],
})
export class ReturnModule {}
