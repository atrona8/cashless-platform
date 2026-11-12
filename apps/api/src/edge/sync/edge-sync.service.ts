// Réception d'un lot `EDGE_SYNC` (WP13 ; edge-routes.md `submitEdgeSyncBatch` ; R-08, R-09, R-12,
// R-13).
// Ordre, un échec arrête tout AVANT toute écriture : (1) taille et forme ; (2) identifiants du
// corps = ceux de la
// garde ; (3) `Idempotency-Key` = `batch_id` ; (4) signature de la passerelle ; (5) numéros,
// chaîne recalculée et
// comparée à celle du central ; (6) audit des jetons ; (7) lots de terminal relayés. Puis
// `edge_sync_batch_begin`
// (idempotence, un lot en vol), l'audit, les opérations une à une (une transaction chacune),
// `edge_sync_batch_finish`.
// L'époque est contrôlée par les enveloppes SQL (`STALE_AUTHORITY_EPOCH`, sauf vidange
// `RELEASING`). Reprise après arrêt
// du central : même `batch_id`, reprise à la première opération sans résultat. Rien d'un contenu
// d'opération ni d'une
// signature n'est journalisé (identifiants et compteurs seulement).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemException } from '../../errors/problem';
import type { OfflineBatchResult, OperationResult } from '../../offline/batches/batch.types';
import { isSqlError } from '../../errors/sqlstate-map';
import { EdgeTx } from '../edge-tx';
import type { EdgeGateway } from '../auth/edge-gateway';
import { verifyDeviceBatches } from './device-batches.verifier';
import { parseEdgeBatch, type ParsedEdgeBatch, type ParsedEdgeOp } from './edge-sync-body';
import {
  EDGE_SYNC_CENTRAL,
  type CentralAudit,
  type EdgeSyncCentral,
  type StoredResult,
} from './edge-sync-central.port';
import { verifyEdgeChain } from './edge-sync-chain';
import { isGatewaySignatureValid, requestSha256 } from './edge-sync-signature';
import { EdgeSyncWriter, originKeyOf, type OpResult, type Prepared } from './edge-sync.writer';
import { staffTokenRows } from './staff-token-audit';

export interface SubmitArgs {
  rawBody: Buffer | undefined;
  tooLarge: boolean;
  idempotencyKey: string | undefined;
}

export interface SubmitOutcome {
  body: OfflineBatchResult;
  replayed: boolean;
}

const MAX_TX_RETRIES = 3;

@Injectable()
export class EdgeSyncService {
  private readonly logger = new Logger('EdgeSync');
  /**
   * Lots en cours de traitement dans CE processus (un même lot rejoué en parallèle attend le
   * premier).
   */
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly tx: EdgeTx,
    private readonly writer: EdgeSyncWriter,
    @Inject(EDGE_SYNC_CENTRAL) private readonly central: EdgeSyncCentral,
  ) {}

  async submit(gateway: EdgeGateway, args: SubmitArgs): Promise<SubmitOutcome> {
    const batch = parseEdgeBatch(args.rawBody, args.tooLarge);
    // Passerelle ou grand livre du corps différents de la garde : jamais « autre passerelle »
    // (NFR-011).
    if (
      batch.gatewayId !== gateway.gatewayId ||
      gateway.ledgerId === null ||
      batch.ledgerId !== gateway.ledgerId
    )
      throw new ProblemException('HANDOVER_INVALID_STATE');
    if (args.idempotencyKey?.toLowerCase() !== batch.batchId)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Idempotency-Key doit égaler batch_id.',
      });
    const key = `${gateway.gatewayId}:${batch.batchId}`;
    while (this.running.has(key)) await this.running.get(key)!.catch(() => undefined);
    const work = this.process(gateway, batch);
    this.running.set(key, work);
    try {
      return await work;
    } finally {
      this.running.delete(key);
    }
  }

  private async process(gateway: EdgeGateway, batch: ParsedEdgeBatch): Promise<SubmitOutcome> {
    if (!isGatewaySignatureValid(batch, gateway.publicKey)) {
      await this.alert(gateway, 'EDGE_BATCH_SIGNATURE_INVALID', batch.batchId, {});
      throw new ProblemException('BATCH_SIGNATURE_INVALID');
    }
    const cursor = await this.central.cursor(gateway);
    let contents: Buffer[];
    try {
      contents = verifyEdgeChain(batch, cursor, gateway.gatewayId).contents;
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'CHAIN_BROKEN')
        await this.alert(gateway, 'EDGE_CHAIN_BROKEN', batch.batchId, {
          detail: error.detail ?? '',
        });
      throw error;
    }
    const staffRows = staffTokenRows(batch);
    const verifiedDevices = await verifyDeviceBatches(gateway, batch, this.central);

    // Décision 51 : la base refuse un lot sans opération qui n'annonce aucun ordre local.
    const rawOrders = batch.raw.local_orders;
    const localOrderCount = Array.isArray(rawOrders) ? rawOrders.length : 0;
    const begin = await this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<{ state: string; already_done: boolean }>(
        'SELECT * FROM edge_sync_batch_begin(' +
          '$1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::bigint, $6::bytea, $7::integer)',
        [
          gateway.gatewayId,
          batch.batchId,
          batch.epoch.toString(),
          batch.from.toString(),
          batch.to.toString(),
          requestSha256(batch),
          localOrderCount,
        ],
      );
      return rows[0]!;
    });
    if (begin.already_done || begin.state === 'ABANDONED')
      return {
        body: await this.response(gateway, batch, begin.state === 'ABANDONED'),
        replayed: begin.already_done,
      };

    if (staffRows.length > 0)
      await this.tx.run(gateway, (client) =>
        client.query('SELECT edge_record_staff_token_audit($1::uuid, $2::uuid, $3::jsonb)', [
          gateway.gatewayId,
          batch.batchId,
          JSON.stringify(staffRows),
        ]),
      );
    for (const order of (batch.raw.local_orders as Array<Record<string, unknown>> | undefined) ??
      [])
      await this.central.audit(gateway, {
        action: 'EDGE_LOCAL_ORDER_RECORDED',
        batchId: batch.batchId,
        detail: order,
      });

    const done = new Set(
      (await this.central.results(gateway, batch.batchId)).map((r) => r.edgeSeq.toString()),
    );
    try {
      for (const [index, op] of batch.operations.entries()) {
        if (done.has(op.edgeSeq.toString())) continue;
        await this.processOperation(gateway, batch, op, contents[index]!, verifiedDevices);
      }
    } catch (error) {
      // Refus de l'époque, de l'ordre ou du handover : aucun effet de plus, le lot se clôt partiel
      // (A29).
      if (isSqlError(error) && ['CL013', 'CL015', 'CL016', 'CL017'].includes(String(error.code)))
        await this.abandon(gateway, batch.batchId);
      throw error;
    }
    await this.tx.run(gateway, (client) =>
      client.query('SELECT edge_sync_batch_finish($1::uuid, $2)', [batch.batchId, 'DONE']),
    );
    this.logger.log(
      `lot ${batch.batchId} : ${batch.operations.length} opération(s), ` +
        `passerelle ${gateway.gatewayId}`,
    );
    return { body: await this.response(gateway, batch, false), replayed: false };
  }

  /** Une opération : une transaction ; `CL007` rejouée une fois ; `40001` et `23505` rejouées. */
  private async processOperation(
    gateway: EdgeGateway,
    batch: ParsedEdgeBatch,
    op: ParsedEdgeOp,
    content: Buffer,
    verifiedDevices: ReadonlySet<string>,
  ): Promise<void> {
    const prepared = await this.writer.prepare(gateway, op, verifiedDevices);
    let cl007 = 0;
    let conflicts = 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.tx.run(gateway, async (client) => {
          const result = await this.writer.callEnvelope(
            client,
            gateway,
            batch,
            op,
            content,
            prepared,
          );
          await this.writer.storeResult(client, batch.batchId, op, result);
        });
        return;
      } catch (error) {
        const code = isSqlError(error) ? String(error.code) : '';
        if (code === 'CL007') {
          cl007 += 1;
          if (cl007 < 2) continue;
          // Second échec : le numéro est consommé sans écriture, résultat réessayable, le vidage
          // continue.
          await this.rejectOnly(
            gateway,
            batch,
            op,
            content,
            prepared,
            'INSUFFICIENT_FUNDS_RETRY',
            'CL007',
          );
          return;
        }
        if ((code === '40001' || code === '40P01') && attempt < MAX_TX_RETRIES) continue;
        if (code === '23505') {
          conflicts += 1;
          if (conflicts < 2) continue;
          // Clé d'origine déjà au registre sous un autre numéro : la passerelle ne reste pas
          // bloquée sur celui-ci.
          await this.rejectOnly(
            gateway,
            batch,
            op,
            content,
            { ...prepared, originKey: `${prepared.originKey}#dup${op.edgeSeq}` },
            'EDGE_REPLAY_FAILED',
            'ORIGIN_KEY_CONFLICT',
          );
          return;
        }
        throw error;
      }
    }
  }

  private async rejectOnly(
    gateway: EdgeGateway,
    batch: ParsedEdgeBatch,
    op: ParsedEdgeOp,
    content: Buffer,
    prepared: Prepared,
    reason: string,
    detail: string,
  ): Promise<void> {
    const result: OpResult = { outcome: 'REJECTED', reason, detail, transactionId: null };
    await this.tx.run(gateway, async (client) => {
      await this.writer.recordSeq(
        client,
        gateway,
        op,
        prepared.originKey,
        content,
        'REJECTED',
        reason,
      );
      await this.writer.storeResult(client, batch.batchId, op, result);
    });
  }

  private async abandon(gateway: EdgeGateway, batchId: string): Promise<void> {
    try {
      await this.tx.run(gateway, (client) =>
        client.query('SELECT edge_sync_batch_finish($1::uuid, $2)', [batchId, 'ABANDONED']),
      );
    } catch (error) {
      this.logger.warn(`lot ${batchId} : clôture partielle impossible (${String(error)})`);
    }
  }

  /**
   * Alerte : ligne d'audit (port) et `pg_notify('edge_alert')` ; jamais bloquante, jamais de
   * contenu.
   */
  private async alert(
    gateway: EdgeGateway,
    action: CentralAudit['action'],
    batchId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    this.logger.warn(`alerte ${action} : passerelle ${gateway.gatewayId}, lot ${batchId}`);
    try {
      await this.central.audit(gateway, { action, batchId, detail });
    } catch (error) {
      this.logger.warn(`audit ${action} impossible (${String(error)})`);
    }
    try {
      await this.tx.run(gateway, (client) =>
        client.query("SELECT pg_notify('edge_alert', $1)", [
          JSON.stringify({ kind: action, gateway_id: gateway.gatewayId, batch_id: batchId }),
        ]),
      );
    } catch (error) {
      this.logger.warn(`notification ${action} impossible (${String(error)})`);
    }
  }

  /**
   * `OfflineBatchResult` bâti des résultats mémorisés : identique au premier envoi et à tout rejeu.
   */
  private async response(
    gateway: EdgeGateway,
    batch: ParsedEdgeBatch,
    abandoned: boolean,
  ): Promise<OfflineBatchResult> {
    const stored = new Map<string, StoredResult>(
      (await this.central.results(gateway, batch.batchId)).map((r) => [r.edgeSeq.toString(), r]),
    );
    const results: OperationResult[] = [];
    const missing: number[] = [];
    for (const op of batch.operations) {
      const row = stored.get(op.edgeSeq.toString());
      if (row === undefined) {
        missing.push(Number(op.edgeSeq));
        continue;
      }
      results.push(toResult(op, row));
    }
    const cursor = await this.central.cursor(gateway);
    const now = new Date().toISOString();
    return {
      batch_id: batch.batchId,
      processed_at: now,
      results,
      contiguous_acked_seq: Number(cursor.contiguousEdgeSeq),
      missing_seqs: abandoned ? missing : [],
      ...(abandoned ? { abandoned: true } : {}),
      server_time: now,
    } as OfflineBatchResult;
  }
}

function toResult(op: ParsedEdgeOp, row: StoredResult): OperationResult {
  const written = row.transactionId !== null && row.outcome !== 'REJECTED';
  const status = row.outcome === 'VOID' ? 'ACCEPTED' : row.outcome;
  return {
    seq: Number(op.raw.seq ?? op.edgeSeq),
    idempotency_key: originKeyOf(op),
    status,
    transaction_id: row.transactionId,
    effect: written ? 'LEDGER_WRITTEN' : 'NONE',
    ...(row.outcome === 'REJECTED' && row.reason !== null ? { reject_reason: row.reason } : {}),
    retryable: row.retryable,
    ...(row.detail !== null ? { detail: row.detail } : {}),
  } as OperationResult;
}
