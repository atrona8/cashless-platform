// Clés de signature des snapshots dans la commande d'administration : création de la clé par KeyAdminPort et
// rotation déclenchée par l'exploitant (`--once` avec SNAPSHOT_KEY_ROTATE_ACTOR).
import { Module } from '@nestjs/common';
import { SnapshotKeyAdminWorker } from './snapshot-key-admin.worker';
import { SnapshotKeyRotation } from './snapshot-key-rotation.service';

@Module({
  providers: [SnapshotKeyRotation, SnapshotKeyAdminWorker],
  exports: [SnapshotKeyRotation],
})
export class SnapshotKeysModule {}
