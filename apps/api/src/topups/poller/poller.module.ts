// Travailleurs du processus `psp-poller` (mission 6, lot WP12, T062 et T063). Chaque travailleur s'enregistre dans le
// registre du processus (ProcessBaseModule). Le traitement d'un paiement est celui de WP11 (PspPaymentProcessor), mais
// ce processus n'a ni route ni garde d'identité : il déclare les seuls fournisseurs du processeur au lieu d'importer
// PspTopupsModule (dont les gardes de terminal et de festivalier n'ont pas de sens ici).
import { Module } from '@nestjs/common';
import { ConfigResolverModule } from '../../configuration/config-resolver.module';
import { ConfigurationCoreModule } from '../../configuration/configuration-core.module';
import { DepositService } from '../../media/lifecycle/deposit.service';
import { EventDispatcher } from '../../webhooks/event-dispatcher';
import { CardChecks } from '../psp/card-checks';
import { PspPaymentProcessor } from '../psp/psp-payment-processor';
import { PspTopupLookup } from '../psp/psp-topup-lookup';
import { PspEventPurgeWorker } from './psp-event-purge.worker';
import { PspEventRetryWorker } from './psp-event-retry.worker';
import { PspTopupPollerWorker } from './psp-topup-poller.worker';

@Module({
  imports: [ConfigurationCoreModule, ConfigResolverModule],
  providers: [
    PspTopupLookup,
    CardChecks,
    DepositService,
    PspPaymentProcessor,
    EventDispatcher,
    PspTopupPollerWorker,
    PspEventRetryWorker,
    PspEventPurgeWorker,
  ],
})
export class PspPollerModule {}
