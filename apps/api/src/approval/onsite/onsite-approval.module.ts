// Jeton d'approbation sur place : garde appliquée par @RequiresOnsiteApproval (module importé par ApprovalModule).
import { Module } from '@nestjs/common';
import { OnsiteApprovalGuard } from './onsite-approval';

@Module({ providers: [OnsiteApprovalGuard], exports: [OnsiteApprovalGuard] })
export class OnsiteApprovalModule {}
