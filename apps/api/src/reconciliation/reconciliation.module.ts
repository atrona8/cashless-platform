// Relevés et rapprochement des comptes d'argent (mission 9b, WP09) : routes 10 à 13.
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CsvBodyMiddleware } from '../media/batches/csv-body.middleware';
import { TenantModule } from '../organization/tenant/tenant.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';

@Module({
  imports: [TenantModule],
  controllers: [StatementsController, ReconciliationController],
  providers: [StatementsService, ReconciliationService],
})
export class ReconciliationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsvBodyMiddleware).forRoutes(StatementsController);
  }
}
