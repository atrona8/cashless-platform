// Fournisseurs du gestionnaire des contestations seul, sans routes ni actions (mission 6, lot WP13) : déclarés par un
// processus qui n'importe pas `ChargebacksModule` (le travailleur de reprise du processus `psp-poller`).
import type { Provider } from '@nestjs/common';
import { PSP_DISPUTE_HANDLER } from '../webhooks/event-dispatcher';
import { ChargebackService } from './chargeback.service';
import { PspDisputeHandler } from './dispute-handler';

export const CHARGEBACK_DISPUTE_PROVIDERS: Provider[] = [
  ChargebackService,
  PspDisputeHandler,
  { provide: PSP_DISPUTE_HANDLER, useExisting: PspDisputeHandler },
];
