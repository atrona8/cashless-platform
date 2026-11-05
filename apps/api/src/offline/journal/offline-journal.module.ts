// Import du journal d'un terminal révoqué (mission 7, lot WP20) : route de demande et de lecture, action à deux
// personnes `DEVICE_JOURNAL_IMPORT` et travailleur `journal-import`. Le traitement des opérations est celui de WP19
// (jeton `OFFLINE_OPERATION_PROCESSOR`, via `BatchRunner`) ; le verrou d'import est le pool dédié de WP18.
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { OfflineBatchesModule } from '../batches/offline-batches.module';
import { JournalImportActions } from './journal-import.action';
import { JournalImportController } from './journal-import.controller';
import { JournalImportService } from './journal-import.service';
import { JournalImportWorker } from './journal-import.worker';

@Module({
  imports: [TenantModule, OfflineBatchesModule],
  controllers: [JournalImportController],
  providers: [JournalImportService, JournalImportActions, JournalImportWorker],
  exports: [JournalImportWorker],
})
export class OfflineJournalModule {}
