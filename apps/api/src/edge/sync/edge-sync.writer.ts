// Écrivain d'une opération reçue d'une passerelle (WP13, T059, T060). UNE transaction par
// opération : l'enveloppe
// écrit l'opération ET appelle `record_edge_seq`, puis le résultat du lot est mémorisé dans la
// même transaction (aucun
// numéro consommé sans résultat). `p_op` est l'opération reçue, dont trois drapeaux sont ÉCRASÉS
// ici (valeur reçue
// jamais crue) : `tap.signature_verified` (port `TAP_PROOF_VERIFIER`), `tap.pack_verified` (le
// central ne détient
// pas la clé du colis : la valeur reçue ne passe que sous la forme d'un booléen vrai, voir le
// compte rendu) et
// `device_batch_verified` (lots de terminal vérifiés). Aucun montant, compte, grand livre ni
// compte de caisse n'est
// lu de la requête quand la base les connaît : les enveloppes les lisent en base.
import { Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import type { EdgeGateway } from '../auth/edge-gateway';
import type { ParsedEdgeOp } from './edge-sync-body';
import { deviceKey } from '../../idempotency/device-key';
import { dispatch } from './edge-sync-dispatch';
import {
  EDGE_SYNC_CENTRAL,
  type EdgeSyncCentral,
  type FeeLine,
  type StoredResult,
} from './edge-sync-central.port';
import { TAP_PROOF_VERIFIER, type TapProofVerifier } from './tap-proof.port';

const HEX14 = /^[0-9a-f]{14}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface Prepared {
  originKey: string;
  pOp: Record<string, unknown>;
  feeLines: FeeLine[] | null;
}

export type Outcome = StoredResult['outcome'];

export interface OpResult {
  outcome: Outcome;
  reason: string | null;
  detail: string | null;
  transactionId: string | null;
}

/**
 * Clé d'origine `<serial>:<seq>` de TOUTE opération, guichet compris (A10), `seq` complété à 4 chiffres comme
 * sur les voies en ligne et hors ligne (`deviceKey`, décision 52). `edge_seq` ne sert qu'à l'ordre.
 */
export function originKeyOf(op: ParsedEdgeOp): string {
  const seq = op.raw.seq;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1)
    return `${op.deviceSerial}:invalid#${op.edgeSeq}`;
  // La caution en espèces d'une activation partage le `seq` de l'activation : suffixe `#deposit`, comme
  // la file de la passerelle et `edge_counter_op` (A10). Sans lui, la caution serait rangée sous la clé
  // de l'activation (`#dup<edge_seq>`, EDGE_REPLAY_FAILED) et son résultat ne serait jamais rapproché.
  const key = deviceKey(op.deviceSerial, BigInt(seq));
  return op.type === 'DEPOSIT_CASH' ? `${key}#deposit` : key;
}

/**
 * Signature d'originalité telle que la passerelle la relaie : 64 caractères hexadécimaux (forme du
 * contrat
 * `TapReading`), ou base64 (formes antérieures). 64 caractères hexadécimaux sont aussi du base64
 * valide : sans
 * cette distinction ils étaient décodés en 48 octets faux et la preuve échouait toujours.
 */
export function decodeOriginalitySignature(sig: unknown): Buffer | null {
  if (typeof sig !== 'string') return null;
  if (/^[0-9a-fA-F]{64}$/.test(sig)) return Buffer.from(sig, 'hex');
  return BASE64.test(sig) ? Buffer.from(sig, 'base64') : null;
}

@Injectable()
export class EdgeSyncWriter {
  constructor(
    @Inject(EDGE_SYNC_CENTRAL) private readonly central: EdgeSyncCentral,
    @Inject(TAP_PROOF_VERIFIER) private readonly tapProof: TapProofVerifier,
  ) {}

  /**
   * Tout ce qui demande le central (preuve du bracelet, frais), avant d'ouvrir la transaction de
   * l'opération.
   */
  async prepare(
    gateway: EdgeGateway,
    op: ParsedEdgeOp,
    verifiedDeviceBatches: ReadonlySet<string>,
  ): Promise<Prepared> {
    const pOp: Record<string, unknown> = { ...op.raw };
    pOp.device_batch_verified =
      op.mode === 'DEVICE_OFFLINE' &&
      op.deviceBatchId !== null &&
      verifiedDeviceBatches.has(op.deviceBatchId);
    const tap = op.raw.tap;
    if (typeof tap === 'object' && tap !== null && !Array.isArray(tap)) {
      const t = tap as Record<string, unknown>;
      pOp.tap = {
        ...t,
        signature_verified: false,
        pack_verified: t.pack_verified === true,
      };
      if (
        (op.type === 'PURCHASE' || op.type === 'REVERSAL') &&
        op.mode === 'EDGE_ONLINE' &&
        typeof t.token_hash === 'string' &&
        HEX64.test(t.token_hash) &&
        typeof t.nfc_uid === 'string' &&
        HEX14.test(t.nfc_uid)
      ) {
        const sig = t.originality_signature;
        const verified = await this.tapProof.verify(gateway, {
          tokenHash: Buffer.from(t.token_hash, 'hex'),
          nfcUid: Buffer.from(t.nfc_uid, 'hex'),
          originalitySignature: decodeOriginalitySignature(sig),
        });
        (pOp.tap as Record<string, unknown>).signature_verified = verified === true;
      }
    }
    let feeLines: FeeLine[] | null = null;
    const decision = op.raw.edge_decision as { status?: unknown } | undefined;
    if (
      op.type === 'PURCHASE' &&
      decision?.status !== 'REJECTED' &&
      typeof op.raw.amount === 'number' &&
      Number.isSafeInteger(op.raw.amount) &&
      op.raw.amount > 0 &&
      typeof op.raw.occurred_at === 'string' &&
      typeof op.raw.currency === 'string' &&
      !Number.isNaN(Date.parse(op.raw.occurred_at))
    ) {
      feeLines = await this.central.feeLines(gateway, {
        deviceSerial: op.deviceSerial,
        amount: BigInt(op.raw.amount),
        occurredAt: new Date(op.raw.occurred_at),
        currency: op.raw.currency,
      });
    }
    return { originKey: originKeyOf(op), pOp, feeLines };
  }

  /** Appel de l'enveloppe (point d'injection des tests : `CL007`, `40001`, `23505`). */
  async callEnvelope(
    client: TxClient,
    gateway: EdgeGateway,
    batch: { epoch: bigint },
    op: ParsedEdgeOp,
    content: Buffer,
    prepared: Prepared,
  ): Promise<OpResult> {
    const plan = dispatch(op);
    if (plan.kind === 'RECORD') {
      await this.recordSeq(
        client,
        gateway,
        op,
        prepared.originKey,
        content,
        plan.outcome,
        plan.reason,
      );
      return {
        outcome: plan.outcome,
        reason: plan.reason,
        detail: plan.detail,
        transactionId: null,
      };
    }
    const args: unknown[] = [
      gateway.gatewayId,
      batch.epoch.toString(),
      op.edgeSeq.toString(),
      prepared.originKey,
      content,
      JSON.stringify(prepared.pOp),
    ];
    let sql = `SELECT * FROM ${plan.fn}($1::uuid, $2::bigint, $3::bigint, $4, $5::bytea, $6::jsonb`;
    if (plan.fn === 'edge_post_transaction') {
      args.push(prepared.feeLines === null ? null : JSON.stringify(prepared.feeLines));
      sql += ', $7::jsonb';
    }
    const { rows } = await client.query<{
      outcome: Outcome;
      transaction_id: string | null;
      reason: string | null;
      detail: string | null;
    }>(`${sql})`, args);
    const row = rows[0]!;
    return {
      outcome: row.outcome,
      reason: row.reason,
      detail: row.detail,
      transactionId: row.transaction_id,
    };
  }

  /** `edge_record_seq` : numéro consommé avec une issue explicite et sans écriture comptable. */
  async recordSeq(
    client: TxClient,
    gateway: EdgeGateway,
    op: ParsedEdgeOp,
    originKey: string,
    content: Buffer,
    outcome: 'VOID' | 'REJECTED',
    reason: string,
  ): Promise<void> {
    await client.query(
      'SELECT edge_record_seq($1::uuid, $2::bigint, $3, $4::bytea, $5, NULL, $6)',
      [gateway.gatewayId, op.edgeSeq.toString(), originKey, content, outcome, reason],
    );
  }

  /** Mémorise le résultat dans le lot, dans la transaction de l'opération. */
  async storeResult(
    client: TxClient,
    batchId: string,
    op: ParsedEdgeOp,
    result: OpResult,
  ): Promise<void> {
    await client.query(
      'SELECT edge_sync_batch_result($1::uuid, $2::bigint, $3, $4, $5, $6::uuid, $7)',
      [
        batchId,
        op.edgeSeq.toString(),
        result.outcome,
        result.reason,
        result.detail,
        result.transactionId,
        result.reason === 'INSUFFICIENT_FUNDS_RETRY',
      ],
    );
  }
}
