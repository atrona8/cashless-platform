// Gestionnaire des notifications `DISPUTE` (mission 6, lot WP13, T065) : branché sous `PSP_DISPUTE_HANDLER`, la couture
// de WP12 (`EventDispatcher`). Aucune logique ici : tout est dans `ChargebackService`, dans la transaction de l'appelant.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';
import type { NormalizedNotification } from '../psp/psp.types';
import type { DisputeHandler, DispatchOutcome, PspEventRef } from '../webhooks/event-dispatcher';
import { ChargebackService } from './chargeback.service';

@Injectable()
export class PspDisputeHandler implements DisputeHandler {
  constructor(private readonly chargebacks: ChargebackService) {}

  handle(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome> {
    return this.chargebacks.apply(client, event, notification);
  }
}
