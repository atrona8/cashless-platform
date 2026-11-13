// Module des opérations de terminal du lot 19 (jetons, lectures, idempotence). Branché dans
// `processes/gateway.module.ts` (une ligne `imports`). Fournit `IdempotencyService` et
// `DeviceTokenService` aux lots 20 à 23.
import { Module } from '@nestjs/common';
import { DeviceProofsModule } from '../device-proofs/device-proofs.module';
import { DeviceConfigService } from './device-config.service';
import { DeviceController } from './device.controller';
import { IdempotencyService } from './idempotency.service';
import { DeviceRefreshService } from './refresh.service';

@Module({
  imports: [DeviceProofsModule],
  controllers: [DeviceController],
  providers: [DeviceConfigService, DeviceRefreshService, IdempotencyService],
  exports: [DeviceProofsModule, DeviceConfigService, IdempotencyService],
})
export class DeviceModule {}
