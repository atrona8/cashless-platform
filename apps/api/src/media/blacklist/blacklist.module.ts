// Liste noire d'un bracelet et sa sortie à deux (action `REINSTATE_MEDIA`).
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { BlacklistApprovalActions } from './blacklist-approval-actions';
import { BlacklistController } from './blacklist.controller';
import { BlacklistService } from './blacklist.service';

@Module({
  imports: [TenantModule],
  controllers: [BlacklistController],
  providers: [BlacklistService, BlacklistApprovalActions],
})
export class BlacklistModule {}
