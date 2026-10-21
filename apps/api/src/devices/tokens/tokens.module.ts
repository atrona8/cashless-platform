// Rafraîchissement des jetons d'appareil (lot WP15), dans l'API publique : signataire des jetons
// d'appareil (faux hors production seulement ; la fabrique refuse en production, et la garde de
// démarrage refuse tout faux restant).
import { Module } from '@nestjs/common';
import { DeviceTokensModule } from '../../device-tokens/device-tokens.module';
import { DeviceTokenRefreshController } from './refresh.controller';
import { DeviceTokenRefreshService } from './refresh.service';

@Module({
  imports: [DeviceTokensModule],
  controllers: [DeviceTokenRefreshController],
  providers: [DeviceTokenRefreshService],
})
export class DeviceTokenRefreshModule {}
