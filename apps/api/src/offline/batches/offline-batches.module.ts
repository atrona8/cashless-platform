// Réception des lots hors ligne (mission 7, lot WP18) : contrôleur, service, boucle et pool de verrous dédié.
// Le processeur d'une opération est injecté par `OFFLINE_OPERATION_PROCESSOR` : le vrai (`OfflineProcessingModule`,
// WP19). Un faux (`isFake`) hors test fait refuser le démarrage en production (`OfflineProcessorGuard`, et `assertProcessIsSafe`).
import { Inject, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { assertNoFakeInProduction } from '../../kms/production-guard';
import { BatchLockPool } from './batch-lock-pool';
import { BatchRunner } from './batch-runner';
import {
  OFFLINE_BATCH_LOCK,
  OFFLINE_OPERATION_PROCESSOR,
  type OfflineOperationProcessor,
} from './batch.types';
import { OfflineBatchesController } from './offline-batches.controller';
import { OfflineBatchesService } from './offline-batches.service';
import { OfflineProcessingModule } from '../processing/offline-processing.module';

/** Refuse de démarrer en production si le processeur injecté est un faux (règle 2 du porteur, NFR-010). */
@Injectable()
export class OfflineProcessorGuard {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(OFFLINE_OPERATION_PROCESSOR) processor: OfflineOperationProcessor,
  ) {
    assertNoFakeInProduction(config.production, {
      'le processeur d’opérations hors ligne': processor,
    });
  }
}

@Module({
  imports: [OfflineProcessingModule],
  controllers: [OfflineBatchesController],
  providers: [
    OfflineBatchesService,
    BatchRunner,
    {
      provide: OFFLINE_BATCH_LOCK,
      useFactory: (config: AppConfig) => new BatchLockPool(config),
      inject: [APP_CONFIG],
    },
    OfflineProcessorGuard,
  ],
  // WP20 : le travailleur d'import réutilise la boucle d'un lot et le pool de verrous dédié.
  exports: [OfflineProcessingModule, BatchRunner, OFFLINE_BATCH_LOCK],
})
export class OfflineBatchesModule {}
