// Snapshots hors ligne servis aux terminaux (lot WP15). Aucun port de clé : ce module lit, il ne
// signe ni ne chiffre rien.
import { Module } from '@nestjs/common';
import { OfflineSnapshotsController } from './offline-snapshots.controller';
import { OfflineSnapshotsService } from './offline-snapshots.service';

@Module({
  controllers: [OfflineSnapshotsController],
  providers: [OfflineSnapshotsService],
  exports: [OfflineSnapshotsService],
})
export class OfflineSnapshotsModule {}
