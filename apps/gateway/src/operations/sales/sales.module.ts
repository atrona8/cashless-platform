// Module des ventes (WP21). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
// Dépend, par des modules globaux, de `AUTHORITY` (WP17), `ReplicationService` (WP18),
// `EDGE_QUEUE` (WP20) ; importe `DeviceModule` (preuves, nonces, idempotence, WP19).
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DeviceModule } from '../../device/device.module';
import { PaymentsService } from './payments.service';
import { ReversalsService } from './reversals.service';
import { SalesController } from './sales.controller';
import { TapsService } from './taps.service';
import { ReleaseMediaRefusal, routeUnavailableOperations } from './unavailable-operations';

@Module({
  imports: [DeviceModule],
  controllers: [SalesController],
  providers: [TapsService, PaymentsService, ReversalsService, ReleaseMediaRefusal],
  exports: [TapsService, PaymentsService],
})
export class SalesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    routeUnavailableOperations(consumer);
  }
}
