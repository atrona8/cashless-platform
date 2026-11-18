// Contrôles permanents du processus `maintenance` (mission 9b, WP12 ; FR-021, §12.2). Importé par
// `processes/maintenance.module.ts` seulement. `LongTransactionsWorker` est déclaré EN PREMIER : les travailleurs
// s'enregistrent dans l'ordre des fournisseurs, et la surveillance des transactions longues ne doit pas attendre
// les autres contrôles dans la boucle de 5 secondes.
import { Module } from '@nestjs/common';
import { OpsAlertsModule } from '../ops-alerts';
import { LedgerControlsWorker } from './ledger-controls.worker';
import { LongTransactionsWorker } from './long-transactions.worker';
import { OpenAnomaliesWorker } from './open-anomalies.worker';
import { PayoutOverdueWorker } from './payout-overdue.worker';
import { StatementUnmatchedWorker } from './statement-unmatched.worker';

@Module({
  imports: [OpsAlertsModule],
  providers: [
    LongTransactionsWorker,
    LedgerControlsWorker,
    PayoutOverdueWorker,
    StatementUnmatchedWorker,
    OpenAnomaliesWorker,
  ],
})
export class ControlsModule {}
