// Module racine de la passerelle. SEUL point où les modules des lots suivants se branchent : chaque
// lot ajoute UNE
// ligne d'import dans `imports` (retouche hors carte, une ligne dans son rapport, interfaces.md §
// 11).
// Fournit : configuration, pool unique, `GatewayTx`, horloge, port matériel, enrôlement, et la
// garde « route non
// marquée » (404 hors des 16 opérations).
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GATEWAY_CONFIG, loadConfig, type GatewayConfig } from '../config/config';
import { GATEWAY_CLOCK, GatewayClockService } from '../clock/gateway-clock';
import { createGatewayPool, GATEWAY_POOL, type GatewayPool } from '../db/pool';
import { GatewayTx } from '../db/gateway-tx';
import { AuthorityModule } from '../authority/authority.module';
import { ReplicationModule } from '../replication/replication.module';
import { DeviceModule } from '../device/device.module';
import { QueueModule } from '../queue/queue.module';
import { SalesModule } from '../operations/sales/sales.module';
import { StaffModule } from '../staff/staff.module';
import { CounterModule } from '../operations/counter/counter.module';
import { OfflineModule } from '../operations/offline/offline.module';
import { PurgeModule } from '../purge/purge.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { createHardwareKeystore } from '../key-store/hardware-keystore.factory';
import { HARDWARE_KEYSTORE } from '../key-store/hardware-keystore.port';
import { ServedOperationGuard } from './served-operations';

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(GATEWAY_POOL) private readonly pool: GatewayPool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  imports: [
    AuthorityModule, // WP17
    ReplicationModule, // WP18
    DeviceModule, // WP19
    QueueModule, // WP20
    SalesModule, // WP21
    StaffModule, // WP22
    CounterModule, // WP22
    OfflineModule, // WP23
    SnapshotsModule, // WP23
    PurgeModule, // WP24
    // Un lot suivant ajoute ici sa ligne : `XxxModule,`
  ],
  providers: [
    { provide: GATEWAY_CONFIG, useFactory: (): GatewayConfig => loadConfig() },
    {
      provide: GATEWAY_POOL,
      inject: [GATEWAY_CONFIG],
      useFactory: (config: GatewayConfig): GatewayPool => createGatewayPool(config.databaseUrl),
    },
    {
      provide: HARDWARE_KEYSTORE,
      inject: [GATEWAY_CONFIG],
      useFactory: (config: GatewayConfig) => createHardwareKeystore(config),
    },
    PoolShutdown,
    GatewayTx,
    GatewayClockService,
    { provide: GATEWAY_CLOCK, useExisting: GatewayClockService },
    EnrollmentService,
    { provide: APP_GUARD, useClass: ServedOperationGuard },
  ],
  exports: [
    GATEWAY_CONFIG,
    GATEWAY_POOL,
    HARDWARE_KEYSTORE,
    GatewayTx,
    GatewayClockService,
    GATEWAY_CLOCK,
    EnrollmentService,
  ],
})
export class GatewayModule {}
