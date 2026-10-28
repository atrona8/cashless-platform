// Configurations PSP et choix par événement (mission 6, lot WP10). Importé par AppModule (API publique seule).
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { EventPspSelectionActions } from './event-psp-selection-action';
import { EventPspSelectionController } from './event-psp-selection.controller';
import { EventPspSelectionService } from './event-psp-selection.service';
import { PspConfigurationActions } from './psp-configuration-action';
import { PspConfigurationsController } from './psp-configurations.controller';
import { PspConfigurationsService } from './psp-configurations.service';
import { PspFeeScope } from './psp-fee-scope';

@Module({
  imports: [TenantModule],
  controllers: [PspConfigurationsController, EventPspSelectionController],
  providers: [
    PspConfigurationsService,
    PspConfigurationActions,
    EventPspSelectionService,
    EventPspSelectionActions,
    PspFeeScope,
  ],
})
export class PspConfigurationsModule {}
