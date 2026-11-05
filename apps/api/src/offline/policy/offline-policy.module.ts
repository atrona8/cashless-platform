// Politique hors ligne (lot WP14). `AuditModule` est global ; `TenantModule` fournit
// `TenantAccess`.
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { OfflinePolicyController } from './offline-policy.controller';
import { OfflinePolicyService } from './offline-policy.service';

@Module({
  imports: [TenantModule],
  controllers: [OfflinePolicyController],
  providers: [OfflinePolicyService],
})
export class OfflinePolicyModule {}
