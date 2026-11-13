// Module des lots hors ligne et de la clé de bracelet (WP23). Branché dans `processes/gateway.module.ts`
// (une ligne `imports`). Dépend de `DeviceModule` (preuves, idempotence), de la file (`EDGE_QUEUE`, WP20) et
// de l'autorité (`AUTHORITY`, WP17), tous globaux ou exportés.
import { Module } from '@nestjs/common';
import { DeviceModule } from '../../device/device.module';
import { MediaAuthKeyService } from './media-auth-key.service';
import { OfflineBatchesController } from './offline-batches.controller';
import { OfflineBatchesService } from './offline-batches.service';
import { PackKeyReader } from './pack-key-reader';

@Module({
  imports: [DeviceModule],
  controllers: [OfflineBatchesController],
  providers: [OfflineBatchesService, MediaAuthKeyService, PackKeyReader],
  exports: [PackKeyReader, OfflineBatchesService, MediaAuthKeyService],
})
export class OfflineModule {}
