// Processus « maintenance » (mission hors-ligne-snapshots-lots, WP10, OP-N75) : purges des nonces de requête et des
// essais d'enrôlement des terminaux. Aucune route, des travailleurs lancés une fois (`--once`) ou à intervalle.
// Aucun port de clé (pas de KmsModule), aucun accès aux données métier : pool du rôle `cashless_maint` seul
// (db/maintenance-db.module.ts), sans PlatformTx. Mission 9b (WP12) : scellement, contrôles permanents et alertes.
import { Module } from '@nestjs/common';
import { MaintenanceDbModule } from '../db/maintenance-db.module';
import { DeviceMaintenanceModule } from '../device-identity/device-maintenance';
import { EdgeMaintenanceModule } from '../edge/maintenance/edge-maintenance.module';
import { SealingModule } from '../sealing/sealing.module';
import { ControlsModule } from './controls/controls.module';
import { RefundPromotionMaintenanceModule } from './maintenance-refund-promotion';
import { ProcessBaseModule } from './process-base';

@Module({
  imports: [
    MaintenanceDbModule,
    ProcessBaseModule,
    // Mission 9b (WP12) : transactions longues d'abord (cadence de 10 s), puis contrôles et scellement.
    ControlsModule,
    SealingModule,
    DeviceMaintenanceModule,
    EdgeMaintenanceModule,
    RefundPromotionMaintenanceModule,
  ],
})
export class MaintenanceProcessModule {}
