// Écriture d'une vente hors ligne (contracts/batches.md, étapes 9 et 10 ; research R-30.11). Dans la transaction de
// l'opération, terminal déjà verrouillé : moteur `OFFLINE_SYNC` sous SAVEPOINT (`CL007` : trois reprises, le quatrième
// arrête), lignes, attribution datée, `consume_tap`, anomalie `OFFLINE_SHORTFALL`. N'écrit NI le registre NI le
// résultat (le processeur le fait, dans la même transaction).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import { isSqlError } from '../../errors/sqlstate-map';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { TapService } from '../../media/taps/tap.service';
import { AnomalyWriter } from '../anomalies/anomaly-writer';
import { engineOptions, type BatchContext } from '../batches/batch.types';
import { lossBearer } from '../rules/loss-bearer';
import type { ShortfallReason } from '../rules/types';
import type { MediaFacts, TerminalFacts } from './compliance-input.reader';
import type { OperationFields } from './operation-input';
import { inSavepoint } from './savepoint';

/** Reprises après un `CL007` : une tentative plus trois reprises. */
export const MAX_CL007_RETRIES = 3;

export interface WriteDecision {
  covered: bigint;
  shortfallReason?: ShortfallReason;
}

export interface SaleWriteArgs {
  ctx: BatchContext;
  key: string;
  seq: bigint;
  terminal: TerminalFacts;
  fields: OperationFields;
  media: MediaFacts;
  tapId: string | null;
  /** Heure corrigée. */
  occurredAt: Date;
  /** `occurred_at` du terminal, conservé dans `metadata.device_occurred_at` quand l'heure est corrigée. */
  deviceOccurredAt: string | null;
  /** Valideur d'un import (approbateur) ; `null` pour un lot de terminal. */
  approverId: string | null;
  initial: WriteDecision;
  /** Relit les soldes et recalcule la table de conflit (après un `CL007`). */
  decide: () => Promise<WriteDecision>;
}

export type SaleWriteResult =
  | {
      kind: 'WRITTEN';
      transactionId: string;
      covered: bigint;
      shortfall: bigint;
      shortfallReason: ShortfallReason | null;
      anomalyId: string | null;
    }
  | { kind: 'RETRY' };

@Injectable()
export class OfflineSaleWriter {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly taps: TapService,
    private readonly anomalies: AnomalyWriter,
  ) {}

  async write(client: TxClient, a: SaleWriteArgs): Promise<SaleWriteResult> {
    const { ctx, fields } = a;
    const amount = fields.amount!;
    // Lignes : contrôlées par la base AVANT l'écriture. Une ligne hors catalogue ne fait pas perdre la vente (le
    // commerçant est garanti, le montant est exact) : la vente est écrite sans lignes, la raison reste dans la métadonnée.
    let linesOk = false;
    if (fields.lines !== null) {
      try {
        await inSavepoint(client, () =>
          client.query('SELECT check_sale_lines($1, $2::jsonb, $3::bigint)', [
            ctx.deviceId,
            JSON.stringify(fields.lines),
            amount.toString(),
          ]),
        );
        linesOk = true;
      } catch (error) {
        if (!(isSqlError(error) && error.code === 'CL034')) throw error;
      }
    }

    let decision = a.initial;
    let attempt = 0;
    let written: { transactionId: string; shortfall: bigint } | null = null;
    while (written === null) {
      try {
        written = await inSavepoint(client, async () => {
          const result = await this.engine.execute(
            client,
            {
              type: 'PURCHASE',
              source: 'OFFLINE_SYNC',
              idempotencyKey: a.key,
              occurredAt: a.occurredAt,
              ledgerId: ctx.ledgerId,
              eventId: a.terminal.eventId!,
              currency: fields.currency!,
              deviceId: ctx.deviceId,
              mediaId: a.media.mediaId,
              ...(a.approverId !== null ? { approvedBy: a.approverId } : {}),
              payload: {
                walletId: a.media.walletId!,
                participationId: a.terminal.participationId!,
                amount,
                coveredCap: decision.covered,
              },
              metadata: {
                vendor_session_id: fields.vendorSessionId,
                channel: 'NFC',
                batch_id: ctx.batchId,
                ...(a.deviceOccurredAt !== null ? { device_occurred_at: a.deviceOccurredAt } : {}),
                ...(fields.lines !== null && !linesOk ? { lines_status: 'CATALOG_MISMATCH' } : {}),
              },
            },
            engineOptions(ctx),
          );
          if (!result.transactionId || result.replayed)
            throw new Error('vente hors ligne : la clé existait déjà au journal (traité en amont)');
          return { transactionId: result.transactionId, shortfall: result.shortfall ?? 0n };
        });
      } catch (error) {
        if (!(isSqlError(error) && error.code === 'CL007')) throw error;
        attempt += 1;
        if (attempt > MAX_CL007_RETRIES) return { kind: 'RETRY' };
        decision = await a.decide();
      }
    }

    const tx = written.transactionId;
    if (linesOk)
      await client.query('SELECT record_sale_lines($1, $2, $3::jsonb)', [
        tx,
        ctx.deviceId,
        JSON.stringify(
          (fields.lines as Array<Record<string, unknown>>).map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            unit_price: l.unit_price,
          })),
        ),
      ]);
    if (fields.vendorSessionId === null)
      throw new Error('vente hors ligne sans session de vendeur');
    await client.query('SELECT record_sale_attribution_at($1, $2, $3, $4, $5)', [
      tx,
      fields.vendorSessionId,
      'NFC',
      // Une vente n'admet pas de personne (0048) : le valideur d'un import est déjà `approved_by` de l'écriture.
      null,
      a.occurredAt,
    ]);
    if (a.tapId !== null) await this.taps.consume(client, a.tapId, tx);

    const shortfall = written.shortfall;
    let anomalyId: string | null = null;
    if (shortfall > 0n)
      anomalyId = await this.anomalies.open(client, {
        ledgerId: ctx.ledgerId,
        kind: 'OFFLINE_SHORTFALL',
        deviceId: ctx.deviceId,
        mediaId: a.media.mediaId,
        seq: a.seq,
        transactionId: tx,
        amount: shortfall,
        lossBearer: lossBearer(a.terminal.providedBy),
        batchId: ctx.batchId,
      });
    return {
      kind: 'WRITTEN',
      transactionId: tx,
      covered: amount - shortfall,
      shortfall,
      shortfallReason: shortfall > 0n ? (decision.shortfallReason ?? 'INSUFFICIENT_FUNDS') : null,
      anomalyId,
    };
  }
}
