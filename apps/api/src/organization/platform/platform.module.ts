// Routes de plateforme (mission configuration-parties-evenements, WP07) : profils de législation, prestataires,
// contrat et redevances de plateforme, configuration de niveau plateforme, et leurs deux actions à deux personnes.
// Seul module (avec db/, idempotency/ et approval/) à passer par la transaction de la plateforme.
import { Module } from '@nestjs/common';
import { JurisdictionService } from '../../configuration/jurisdiction.service';
import { PlatformConfigController } from '../../configuration/platform-config.controller';
import { JurisdictionController } from './jurisdiction.controller';
import { OperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';
import { PlatformAccess } from './platform-access';
import { PlatformApprovalActions } from './platform-approval-actions';

@Module({
  controllers: [JurisdictionController, OperatorsController, PlatformConfigController],
  providers: [PlatformAccess, OperatorsService, JurisdictionService, PlatformApprovalActions],
  exports: [PlatformAccess, OperatorsService, JurisdictionService],
})
export class PlatformModule {}
