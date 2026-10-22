// Terminaux (mission identite-enrolement-terminaux) : enrôlement, jetons, configuration servie,
// back-office. Importé par l'API publique seule (app.module.ts) ; chaque lot de routes y ajoute une
// ligne d'import.
import { Module } from '@nestjs/common';
import { AttestationModule } from '../attestation/attestation.module';
import { DeviceMaintenanceModule } from '../device-identity/device-maintenance';
import { DeviceConfigModule } from './config/device-config.module';
import { EnrollmentCodesModule } from './enrollment-codes/enrollment-codes.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { DeviceTokenRefreshModule } from './tokens/tokens.module';
import { DeviceAdminModule } from './admin/device-admin.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';

@Module({
  imports: [
    // Lot WP12 : purges des nonces et des essais d'enrôlement (travailleur de l'API publique).
    DeviceMaintenanceModule,
    // Lot WP14 : vérificateur d'attestation (lu par la garde de démarrage), codes, enrôlement.
    AttestationModule,
    EnrollmentCodesModule,
    EnrollmentModule,
    // Lot WP15 : rafraîchissement des jetons d'appareil.
    DeviceTokenRefreshModule,
    // Lot WP16 : back-office des terminaux (liste, fiche, suspension, réactivation, révocation).
    DeviceAdminModule,
    // Lot WP17 : configuration servie et battement de cœur.
    DeviceConfigModule,
    HeartbeatModule,
  ],
})
export class DevicesModule {}
