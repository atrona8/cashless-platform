// Traitement d'une opération d'un lot (mission 7, lot WP19) : fournit le VRAI processeur sous le jeton
// `OFFLINE_OPERATION_PROCESSOR` (WP18). Le faux processeur de test reste interdit en production
// (`OfflineProcessorGuard`, `assertProcessIsSafe`).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../../configuration/config-resolver.module';
import { PaymentsModule } from '../../payments/payments.module';
import { TapsModule } from '../../media/taps/taps.module';
import { AnomalyWriter } from '../anomalies/anomaly-writer';
import { OFFLINE_OPERATION_PROCESSOR } from '../batches/batch.types';
import { ComplianceInputReader } from './compliance-input.reader';
import { OfflineOperationProcessorService } from './offline-operation.processor';
import { OfflineReversalWriter } from './offline-reversal.writer';
import { OfflineSaleWriter } from './offline-sale.writer';

@Module({
  imports: [ConfigResolverModule, PaymentsModule, TapsModule],
  providers: [
    AnomalyWriter,
    ComplianceInputReader,
    OfflineSaleWriter,
    OfflineReversalWriter,
    OfflineOperationProcessorService,
    { provide: OFFLINE_OPERATION_PROCESSOR, useExisting: OfflineOperationProcessorService },
  ],
  exports: [OFFLINE_OPERATION_PROCESSOR, OfflineOperationProcessorService],
})
export class OfflineProcessingModule {}
