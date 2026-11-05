// Annulation hors ligne (contracts/batches.md, étape 9 ; T080) : contre-passation exacte de la vente visée (moteur
// `REVERSAL`, source `OFFLINE_SYNC`, part `S-ATTENTE` comprise), attribution datée, puis réduction de l'anomalie
// `OFFLINE_SHORTFALL` de la vente par la VRAIE transaction d'annulation.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import { isSqlError } from '../../errors/sqlstate-map';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { engineOptions, type BatchContext } from '../batches/batch.types';
import type { ReversalTargetFacts, TerminalFacts } from './compliance-input.reader';
import type { OperationFields } from './operation-input';
import { reduceShortfallOfReversedSale } from './shortfall-reduction';
import { inSavepoint } from './savepoint';

export interface ReversalWriteArgs {
  ctx: BatchContext;
  key: string;
  terminal: TerminalFacts;
  fields: OperationFields;
  target: ReversalTargetFacts;
  occurredAt: Date;
  deviceOccurredAt: string | null;
  approverId: string | null;
}

export type ReversalWriteResult =
  | { kind: 'WRITTEN'; transactionId: string; reducedShortfall: bigint }
  /** La vente a été annulée entre la lecture et l'écriture (autre lot du même terminal). */
  | { kind: 'ALREADY_REVERSED' };

@Injectable()
export class OfflineReversalWriter {
  constructor(private readonly engine: LedgerEngineService) {}

  async write(client: TxClient, a: ReversalWriteArgs): Promise<ReversalWriteResult> {
    const { ctx, fields } = a;
    let transactionId: string;
    try {
      transactionId = await inSavepoint(client, async () => {
        const result = await this.engine.execute(
          client,
          {
            type: 'REVERSAL',
            source: 'OFFLINE_SYNC',
            idempotencyKey: a.key,
            occurredAt: a.occurredAt,
            ledgerId: ctx.ledgerId,
            eventId: a.terminal.eventId!,
            currency: a.terminal.ledgerCurrency,
            deviceId: ctx.deviceId,
            ...(a.target.mediaId ? { mediaId: a.target.mediaId } : {}),
            reversesId: a.target.transactionId,
            ...(a.approverId !== null ? { approvedBy: a.approverId } : {}),
            payload: {},
            metadata: {
              vendor_session_id: fields.vendorSessionId,
              batch_id: ctx.batchId,
              ...(a.deviceOccurredAt !== null ? { device_occurred_at: a.deviceOccurredAt } : {}),
            },
          },
          engineOptions(ctx),
        );
        if (!result.transactionId || result.replayed)
          throw new Error(
            'annulation hors ligne : la clé existait déjà au journal (traité en amont)',
          );
        return result.transactionId;
      });
    } catch (error) {
      // Seconde annulation de la même vente : `CL035` ou la contrainte « une seule annulation ».
      if (
        isSqlError(error) &&
        (error.code === 'CL035' || error.constraint === 'journal_transaction_reverses_once')
      )
        return { kind: 'ALREADY_REVERSED' };
      throw error;
    }
    if (fields.vendorSessionId === null)
      throw new Error('annulation hors ligne sans session de vendeur');
    await client.query('SELECT record_sale_attribution_at($1, $2, NULL, $3, $4)', [
      transactionId,
      fields.vendorSessionId,
      a.approverId,
      a.occurredAt,
    ]);
    const reducedShortfall = await reduceShortfallOfReversedSale(
      client,
      a.target.transactionId,
      transactionId,
    );
    return { kind: 'WRITTEN', transactionId, reducedShortfall };
  }
}
