// Autorité de débit côté humains et refus de débit (mission passerelle-locale, lot WP11). Importé par AppModule
// (API publique seule). `ApprovalModule` est global : l'action `FORCE_CENTRAL_AUTHORITY` s'y enregistre.
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { DebitAuthorityController } from './debit-authority.controller';
import { DebitAuthorityService } from './debit-authority.service';
import { ForceCentralActions } from './force-central.approval';

@Module({
  imports: [TenantModule],
  controllers: [DebitAuthorityController],
  providers: [DebitAuthorityService, ForceCentralActions],
})
export class DebitAuthorityModule {}
