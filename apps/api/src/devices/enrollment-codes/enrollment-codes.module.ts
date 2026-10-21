// Codes d'enrôlement des terminaux (lot WP14), dans l'API publique.
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { EnrollmentCodesController } from './enrollment-codes.controller';
import { EnrollmentCodesService } from './enrollment-codes.service';

@Module({
  imports: [TenantModule],
  controllers: [EnrollmentCodesController],
  providers: [EnrollmentCodesService],
})
export class EnrollmentCodesModule {}
