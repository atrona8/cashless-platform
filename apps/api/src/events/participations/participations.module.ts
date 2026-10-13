// Participations, points de vente et règles de frais d'événement (mission configuration-parties-evenements, WP10).
// Déclare les portées EVENT et PARTICIPATION des règles de frais et les actions à deux PARTICIPATION_CHANGE et
// FEE_RULE_CHANGE. Importé par EventsModule.
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { FeeRulesController } from './fee-rules.controller';
import { ParticipationApprovalActions } from './participation-approval-actions';
import { ParticipationsController } from './participations.controller';
import { ParticipationsService } from './participations.service';

@Module({
  imports: [TenantModule],
  controllers: [ParticipationsController, FeeRulesController],
  providers: [ParticipationsService, ParticipationApprovalActions],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
