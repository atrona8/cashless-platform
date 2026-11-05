// Traitement d'UNE opération d'un lot (mission 7, lot WP19 ; contracts/batches.md « Traitement d'une opération »,
// sync_protocol.md §7.1) : dans sa propre transaction `TenantTx`, du registre jusqu'au résultat mémorisé. Tout ou rien :
// l'écriture comptable, le registre, les anomalies et `offline_op_result` partent dans le même COMMIT (NFR-011).
// Les règles sont celles de WP17 (pures) ; ce fichier tient l'ORDRE, les verrous (terminal, bracelet, portefeuille,
// jamais l'inverse) et les frontières de transaction. Le processeur ne lit ni ne change le statut du lot (WP18).
import { Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { deviceKey } from '../../idempotency/device-key';
import { TapService } from '../../media/taps/tap.service';
import { DeviceSeqRegistry, type RegistryRow } from '../../payments/device-seq-registry';
import { AnomalyWriter, type OfflineAnomalyKind } from '../anomalies/anomaly-writer';
import type {
  BatchContext,
  OfflineOperationProcessor,
  OperationResult,
  ParsedOperation,
} from '../batches/batch.types';
import { checkCompliance } from '../rules/compliance';
import { conflictOutcome } from '../rules/conflict-outcome';
import { lossBearer } from '../rules/loss-bearer';
import { resolveOfflineTime } from '../rules/offline-time';
import { checkPeriod } from '../rules/period';
import type { OfflineRejectReason, OperationType, TapResult } from '../rules/types';
import {
  ComplianceInputReader,
  TOLERANCE_MS,
  type MediaFacts,
  type ReversalTargetFacts,
  type SnapshotFacts,
  type TerminalFacts,
} from './compliance-input.reader';
import { OfflineReversalWriter } from './offline-reversal.writer';
import { OfflineSaleWriter, type WriteDecision } from './offline-sale.writer';
import { anomalyAmount, readFields, type OperationFields } from './operation-input';

const INVERSION_CODE = 'DATE_INVERSION';

/** Même numéro, autre contenu : la transaction courante est annulée, le rejet part dans une transaction à part. */
class KeyReused extends Error {}

const num = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('montant hors des entiers sûrs');
  return Number(value);
};

interface Env {
  client: TxClient;
  ctx: BatchContext;
  op: ParsedOperation;
  key: string;
  fields: OperationFields;
  terminal: TerminalFacts;
  approverId: string | null;
}

@Injectable()
export class OfflineOperationProcessorService implements OfflineOperationProcessor {
  constructor(
    private readonly tx: TenantTx,
    private readonly registry: DeviceSeqRegistry,
    private readonly reader: ComplianceInputReader,
    private readonly sales: OfflineSaleWriter,
    private readonly reversals: OfflineReversalWriter,
    private readonly taps: TapService,
    private readonly anomalies: AnomalyWriter,
  ) {}

  async process(ctx: BatchContext, op: ParsedOperation): Promise<OperationResult> {
    try {
      return await this.tx.run(ctx.operatorId, async (client) => {
        const result = await this.run(client, ctx, op);
        await this.flagInversion(client, ctx, op);
        return result;
      });
    } catch (error) {
      if (!(error instanceof KeyReused)) throw error;
      return this.tx.run(ctx.operatorId, (client) => this.rejectReusedKey(client, ctx, op));
    }
  }

  /**
   * Date qui recule au-delà de la tolérance (FR-025) : anomalie `CLOCK_SKEW`, codes seulement, résultat inchangé.
   * Dans la transaction de l'opération ; idempotente (une anomalie d'heure déjà ouverte pour ce numéro est retrouvée).
   */
  private async flagInversion(
    client: TxClient,
    ctx: BatchContext,
    op: ParsedOperation,
  ): Promise<void> {
    if (!ctx.inversions.includes(op.seq)) return;
    await this.anomalies.open(client, {
      ledgerId: ctx.ledgerId,
      kind: 'CLOCK_SKEW',
      deviceId: ctx.deviceId,
      seq: op.seq,
      amount: 0n,
      batchId: ctx.batchId,
      detail: { codes: [INVERSION_CODE] },
    });
  }

  // ---------------------------------------------------------------------------------------------- le déroulé

  private async run(
    client: TxClient,
    ctx: BatchContext,
    op: ParsedOperation,
  ): Promise<OperationResult> {
    // 0. Première instruction : le terminal, FOR UPDATE (ordre des verrous du chemin en ligne).
    await client.query("SELECT lock_device($1, 'UPDATE')", [ctx.deviceId]);
    // État du lot relu ICI, dans la transaction de l'opération, APRÈS le verrou du terminal (voir `BatchRunner.run`).
    await ctx.assertProcessing?.(client);
    const key = deviceKey(ctx.serial, op.seq);
    const fields = readFields(op);

    // 2. Registre : même empreinte, résultat mémorisé ; autre empreinte, rejet (transaction à part).
    const known = await this.registry.lookup(client, ctx.deviceId, op.seq);
    if (known) return this.replayKnown(client, ctx, op, key, known);

    const terminal = await this.reader.terminal(client, ctx);
    const approverId = await this.approver(client, ctx);
    const env: Env = { client, ctx, op, key, fields, terminal, approverId };

    // 3. Clé déjà au journal (en ligne, passerelle). Cette lecture DÉCIDE le doublon avant toute conformité (toute
    // ligne portant la clé suffit, quel que soit son type) ; celle du moteur, sous le verrou `engine-key`, compare
    // type et empreinte et fait foi à l'écriture. Les deux n'ont pas le même sens : aucune n'est supprimable.
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2',
      [ctx.ledgerId, key],
    );
    if (existing.rows[0]) {
      let anomalyId: string | undefined;
      if (op.type === 'VOID')
        anomalyId = await this.openAnomaly(env, 'VOID_CONFLICT', {
          transactionId: existing.rows[0].id,
        });
      return this.duplicate(env, existing.rows[0].id, anomalyId);
    }

    // 4. Selon le type.
    if (op.type === 'VOID') return this.noEffect(env, 'VOID', null);
    if (op.type === 'TOPUP_CASH')
      return this.reject(env, 'OFFLINE_NOT_ALLOWED', ['TOPUP_CASH'], 'NON_COMPLIANT_OPERATION');
    let exemptTx: string | null = null;
    if (fields.onlineStatus === 'CONFIRMED') {
      exemptTx = await this.reader.confirmedTransaction(client, ctx, fields.onlineTransactionId);
    } else if (op.type === 'ONLINE_REF') {
      return this.noEffect(env, 'VOID', 'ONLINE_NOT_EXECUTED');
    }
    let confirmedMissing: string | undefined;
    if (fields.onlineStatus === 'CONFIRMED' && exemptTx === null)
      // R-30.1 : `CONFIRMED` introuvable n'exempte JAMAIS ; conformité complète ensuite.
      confirmedMissing = await this.openAnomaly(env, 'ONLINE_CONFIRMED_MISSING', {});
    const type: OperationType = op.type;

    // Forme.
    const malformed = this.malformed(type, fields, exemptTx !== null);
    if (malformed) return this.reject(env, 'MALFORMED_OPERATION', [], 'NON_COMPLIANT_OPERATION');

    // 7 (avant 5, 6 : l'heure corrigée sert aux contrôles). Snapshot cité, heure corrigée.
    const snapshot = await this.reader.snapshot(client, ctx, fields.snapshotVersion);
    let corrected: Date;
    let skew: 'NONE' | 'FUTURE' | 'BEFORE_SNAPSHOT';
    try {
      ({ corrected, skew } = resolveOfflineTime(
        fields.occurredAt!,
        ctx.receivedAt,
        snapshot?.generatedAt ?? null,
        TOLERANCE_MS,
      ));
    } catch {
      return this.reject(env, 'MALFORMED_OPERATION', [], 'NON_COMPLIANT_OPERATION');
    }

    // Faits de bracelet et d'annulation.
    let media: MediaFacts | null = null;
    let target: ReversalTargetFacts | null = null;
    if (type === 'REVERSAL') {
      target = await this.reader.reversalTarget(client, ctx, fields);
      if (fields.tap !== null) {
        media = await this.reader.media(client, fields.tap.tokenHash);
        // Une lecture d'un AUTRE bracelet que celui de la vente visée : cible introuvable (plus strict).
        if (target !== null && target.mediaId !== media?.mediaId) target = null;
      } else if (target?.mediaId) {
        // Contrat (exemple `openapi.yaml`, seq 88) : sans lecture, le bracelet est celui de la vente visée.
        media = await this.reader.mediaById(client, target.mediaId);
      }
    } else if (fields.tap !== null) {
      media = await this.reader.media(client, fields.tap.tokenHash);
    }

    // 5. Conformité (sauf `CONFIRMED` dont la transaction existe).
    if (exemptTx === null) {
      const input = await this.reader.complianceInput(client, ctx, {
        type,
        seq: op.seq,
        fields,
        terminal,
        snapshot,
        media,
        reversal: target,
        corrected,
        exempt: false,
      });
      const verdict = checkCompliance(input);
      if (!verdict.ok)
        return this.reject(env, verdict.reason, verdict.detail, 'NON_COMPLIANT_OPERATION', {
          anomalyId: confirmedMissing,
        });
    }

    // 6. Période (toute opération, `CONFIRMED` comprise).
    const period = checkPeriod({
      occurredAt: corrected,
      lockedUntil: terminal.lockedUntil,
      ledgerStatus: terminal.ledgerStatus,
      eventStatus: terminal.eventStatus,
      type,
    });
    if (!period.ok) return this.reject(env, period.reason, [], period.anomaly);

    // Déjà écrite en ligne et confirmée : rien à écrire.
    if (exemptTx !== null) return this.duplicate(env, exemptTx, confirmedMissing);

    // 7. Horloge.
    let skewAnomaly: string | undefined;
    if (skew !== 'NONE')
      skewAnomaly = await this.openAnomaly(env, 'CLOCK_SKEW', {
        amount: 0n,
        detail: ctx.inversions.includes(op.seq) ? { skew, codes: [INVERSION_CODE] } : { skew },
      });
    const deviceOccurredAt = skew !== 'NONE' ? fields.occurredAt : null;

    if (type === 'ONLINE_REF') return this.noEffect(env, 'VOID', 'ONLINE_NOT_EXECUTED');
    if (type === 'REVERSAL')
      return this.reverse(env, target!, corrected, deviceOccurredAt, skewAnomaly);
    return this.sell(env, media, snapshot!, corrected, deviceOccurredAt, skewAnomaly);
  }

  // -------------------------------------------------------------------------------------------- les issues

  private base(env: Env): Pick<OperationResult, 'seq' | 'idempotency_key'> {
    return { seq: num(env.op.seq), idempotency_key: env.key };
  }

  /** Inscrit le résultat (JCS) dans la transaction de l'opération : identique octet pour octet au rejeu. */
  private async finish(env: Env, result: OperationResult): Promise<OperationResult> {
    const text = canonicalize(result);
    if (text === undefined) throw new Error('résultat non sérialisable');
    await env.client.query('SELECT record_offline_op_result($1, $2::bigint, $3::jsonb)', [
      env.ctx.batchId,
      env.op.seq.toString(),
      text,
    ]);
    return result;
  }

  private async record(
    env: Env,
    outcome: 'ACCEPTED' | 'ACCEPTED_WITH_SHORTFALL' | 'DUPLICATE' | 'REJECTED' | 'VOID',
    reason: string | null,
    transactionId: string | null,
  ): Promise<void> {
    const row = await this.registry.record(
      env.client,
      {
        deviceId: env.ctx.deviceId,
        seq: env.op.seq,
        content: env.op.contentSha256,
        outcome,
        ...(reason !== null ? { reason } : {}),
        ...(transactionId !== null ? { transactionId } : {}),
        batchId: env.ctx.batchId,
      },
      'BATCH',
    );
    if (row.replayed) throw new Error('registre : numéro déjà rangé pendant son traitement');
  }

  private openAnomaly(
    env: Env,
    kind: OfflineAnomalyKind,
    extra: { amount?: bigint; transactionId?: string; mediaId?: string; detail?: unknown },
  ): Promise<string> {
    return this.anomalies.open(env.client, {
      ledgerId: env.ctx.ledgerId,
      kind,
      deviceId: env.ctx.deviceId,
      seq: env.op.seq,
      amount: extra.amount ?? anomalyAmount(env.fields),
      batchId: env.ctx.batchId,
      ...(extra.transactionId ? { transactionId: extra.transactionId } : {}),
      ...(extra.mediaId ? { mediaId: extra.mediaId } : {}),
      ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    });
  }

  private async duplicate(
    env: Env,
    transactionId: string,
    anomalyId?: string,
  ): Promise<OperationResult> {
    await this.record(env, 'DUPLICATE', null, transactionId);
    return this.finish(env, {
      ...this.base(env),
      status: 'DUPLICATE',
      transaction_id: transactionId,
      effect: 'LEDGER_WRITTEN',
      retryable: false,
      ...(anomalyId ? { anomaly_id: anomalyId } : {}),
    });
  }

  private async noEffect(
    env: Env,
    outcome: 'VOID',
    reason: string | null,
  ): Promise<OperationResult> {
    await this.record(env, outcome, reason, null);
    return this.finish(env, {
      ...this.base(env),
      status: 'ACCEPTED',
      effect: 'NONE',
      retryable: false,
    });
  }

  /** Rejet : rien d'écrit au grand livre ; registre `REJECTED`, anomalie, résultat. Détail : des CODES seulement. */
  private async reject(
    env: Env,
    reason: OfflineRejectReason,
    detail: string[],
    anomaly: OfflineAnomalyKind,
    _opts: { anomalyId?: string | undefined } = {},
  ): Promise<OperationResult> {
    await this.record(env, 'REJECTED', reason, null);
    const anomalyId = await this.anomalies.open(env.client, {
      ledgerId: env.ctx.ledgerId,
      kind: anomaly,
      deviceId: env.ctx.deviceId,
      seq: env.op.seq,
      amount: anomalyAmount(env.fields),
      batchId: env.ctx.batchId,
      ...(anomaly === 'NON_COMPLIANT_OPERATION'
        ? { lossBearer: lossBearer(env.terminal.providedBy) }
        : {}),
      ...(detail.length > 0 ? { detail: { codes: detail } } : {}),
    });
    return this.finish(env, {
      ...this.base(env),
      status: 'REJECTED',
      reject_reason: reason,
      effect: 'NONE',
      retryable: false,
      anomaly_id: anomalyId,
      ...(detail.length > 0 ? { detail: detail.join(',') } : {}),
    });
  }

  private async rejectReusedKey(
    client: TxClient,
    ctx: BatchContext,
    op: ParsedOperation,
  ): Promise<OperationResult> {
    await client.query("SELECT lock_device($1, 'UPDATE')", [ctx.deviceId]);
    await ctx.assertProcessing?.(client);
    const fields = readFields(op);
    const anomalyId = await this.anomalies.open(client, {
      ledgerId: ctx.ledgerId,
      kind: 'IDEMPOTENCY_CONFLICT',
      deviceId: ctx.deviceId,
      seq: op.seq,
      amount: anomalyAmount(fields),
      batchId: ctx.batchId,
    });
    const result: OperationResult = {
      seq: num(op.seq),
      idempotency_key: deviceKey(ctx.serial, op.seq),
      status: 'REJECTED',
      reject_reason: 'IDEMPOTENCY_KEY_REUSED',
      effect: 'NONE',
      retryable: false,
      anomaly_id: anomalyId,
    };
    await client.query('SELECT record_offline_op_result($1, $2::bigint, $3::jsonb)', [
      ctx.batchId,
      op.seq.toString(),
      canonicalize(result),
    ]);
    return result;
  }

  /** Numéro déjà au registre : résultat mémorisé du lot, sinon reconstruit du registre. */
  private async replayKnown(
    client: TxClient,
    ctx: BatchContext,
    op: ParsedOperation,
    key: string,
    known: RegistryRow,
  ): Promise<OperationResult> {
    const same = await client.query<{ same: boolean }>(
      `SELECT (content_sha256 = $3) AS same FROM device_seq_registry
        WHERE device_id = $1 AND seq = $2::bigint`,
      [ctx.deviceId, op.seq.toString(), op.contentSha256],
    );
    if (same.rows[0]?.same !== true) throw new KeyReused();
    const memo = await client.query<{ result: OperationResult }>(
      'SELECT result FROM offline_op_results($1) WHERE seq = $2::bigint',
      [ctx.batchId, op.seq.toString()],
    );
    if (memo.rows[0]) return memo.rows[0].result;
    const base = { seq: num(op.seq), idempotency_key: key, retryable: false };
    let result: OperationResult;
    if (known.outcome === 'REJECTED') {
      result = {
        ...base,
        status: 'REJECTED',
        effect: 'NONE',
        ...(known.reason ? { reject_reason: known.reason as OfflineRejectReason } : {}),
      };
    } else if (known.transactionId !== null) {
      result = {
        ...base,
        status: 'DUPLICATE',
        transaction_id: known.transactionId,
        effect: 'LEDGER_WRITTEN',
      };
    } else if (known.outcome === 'VOID') {
      result = { ...base, status: 'ACCEPTED', effect: 'NONE' };
    } else {
      // WAIVED : le numéro a été levé, l'opération arrive trop tard ; rien n'est écrit.
      result = { ...base, status: 'DUPLICATE', effect: 'NONE' };
    }
    await client.query('SELECT record_offline_op_result($1, $2::bigint, $3::jsonb)', [
      ctx.batchId,
      op.seq.toString(),
      canonicalize(result),
    ]);
    return result;
  }

  // ------------------------------------------------------------------------------------------------ utilitaires

  /** Valideur d'un import (approbateur) ; `null` pour un lot de terminal. */
  private async approver(client: TxClient, ctx: BatchContext): Promise<string | null> {
    if (ctx.receivedVia !== 'IMPORT') return null;
    if (ctx.importId === null) throw new Error('canal IMPORT sans identifiant d’import');
    const { rows } = await client.query<{ approved_by: string | null }>(
      'SELECT approved_by FROM device_journal_import_view($1, false)',
      [ctx.importId],
    );
    if (!rows[0]?.approved_by) throw new Error('import sans approbateur');
    return rows[0].approved_by;
  }

  private malformed(type: OperationType, f: OperationFields, exempt: boolean): boolean {
    if (f.occurredAt === null) return true;
    if (exempt || type === 'ONLINE_REF') return false;
    if (f.tapMalformed) return true;
    if (type === 'PURCHASE') return f.amount === null || f.currency === null || f.tap === null;
    if (type === 'REVERSAL') return f.reversesSeq === null && f.reversesTransactionId === null;
    return false;
  }

  // ------------------------------------------------------------------------------------------------- annulation

  private async reverse(
    env: Env,
    target: ReversalTargetFacts,
    corrected: Date,
    deviceOccurredAt: string | null,
    skewAnomaly: string | undefined,
  ): Promise<OperationResult> {
    const written = await this.reversals.write(env.client, {
      ctx: env.ctx,
      key: env.key,
      terminal: env.terminal,
      fields: env.fields,
      target,
      occurredAt: corrected,
      deviceOccurredAt,
      approverId: env.approverId,
    });
    if (written.kind === 'ALREADY_REVERSED')
      return this.reject(env, 'ALREADY_REVERSED', [], 'NON_COMPLIANT_OPERATION');
    await this.record(env, 'ACCEPTED', null, written.transactionId);
    return this.finish(env, {
      ...this.base(env),
      status: 'ACCEPTED',
      transaction_id: written.transactionId,
      effect: 'LEDGER_WRITTEN',
      retryable: false,
      ...(skewAnomaly ? { anomaly_id: skewAnomaly } : {}),
    });
  }

  // ---------------------------------------------------------------------------------------------------- vente

  private async sell(
    env: Env,
    media: MediaFacts | null,
    snapshot: SnapshotFacts,
    corrected: Date,
    deviceOccurredAt: string | null,
    skewAnomaly: string | undefined,
  ): Promise<OperationResult> {
    const { client, ctx, fields } = env;
    const amount = fields.amount!;
    // 8. Passage du bracelet (hors ligne), un seul `register_tap` par opération.
    const tap = await this.taps.registerOffline(
      client,
      { deviceId: ctx.deviceId, operatorId: ctx.operatorId },
      { ...fields.tap!, occurredAt: corrected },
      fields.onlineTapId,
    );
    const walletId = media?.walletId ?? null;
    const decide = async () => {
      if (media === null || walletId === null)
        return conflictOutcome({
          tapResult: 'UNKNOWN',
          amount,
          spendable: 0n,
          walletStatus: 'ACTIVE',
          blockTime: null,
          occurredAt: corrected,
          snapshotGeneratedAt: snapshot.generatedAt,
          tolMs: TOLERANCE_MS,
        });
      let blockTime: Date | 'UNKNOWN' | null = null;
      if (tap.result === 'BLOCKED') {
        const found = await this.reader.blockTime(client, media.mediaId, walletId, corrected);
        // NULL : aucun blocage en vigueur à l'heure de l'opération + tolérance (le blocage est venu après) → couvert.
        blockTime =
          found ??
          new Date(
            Math.max(corrected.getTime() + TOLERANCE_MS, snapshot.generatedAt.getTime() + 1),
          );
      }
      return conflictOutcome({
        tapResult: tap.result as TapResult,
        amount,
        spendable: await this.reader.spendable(client, walletId),
        walletStatus: await this.reader.walletStatus(client, walletId),
        blockTime,
        occurredAt: corrected,
        snapshotGeneratedAt: snapshot.generatedAt,
        tolMs: TOLERANCE_MS,
      });
    };
    const first = await decide();
    if (first.kind === 'REJECT')
      return this.reject(env, first.reason, [], 'NON_COMPLIANT_OPERATION');
    const asDecision = (o: Awaited<ReturnType<typeof decide>>): WriteDecision => {
      if (o.kind !== 'WRITE') throw new Error('conflit : rejet inattendu pendant une reprise');
      return {
        covered: o.covered,
        ...(o.shortfallReason ? { shortfallReason: o.shortfallReason } : {}),
      };
    };
    const written = await this.sales.write(client, {
      ctx,
      key: env.key,
      seq: env.op.seq,
      terminal: env.terminal,
      fields,
      media: media!,
      tapId: tap.tapId,
      occurredAt: corrected,
      deviceOccurredAt,
      approverId: env.approverId,
      initial: asDecision(first),
      decide: async () => asDecision(await decide()),
    });

    if (written.kind === 'RETRY') {
      // 4e `CL007` : rien au registre, le passage n'est pas consommé, trace RETRY dans CETTE transaction (ADR-139).
      await client.query('SELECT record_offline_retry($1, $2::bigint, $3)', [
        ctx.batchId,
        env.op.seq.toString(),
        'INSUFFICIENT_FUNDS_RETRY',
      ]);
      return this.finish(env, {
        ...this.base(env),
        status: 'REJECTED',
        reject_reason: 'INSUFFICIENT_FUNDS_RETRY',
        effect: 'NONE',
        retryable: true,
        tap_result: tap.result,
      });
    }
    // 10. Registre (transaction, statut, raison), puis résultat.
    const withShortfall = written.shortfall > 0n;
    await this.record(
      env,
      withShortfall ? 'ACCEPTED_WITH_SHORTFALL' : 'ACCEPTED',
      written.shortfallReason,
      written.transactionId,
    );
    return this.finish(env, {
      ...this.base(env),
      status: withShortfall ? 'ACCEPTED_WITH_SHORTFALL' : 'ACCEPTED',
      transaction_id: written.transactionId,
      effect: 'LEDGER_WRITTEN',
      charged_to_wallet: num(written.covered),
      ...(withShortfall
        ? { shortfall_amount: num(written.shortfall), shortfall_reason: written.shortfallReason! }
        : {}),
      tap_result: tap.result,
      retryable: false,
      ...((written.anomalyId ?? skewAnomaly)
        ? { anomaly_id: (written.anomalyId ?? skewAnomaly)! }
        : {}),
    });
  }
}
