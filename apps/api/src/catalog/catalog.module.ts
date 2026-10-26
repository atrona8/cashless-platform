// Catalogue d'un point de vente (mission 5b, lot WP10) : back-office (`CatalogController`) et
// catalogue servi aux terminaux (`ServedCatalog`, exporté pour `DeviceConfigModule`).
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ServedCatalog } from './served-catalog';

@Module({
  imports: [TenantModule],
  controllers: [CatalogController],
  providers: [CatalogService, ServedCatalog],
  exports: [ServedCatalog],
})
export class CatalogModule {}
