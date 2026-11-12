// Module des preuves de terminal (WP19). Fournit `DeviceProofsGuard`, `NonceStore`,
// `DeviceDirectory` et `DeviceTokenService` aux modules des lots 19 à 23 (une ligne `imports`).
import { Module } from '@nestjs/common';
import { DeviceTokenService } from '../device/device-token.service';
import { DeviceDirectory } from './device-directory';
import { DeviceProofsGuard } from './device-proofs.guard';
import { NonceStore } from './nonce-store';

@Module({
  providers: [DeviceTokenService, DeviceDirectory, NonceStore, DeviceProofsGuard],
  exports: [DeviceTokenService, DeviceDirectory, NonceStore, DeviceProofsGuard],
})
export class DeviceProofsModule {}
