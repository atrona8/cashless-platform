// Module du processus snapshot-content (WP11) : travailleur, accès base restreint aux fonctions du
// rôle, chiffreur.
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { SnapshotCryptoModule } from './crypto/snapshot-crypto.module';
import { SnapshotDraftRepository } from './snapshot-draft.repository';
import {
  defaultOptions,
  SNAPSHOT_CONTENT_OPTIONS,
  SnapshotContentWorker,
} from './snapshot-content.worker';

@Module({
  imports: [SnapshotCryptoModule],
  providers: [
    SnapshotDraftRepository,
    {
      provide: SNAPSHOT_CONTENT_OPTIONS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => defaultOptions(config),
    },
    SnapshotContentWorker,
  ],
})
export class SnapshotContentModule {}
