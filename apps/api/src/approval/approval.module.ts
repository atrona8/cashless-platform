// Double validation au back-office (mission identite-roles, WP08). Global : les modules des missions suivantes
// créent leurs demandes par ApprovalService.request et enregistrent leurs actions (registerApprovalActions).
import { Global, Module } from '@nestjs/common';
import { ApprovalActionRegistry } from './action-registry';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

@Global()
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalActionRegistry, ApprovalService],
  exports: [ApprovalActionRegistry, ApprovalService],
})
export class ApprovalModule {}
