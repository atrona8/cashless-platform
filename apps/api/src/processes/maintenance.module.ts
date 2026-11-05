// Processus « maintenance » (mission hors-ligne-snapshots-lots, WP10, OP-N75) : purges des nonces de requête et des
// essais d'enrôlement des terminaux. Aucune route, des travailleurs lancés une fois (`--once`) ou à intervalle.
// Aucun port de clé (pas de KmsModule), aucun accès aux données métier : pool du rôle `cashless_maint` seul
// (db/maintenance-db.module.ts), sans PlatformTx.
import { Module } from '@nestjs/common';
import { MaintenanceDbModule } from '../db/maintenance-db.module';
import { DeviceMaintenanceModule } from '../device-identity/device-maintenance';
import { ProcessBaseModule } from './process-base';

@Module({ imports: [MaintenanceDbModule, ProcessBaseModule, DeviceMaintenanceModule] })
export class MaintenanceProcessModule {}
