// Configuration servie aux terminaux (lot WP17) ; le service sert aussi le battement de cœur. Le
// catalogue servi (`ServedCatalog`) vient de `CatalogModule` (mission 5b, lot WP10), dont les
// routes du
// back-office sont ainsi chargées avec celles des terminaux (API publique seule).
import { Module } from '@nestjs/common';
import { CatalogModule } from '../../catalog/catalog.module';
import { DeviceConfigController } from './device-config.controller';
import { DeviceConfigService } from './device-config.service';

@Module({
  imports: [CatalogModule],
  controllers: [DeviceConfigController],
  providers: [DeviceConfigService],
  exports: [DeviceConfigService],
})
export class DeviceConfigModule {}
