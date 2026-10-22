// Back-office des terminaux (mission 5a, lot WP16) : liste, fiche, suspension, réactivation,
// révocation. Importé par DevicesModule (API publique seule).
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { DeviceAdminController } from './device-admin.controller';
import { DeviceAdminService } from './device-admin.service';

@Module({
  imports: [TenantModule],
  controllers: [DeviceAdminController],
  providers: [DeviceAdminService],
})
export class DeviceAdminModule {}
