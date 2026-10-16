// Lots de bracelets et codes de rattachement à la commande, dans le processus « public ».
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ClaimHasher } from '../../kms/claim-hash';
import { TenantModule } from '../../organization/tenant/tenant.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { ClaimCodesService } from './claim-codes.service';
import { CsvBodyMiddleware } from './csv-body.middleware';

@Module({
  imports: [TenantModule],
  controllers: [BatchesController],
  providers: [ClaimHasher, BatchesService, ClaimCodesService],
  exports: [BatchesService],
})
export class BatchesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsvBodyMiddleware).forRoutes(BatchesController);
  }
}
