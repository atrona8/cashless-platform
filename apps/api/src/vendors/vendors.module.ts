// Vendeurs et sessions de vendeur (mission 5b, lot WP09) : back-office, routes de terminal et garde
// de session (`VendorSessionGuard`, exportée pour les ventes, annulations et demandes QR).
// Importé par AppModule (API publique seule).
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { VendorPinModule } from '../vendor-pin/vendor-pin.module';
import { SessionLock } from '../db/session-lock';
import { VendorSessionGuard } from './vendor-session-guard';
import { VendorSessionsController } from './vendor-sessions.controller';
import { VendorSessionsService } from './vendor-sessions.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [TenantModule, VendorPinModule],
  controllers: [VendorsController, VendorSessionsController],
  providers: [SessionLock, VendorsService, VendorSessionsService, VendorSessionGuard],
  exports: [VendorSessionGuard],
})
export class VendorsModule {}
