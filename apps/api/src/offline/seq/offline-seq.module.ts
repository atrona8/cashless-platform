// Levée de trou de séquence (mission 7, lot WP20, T083) : route, demande et action à deux personnes `WAIVE_SEQ_GAP`.
import { Module } from '@nestjs/common';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { SeqGapController } from './seq-gap.controller';
import { SeqStatusController } from './seq-status.controller';
import { SyncStatusController } from './sync-status.controller';
import { SeqGapService } from './seq-gap.service';
import { WaiveSeqGapActions } from './waive-seq-gap.action';

@Module({
  imports: [TenantModule],
  controllers: [SeqGapController, SeqStatusController, SyncStatusController],
  providers: [SeqGapService, WaiveSeqGapActions],
})
export class OfflineSeqModule {}
