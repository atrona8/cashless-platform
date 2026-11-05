// FAUX processeur d'opérations pour les tests de la réception des lots (lot WP18). `isFake = true` : la garde de
// production (`OfflineProcessorGuard`, `assertProcessIsSafe`) refuse de démarrer en production si elle le trouve.
// Il inscrit, pour chaque opération et dans SA transaction, un numéro au registre et un résultat sans effet comptable
// (comme `VOID` / `ONLINE_NOT_EXECUTED`) ; `TOPUP_CASH` est rejeté (`OFFLINE_NOT_ALLOWED`), jamais exécuté. Il compte
// ses appels et peut lever, attendre ou rendre un numéro « à réessayer » (trace RETRY, ADR-139).
import { Injectable } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { deviceKey } from '../../idempotency/device-key';
import type {
  BatchContext,
  OfflineOperationProcessor,
  OperationResult,
  ParsedOperation,
} from './batch.types';

export interface FakeProcessorBehavior {
  /** Lève à ce numéro (une seule fois si `failOnce`). */
  failAt?: bigint;
  failOnce?: boolean;
  /** Attend cette promesse avant de traiter (tient le verrou du lot). */
  gate?: Promise<void>;
  /** Numéros rendus `REJECTED INSUFFICIENT_FUNDS_RETRY` (trace RETRY, rien au registre). */
  retrySeqs?: bigint[];
  /** Ne passe pas par `record_offline_op_result` : le résultat n'est rendu que par le retour de `process`. */
  skipResultRow?: boolean;
}

@Injectable()
export class FakeOperationProcessor implements OfflineOperationProcessor {
  readonly isFake = true;
  readonly calls: Array<{ batchId: string; seq: bigint; type: string }> = [];
  behavior: FakeProcessorBehavior = {};
  private failed = false;

  constructor(private readonly tx: TenantTx) {}

  reset(behavior: FakeProcessorBehavior = {}): void {
    this.calls.length = 0;
    this.failed = false;
    this.behavior = behavior;
  }

  async process(ctx: BatchContext, op: ParsedOperation): Promise<OperationResult> {
    this.calls.push({ batchId: ctx.batchId, seq: op.seq, type: op.type });
    if (this.behavior.gate) await this.behavior.gate;
    const b = this.behavior;
    if (b.failAt === op.seq && (!b.failOnce || !this.failed)) {
      this.failed = true;
      throw new Error('panne simulée du processeur');
    }
    const base = { seq: Number(op.seq), idempotency_key: deviceKey(ctx.serial, op.seq) };
    return this.tx.run(ctx.operatorId, async (client) => {
      await client.query("SELECT lock_device($1, 'UPDATE')", [ctx.deviceId]);
      await ctx.assertProcessing?.(client);
      let result: OperationResult;
      if (b.retrySeqs?.includes(op.seq)) {
        await client.query('SELECT record_offline_retry($1, $2, $3)', [
          ctx.batchId,
          op.seq.toString(),
          'INSUFFICIENT_FUNDS_RETRY',
        ]);
        result = {
          ...base,
          status: 'REJECTED',
          reject_reason: 'INSUFFICIENT_FUNDS_RETRY',
          effect: 'NONE',
          retryable: true,
        };
      } else {
        const topup = op.type === 'TOPUP_CASH';
        await client.query(
          `SELECT record_device_seq($1, $2, $3, $4, 'BATCH', NULL::uuid, $5, $6)`,
          [
            ctx.deviceId,
            op.seq.toString(),
            op.contentSha256,
            topup ? 'REJECTED' : 'VOID',
            topup ? 'OFFLINE_NOT_ALLOWED' : 'ONLINE_NOT_EXECUTED',
            ctx.batchId,
          ],
        );
        result = topup
          ? {
              ...base,
              status: 'REJECTED',
              reject_reason: 'OFFLINE_NOT_ALLOWED',
              effect: 'NONE',
              retryable: false,
              detail: 'TOPUP_CASH',
            }
          : { ...base, status: 'ACCEPTED', effect: 'NONE', retryable: false };
      }
      if (!b.skipResultRow)
        await client.query('SELECT record_offline_op_result($1, $2, $3::jsonb)', [
          ctx.batchId,
          op.seq.toString(),
          JSON.stringify(result),
        ]);
      return result;
    });
  }
}
