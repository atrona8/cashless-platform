// Module des snapshots locaux (WP23). Branché dans `processes/gateway.module.ts` (une ligne `imports`).
// Fournit les jetons FACULTATIFS de WP19 : `LOCAL_SNAPSHOT_STATE` (version la plus récente pour un terminal)
// et `GATEWAY_SNAPSHOT_KEYS` (clés publiques de snapshot, `owner = EDGE`) ; sans eux `offline_enabled` reste
// faux. `SnapshotWorker` est démarré par `startGateway` (après migrations, reprise de l'autorité).
import { Global, Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { GATEWAY_SNAPSHOT_KEYS, LOCAL_SNAPSHOT_STATE } from '../device/ports';
import { OfflineModule } from '../operations/offline/offline.module';
import { SnapshotBuilder } from './snapshot-builder';
import { SnapshotSigner } from './snapshot-signer';
import { SnapshotWorker } from './snapshot-worker';
import { SnapshotsController } from './snapshots.controller';
import { SnapshotsService } from './snapshots.service';

// Global : `DeviceConfigService` (DeviceModule) lit ces deux jetons facultatifs.
@Global()
@Module({
  imports: [DeviceModule, OfflineModule],
  controllers: [SnapshotsController],
  providers: [
    SnapshotSigner,
    SnapshotBuilder,
    SnapshotsService,
    SnapshotWorker,
    { provide: GATEWAY_SNAPSHOT_KEYS, useExisting: SnapshotSigner },
    { provide: LOCAL_SNAPSHOT_STATE, useExisting: SnapshotsService },
  ],
  exports: [GATEWAY_SNAPSHOT_KEYS, LOCAL_SNAPSHOT_STATE, SnapshotWorker, SnapshotsService],
})
export class SnapshotsModule {}
