// Processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006, C-008 ; OP-N76, ADR-121) : seul
// détenteur du secret des PIN, de la lecture des empreintes et de l'ouverture de session de vendeur.
// Rôle de base : cashless_pin (EXECUTE de begin_vendor_pin_check et open_vendor_session, écriture de
// l'audit des essais, rien d'autre). Aucune garde des personnes : les deux routes sont internes,
// signées par l'API (HMAC), et toute route non marquée est refusée.
// Jamais ici : DeviceIdentityModule, KmsModule, PlatformTx, pool de cashless_app.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { ProcessDbModule } from '../db/process-db.module';
import { HealthModule } from '../health/health.controller';
import { VendorPinServerModule } from '../vendor-pin/vendor-pin-server.module';
import { DenyUnmarkedRoutesGuard, ProcessBaseModule } from './process-base';

@Module({
  imports: [
    ProcessDbModule.forProcess('vendor-pin'),
    ProcessBaseModule,
    HealthModule,
    AuditModule,
    VendorPinServerModule,
  ],
  providers: [
    DenyUnmarkedRoutesGuard,
    { provide: APP_GUARD, useExisting: DenyUnmarkedRoutesGuard },
  ],
})
export class VendorPinProcessModule {}
