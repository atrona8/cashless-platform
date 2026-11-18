// Étapes de clôture et soldes restants (mission 9b, lot WP07). Importé par AppModule.
import { Module } from '@nestjs/common';
import { SqlConfigResolver } from '../configuration/sql-config-resolver';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { EventsModule } from '../events/events.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { ClosingController } from './closing.controller';
import { ClosingStepService } from './closing-steps.service';
import { RemainingBalancesService } from './remaining-balances.service';

@Module({
  imports: [ConfigResolverModule, TenantModule, EventsModule],
  controllers: [ClosingController],
  providers: [SqlConfigResolver, ClosingStepService, RemainingBalancesService],
})
export class ClosingModule {}
