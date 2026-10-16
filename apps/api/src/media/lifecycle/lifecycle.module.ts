// Vie d'un bracelet au guichet et au back-office : activation, caution, consultation.
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../../configuration/config-resolver.module';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { BatchesModule } from '../batches/batches.module';
import { TapsModule } from '../taps/taps.module';
import { ActivationController } from './activation.controller';
import { ActivationService } from './activation.service';
import { CounterAccess } from './counter-access';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { MediaReadController } from './media-read.controller';
import { MediaReadService } from './media-read.service';

@Module({
  imports: [TenantModule, ConfigResolverModule, TapsModule, BatchesModule],
  controllers: [ActivationController, DepositController, MediaReadController],
  providers: [CounterAccess, ActivationService, DepositService, MediaReadService],
  exports: [CounterAccess, DepositService, MediaReadService],
})
export class LifecycleModule {}
