// `submitOfflineBatch` et `getOfflineBatchResult` sur la passerelle (WP23, T103/T104).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (autorité de débit, signature d'origine, chaîne).
//
// Tout le lot est traité dans UNE transaction locale : nonce, idempotence, autorité de débit, signature
// d'origine, chaîne, règles de chaque opération, entrées de file (`EdgeQueue.append`, WP20) et leurs deltas,
// résultats locaux et réponse mémorisée. Un refus annule tout : aucun numéro de file n'est consommé.
// RÈGLE D'AUTORITÉ INVERSÉE par rapport au central (`batch-intake.ts` l.192-195 refuse sous `EDGE`) : la
// passerelle n'accepte un lot que si son état est `ACTIVE` et l'époque égale (`assertCanDebit`) ; `RELEASING`
// et accord non accusé : 409 DEBIT_AUTHORITY_MOVING ; `STALE`/`REVOKED` : 409 STALE_AUTHORITY_EPOCH ;
// `ARMED`/`STANDBY`/`RELEASED` : 409 CONFLICT_STATE (GATEWAY_NOT_AUTHORITY).
// Chaque opération (y compris refusée ou sans effet) devient une entrée `edge_op` (`DEVICE_OFFLINE`, maillon
// de chaîne du TERMINAL, R-12) relayée dans l'ordre ; l'en-tête et la signature d'origine sont rangés dans
// `edge_device_batch` pour être relayés à part. Le central rejoue avec les règles de la mission 7 et reste
// seul juge : un résultat local n'est jamais plus fort que le sien.
import { Inject, Injectable } from '@nestjs/common';
import { chainedContent, contentSha256 } from '@cashless/shared-rules';
import { AUTHORITY, type AuthorityService } from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import type { AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { deviceKey } from '../../device/device-key';
import { IdempotencyService, requestFingerprint } from '../../device/idempotency.service';
import { EDGE_QUEUE, type EdgeQueuePort } from '../../queue/edge-queue';
import { failpoint } from '../../testing/failpoints';
import {
  checkBindings,
  checkContinuity,
  checkSignature,
  MAX_BATCH_BYTES,
  parseBatchShape,
  verifyChain,
  type ParsedBatch,
  type ReceivedOperation,
} from './batch-verifier';
import { OfflineRulesRunner, type LocalVerdict, type RulesEnv } from './offline-rules-runner';
import { withAuthorityProblems } from './problems';

export interface OperationResultBody {
  seq: number;
  idempotency_key: string;
  status: string;
  effect: 'LEDGER_WRITTEN' | 'NONE';
  retryable: boolean;
  transaction_id?: string | null;
  charged_to_wallet?: number;
  shortfall_amount?: number;
  shortfall_reason?: string;
  tap_result?: string;
  reject_reason?: string;
  detail?: string;
}

export interface OfflineBatchResultBody {
  batch_id: string;
  processed_at: string;
  results: OperationResultBody[];
  contiguous_acked_seq: number;
  missing_seqs: number[];
  next_snapshot_version: number | null;
  abandoned: boolean;
  server_time: string;
}

export interface SubmitRequest {
  body: unknown;
  rawBodyLength: number;
  idempotencyKey: string | undefined;
  epochHeader: string | undefined;
  serialHeader: string | undefined;
  path: string;
}

const PROVISIONAL = 'RELAYED_TO_CENTRAL';

export function operationResult(
  serial: string,
  seq: number,
  type: string,
  verdict: LocalVerdict,
): OperationResultBody {
  const base = { seq, idempotency_key: deviceKey(serial, seq), retryable: false };
  if (verdict.status === 'REJECTED') {
    return {
      ...base,
      status: 'REJECTED',
      effect: 'NONE',
      reject_reason: verdict.rejectReason ?? 'MALFORMED_OPERATION',
      ...(verdict.detail.length > 0 ? { detail: verdict.detail.join(',') } : {}),
    };
  }
  // Acceptation PROVISOIRE de la passerelle : la décision comptable est celle du central (effect NONE tant
  // qu'aucun grand livre central n'a écrit).
  return {
    ...base,
    status: verdict.status,
    effect: 'NONE',
    ...(type === 'PURCHASE'
      ? {
          charged_to_wallet: Number(verdict.covered),
          ...(verdict.shortfall > 0n
            ? {
                shortfall_amount: Number(verdict.shortfall),
                shortfall_reason: verdict.shortfallReason ?? 'INSUFFICIENT_FUNDS',
              }
            : {}),
          ...(verdict.tapResult ? { tap_result: verdict.tapResult } : {}),
        }
      : {}),
    detail: PROVISIONAL,
  };
}

/**
 * Décision locale jointe à l'opération relayée au central (`edge_decision`, sync_protocol.md §9.5) :
 * verdict de la passerelle, parts portefeuille et attente, raison. Le central la contrôle (somme,
 * raisons admises) et la rejoue ; sans elle il refuse l'opération (`DECISION_MISSING`). Seule la
 * passerelle la pose : une `edge_decision` portée par le terminal est écartée. Sans montant, pas de
 * décision (le central n'en exige pas).
 */
export function edgeDecisionOf(
  raw: Record<string, unknown>,
  type: string,
  verdict: LocalVerdict,
): Record<string, unknown> | null {
  if (!('amount' in raw) || raw.amount === null || raw.amount === undefined) return null;
  if (verdict.status === 'REJECTED') {
    return {
      status: 'REJECTED',
      charged_to_wallet: 0,
      shortfall_amount: 0,
      reject_reason: verdict.rejectReason ?? 'MALFORMED_OPERATION',
    };
  }
  if (type === 'REVERSAL') {
    return { status: 'ACCEPTED', charged_to_wallet: Number(verdict.amount), shortfall_amount: 0 };
  }
  const short = verdict.shortfall;
  return {
    status: short > 0n ? 'ACCEPTED_WITH_SHORTFALL' : 'ACCEPTED',
    charged_to_wallet: Number(verdict.covered),
    shortfall_amount: Number(short),
    ...(short > 0n ? { shortfall_reason: verdict.shortfallReason ?? 'INSUFFICIENT_FUNDS' } : {}),
  };
}

@Injectable()
export class OfflineBatchesService {
  private readonly rules = new OfflineRulesRunner();

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly authority: Pick<AuthorityService, 'assertCanDebit'>,
    @Inject(EDGE_QUEUE) private readonly queue: EdgeQueuePort,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(NonceStore) private readonly nonces: NonceStore,
  ) {}

  async submit(device: AuthenticatedDevice, req: SubmitRequest): Promise<OfflineBatchResultBody> {
    if (req.rawBodyLength > MAX_BATCH_BYTES) throw new ProblemException('BATCH_TOO_LARGE');
    const batch = parseBatchShape(req.body);
    const result = await withAuthorityProblems(() =>
      this.gatewayTx.run((tx) => this.process(tx, device, req, batch)),
    );
    // Après le COMMIT, avant la réponse (point d'arrêt de reprise, A28).
    await failpoint('after-local-write-before-reply');
    return result;
  }

  private async process(
    tx: TxClient,
    device: AuthenticatedDevice,
    req: SubmitRequest,
    batch: ParsedBatch,
  ): Promise<OfflineBatchResultBody> {
    await this.nonces.consumeOrThrow(tx, device.deviceId, device.proof);
    const meta = await tx.query<{ ledger_id: string }>('SELECT ledger_id FROM edge_meta');
    const dev = await tx.query<{ public_key: Buffer | null }>(
      'SELECT public_key FROM edge_device WHERE device_id = $1',
      [device.deviceId],
    );
    if (!meta.rows[0] || !dev.rows[0]) throw new ProblemException('UNAUTHENTICATED');
    checkBindings(batch, {
      idempotencyKey: req.idempotencyKey,
      epochHeader: req.epochHeader,
      serialHeader: req.serialHeader,
      serial: device.serial,
      ledgerId: meta.rows[0].ledger_id,
    });

    // Rejeu : même lot, même empreinte -> même réponse, sans nouvel effet ; autre empreinte -> 409.
    const fingerprint = requestFingerprint('POST', req.path, device.deviceId, req.body);
    const known = await this.idempotency.lookup(
      tx,
      device.deviceId,
      batch.header.batchId,
      fingerprint,
    );
    if (known.hit) return known.response as OfflineBatchResultBody;

    // Autorité de débit (règle inversée) dans la transaction du lot, AVANT toute écriture.
    await this.authority.assertCanDebit(batch.header.authorityEpoch, tx);
    checkSignature(batch, dev.rows[0].public_key);
    checkContinuity(batch);
    verifyChain(batch);

    const receivedAt = this.clock.now();
    const env = await this.rules.prepare(tx, device.deviceId, device.serial, receivedAt);
    await tx.query(
      `INSERT INTO edge_device_batch (device_batch_id, device_id, header, signature, received_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [
        batch.header.batchId,
        device.deviceId,
        JSON.stringify(batch.header.raw),
        Buffer.from(batch.signature, 'base64'),
        receivedAt,
      ],
    );
    const results: OperationResultBody[] = [];
    for (const op of batch.operations) {
      results.push(await this.operation(tx, device, env, batch, op));
    }
    const seq = await tx.query<{ central_acked_seq: string; acked_known: boolean }>(
      'SELECT central_acked_seq, acked_known FROM edge_device_seq WHERE device_id = $1',
      [device.deviceId],
    );
    const acked = seq.rows[0]?.acked_known ? Number(seq.rows[0].central_acked_seq) : 0;
    const response: OfflineBatchResultBody = {
      batch_id: batch.header.batchId,
      processed_at: receivedAt.toISOString(),
      results,
      contiguous_acked_seq: acked,
      missing_seqs: [],
      next_snapshot_version: null,
      abandoned: false,
      server_time: receivedAt.toISOString(),
    };
    await this.idempotency.record(tx, {
      deviceId: device.deviceId,
      key: batch.header.batchId,
      fingerprint,
      statusCode: 200,
      response,
      at: receivedAt,
    });
    return response;
  }

  private async operation(
    tx: TxClient,
    device: AuthenticatedDevice,
    env: RulesEnv,
    batch: ParsedBatch,
    op: ReceivedOperation,
  ): Promise<OperationResultBody> {
    const content = contentSha256(chainedContent(op.raw));
    const stored = await tx.query<{ content_sha256: Buffer; result: OperationResultBody }>(
      'SELECT content_sha256, result FROM edge_offline_op_result WHERE device_id = $1 AND seq = $2',
      [device.deviceId, op.seq],
    );
    if (stored.rows[0]) {
      // Même numéro déjà rangé : même contenu -> même résultat, autre contenu -> clé réutilisée.
      if (stored.rows[0].content_sha256.equals(content)) return stored.rows[0].result;
      return {
        seq: op.seq,
        idempotency_key: deviceKey(device.serial, op.seq),
        status: 'REJECTED',
        effect: 'NONE',
        retryable: false,
        reject_reason: 'IDEMPOTENCY_KEY_REUSED',
      };
    }
    const originKey = deviceKey(device.serial, op.seq);
    const exists = await tx.query('SELECT 1 FROM edge_op WHERE origin_key = $1', [originKey]);
    if ((exists.rowCount ?? 0) > 0) {
      // Numéro déjà pris par une décision de la passerelle (en ligne) : rien de nouveau n'entre en file.
      return {
        seq: op.seq,
        idempotency_key: originKey,
        status: 'DUPLICATE',
        effect: 'NONE',
        retryable: false,
      };
    }
    const verdict = await this.rules.evaluate(tx, env, op);
    const { edge_decision: _terminalDecision, ...terminalOp } = op.raw;
    const decision = edgeDecisionOf(op.raw, op.type, verdict);
    const row = await this.queue.append(
      tx,
      {
        originKey,
        type: op.type,
        authorizedMode: 'DEVICE_OFFLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        deviceBatchId: batch.header.batchId,
        operation: decision ? { ...terminalOp, edge_decision: decision } : terminalOp,
        occurredAt: new Date(op.raw.occurred_at as string),
        recordedAt: env.receivedAt,
      },
      verdict.deltas,
    );
    const result = operationResult(device.serial, op.seq, op.type, verdict);
    await tx.query(
      `INSERT INTO edge_offline_op_result
         (device_id, seq, batch_id, edge_seq, content_sha256, type, wallet_id, media_id, amount,
          paid_covered, promo_covered, status, reject_reason, result, rendered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
      [
        device.deviceId,
        op.seq,
        batch.header.batchId,
        row.edgeSeq,
        content,
        op.type,
        verdict.walletId,
        verdict.mediaId,
        verdict.amount.toString(),
        verdict.paid.toString(),
        verdict.promo.toString(),
        verdict.status,
        verdict.rejectReason,
        JSON.stringify(result),
        env.receivedAt,
      ],
    );
    if (verdict.reverses !== null) {
      await tx.query(
        'UPDATE edge_offline_op_result SET reversed_by_seq = $3 WHERE device_id = $1 AND seq = $2',
        [device.deviceId, verdict.reverses, op.seq],
      );
    }
    return result;
  }

  // ------------------------------------------------------------------------------ getOfflineBatchResult

  /** `null` : lot inconnu (404) ; `{ inProgress: true }` : traité par une autre transaction (202). */
  async result(
    device: AuthenticatedDevice,
    batchId: string,
  ): Promise<OfflineBatchResultBody | { inProgress: true } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId))
      return null;
    const id = batchId.toLowerCase();
    return this.gatewayTx.run(async (tx) => {
      const rows = await tx.query<{ response: OfflineBatchResultBody }>(
        'SELECT response FROM edge_idempotency WHERE device_id = $1 AND idempotency_key = $2',
        [device.deviceId, id],
      );
      const found = rows.rows[0];
      if (!found) {
        const lock = await tx.query<{ free: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 19)) AS free',
          [`${device.deviceId}:${id}`],
        );
        return lock.rows[0]?.free === false ? { inProgress: true as const } : null;
      }
      return this.overlayCentral(tx, device, found.response);
    });
  }

  /** Le résultat du central, quand il est revenu, REMPLACE le résultat local (jamais plus fort que lui). */
  private async overlayCentral(
    tx: TxClient,
    device: AuthenticatedDevice,
    local: OfflineBatchResultBody,
  ): Promise<OfflineBatchResultBody> {
    const keys = local.results.map((r) => r.idempotency_key);
    const { rows } = await tx.query<{
      origin_key: string;
      central_status: string;
      central_transaction_id: string | null;
      central_reason: string | null;
      central_detail: Record<string, unknown> | null;
    }>(
      `SELECT origin_key, central_status, central_transaction_id, central_reason, central_detail
         FROM edge_op WHERE origin_key = ANY($1::text[]) AND device_id = $2
          AND central_status NOT IN ('PENDING', 'SENT')`,
      [keys, device.deviceId],
    );
    const byKey = new Map(rows.map((r) => [r.origin_key, r]));
    const results = local.results.map((r): OperationResultBody => {
      const c = byKey.get(r.idempotency_key);
      if (!c) return r;
      const base = { seq: r.seq, idempotency_key: r.idempotency_key, retryable: false };
      if (c.central_status === 'REJECTED') {
        return {
          ...base,
          status: 'REJECTED',
          effect: 'NONE',
          ...(c.central_reason ? { reject_reason: c.central_reason } : {}),
        };
      }
      if (c.central_status === 'VOID') return { ...base, status: 'ACCEPTED', effect: 'NONE' };
      const d = c.central_detail ?? {};
      return {
        ...base,
        status: c.central_status,
        effect: 'LEDGER_WRITTEN',
        ...(c.central_transaction_id ? { transaction_id: c.central_transaction_id } : {}),
        ...(typeof d.charged_to_wallet === 'number'
          ? { charged_to_wallet: d.charged_to_wallet }
          : {}),
        ...(typeof d.shortfall_amount === 'number' ? { shortfall_amount: d.shortfall_amount } : {}),
        ...(typeof d.shortfall_reason === 'string' ? { shortfall_reason: d.shortfall_reason } : {}),
      };
    });
    return { ...local, results };
  }
}
