// Battement de cœur des terminaux (lot WP17).
import { Module } from '@nestjs/common';
import { DeviceConfigModule } from '../config/device-config.module';
import { HeartbeatController } from './heartbeat.controller';

@Module({ imports: [DeviceConfigModule], controllers: [HeartbeatController] })
export class HeartbeatModule {}
