// Identification des festivaliers (mission 10a, WP05) : `POST /kyc-verifications`. WP06 y ajoutera la révocation.
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { KycController } from './kyc.controller';
import { KycRevocationActions } from './kyc-revocation-action';
import { KycRevocationController } from './kyc-revocation.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [TenantModule],
  controllers: [KycController, KycRevocationController],
  providers: [KycService, KycRevocationActions],
  exports: [KycService],
})
export class KycModule {}
