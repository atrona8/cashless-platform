// Battement de cœur des terminaux (lot WP17).
import { Module } from '@nestjs/common';
import { OfflineSnapshotsModule } from '../../offline/snapshots/offline-snapshots.module';
import { DeviceConfigModule } from '../config/device-config.module';
import { HeartbeatController } from './heartbeat.controller';

@Module({
  imports: [DeviceConfigModule, OfflineSnapshotsModule],
  controllers: [HeartbeatController],
})
export class HeartbeatModule {}
