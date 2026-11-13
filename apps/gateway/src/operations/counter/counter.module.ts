// Module des opérations de guichet (WP22). Branché dans `processes/gateway.module.ts`.
// Dépend de : `DeviceModule` (preuves de terminal, idempotence), `StaffModule` (jeton de
// personne), `QueueModule` (file, global) et `AuthorityModule` (autorité, global).
// `DEPOSIT_TERMS` (surcharge de test) est facultatif : par défaut les conditions viennent d'`edge_terms`
// répliqué ; inconnues, les chemins qui en dépendent refusent (voir `deposit-terms.ts`).
import { Module } from '@nestjs/common';
import { DeviceModule } from '../../device/device.module';
import { StaffModule } from '../../staff/staff.module';
import { CashTopupService } from './cash-topup.service';
import { CounterController } from './counter.controller';
import { DepositService } from './deposit.service';
import { MediaActivationService } from './media-activation.service';

@Module({
  imports: [DeviceModule, StaffModule],
  controllers: [CounterController],
  providers: [CashTopupService, MediaActivationService, DepositService],
})
export class CounterModule {}
