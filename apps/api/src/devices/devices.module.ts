// Terminaux (mission identite-enrolement-terminaux) : enrôlement, jetons, configuration servie,
// back-office. Importé par l'API publique seule (app.module.ts) ; chaque lot de routes y ajoute une
// ligne d'import.
import { Module } from '@nestjs/common';
import { AttestationModule } from '../attestation/attestation.module';
import { DeviceConfigModule } from './config/device-config.module';
import { EnrollmentCodesModule } from './enrollment-codes/enrollment-codes.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { DeviceTokenRefreshModule } from './tokens/tokens.module';
import { DeviceAdminModule } from './admin/device-admin.module';
import { OfflineSnapshotsModule } from '../offline/snapshots/offline-snapshots.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';

@Module({
  imports: [
    // Les purges des nonces et des essais d'enrôlement sont au processus `maintenance` (WP10, OP-N75).
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
    // Mission 7, lot WP15 : snapshots hors ligne servis et accusés.
    OfflineSnapshotsModule,
  ],
})
export class DevicesModule {}
