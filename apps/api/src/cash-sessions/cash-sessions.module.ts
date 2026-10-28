// Sessions de caisse et dépôt en banque (mission 6, lot WP08). Importé par AppModule (API publique seule).
// `ApprovalModule` est global ; `LifecycleModule` fournit `CounterAccess`.
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../configuration/config-resolver.module';
import { LifecycleModule } from '../media/lifecycle/lifecycle.module';
import { TenantModule } from '../organization/tenant/tenant.module';
import { CashDepositController } from './cash-deposit.controller';
import { CashDepositActions } from './cash-deposit-action';
import { CashSessionReadService } from './cash-session-read.service';
import { CashSessionsController } from './cash-sessions.controller';
import { CashSessionsService } from './cash-sessions.service';
import { EventCashSessionsController } from './event-cash-sessions.controller';

@Module({
  imports: [ConfigResolverModule, TenantModule, LifecycleModule],
  controllers: [CashSessionsController, EventCashSessionsController, CashDepositController],
  providers: [CashSessionsService, CashSessionReadService, CashDepositActions],
})
export class CashSessionsModule {}
