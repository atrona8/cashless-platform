// Accès base du processus `snapshot-signer` (WP13), rôle `cashless_snapsign` : EXECUTE sur les huit fonctions de
// post-roles.sql § 8f, aucune table, aucun droit d'audit (l'audit SNAPSHOT_PUBLISHED est écrit par
// `publish_offline_snapshot` elle-même). Jamais `pwd_pack_enc`, jamais `content_key_wrapped`.
// Les fonctions qui prennent un brouillon ou une anomalie font `assert_tenant` : la transaction pose le prestataire
// de la ligne lue (`TenantTx.run`) ; les deux listes transversales n'en ont pas (`withoutTenant`).
import { Injectable } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import type { ContentRow, DraftRow } from './draft-verifier';
import type { PublishedKey } from './header-signer';

export interface SeqGapAlert {
  anomalyId: string;
  operatorId: string;
  deviceId: string | null;
  seq: bigint | null;
  createdAt: Date;
}

export interface RetryAlert {
  operatorId: string;
  deviceId: string;
  batchId: string;
  seq: bigint;
  createdAt: Date;
}

/** Intervalle au-delà duquel un trou ou un numéro RETRY non résolu est signalé (R-18, OP-N90). */
export const ALERT_AFTER = '24 hours';

type Pg = { code?: string; detail?: string };

/** Brouillon déjà publié ou jeté par un autre passage (deux signataires, reprise) : pas une erreur. */
export function isDraftGone(error: unknown): boolean {
  const { code, detail } = error as Pg;
  return code === 'CL048' && (detail === 'DRAFT_NOT_READY' || detail === 'DRAFT_PUBLISHED');
}

@Injectable()
export class SnapshotSignerRepository {
  constructor(private readonly tx: TenantTx) {}

  /** Brouillons `READY` de tous les prestataires, par version. */
  async readyDrafts(): Promise<DraftRow[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{
        id: string;
        operator_id: string;
        ledger_id: string;
        kind: string;
        base_version: string | null;
        version: string;
        header: unknown;
      }>(
        `SELECT id::text AS id, operator_id, ledger_id, kind, base_version::text AS base_version,
                version::text AS version, header
           FROM offline_snapshot_drafts_ready()`,
      );
      return rows.map((row) => ({
        id: BigInt(row.id),
        operatorId: row.operator_id,
        ledgerId: row.ledger_id,
        kind: row.kind,
        baseVersion: row.base_version === null ? null : BigInt(row.base_version),
        version: BigInt(row.version),
        header: row.header,
      }));
    });
  }

  /** Contenu à hacher, par `token_hash` croissant : `token_hash` revient en hex minuscule. */
  async content(draft: DraftRow): Promise<ContentRow[]> {
    return this.tx.run(draft.operatorId, async (client) => {
      const { rows } = await client.query<{ token_hash: string; entry: unknown; removed: boolean }>(
        `SELECT encode(token_hash, 'hex') AS token_hash, entry, removed
           FROM offline_snapshot_draft_content($1::bigint)`,
        [draft.id.toString()],
      );
      return rows.map((row) => ({
        tokenHash: row.token_hash,
        entry: row.entry,
        removed: row.removed,
      }));
    });
  }

  /** Clés publiques publiées pour le prestataire du brouillon (la sienne, sinon celle de la plateforme). */
  async publishedKeys(operatorId: string): Promise<PublishedKey[]> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{
        key_id: string;
        algorithm: string;
        public_key: Buffer;
        not_after: Date | null;
      }>('SELECT key_id, algorithm, public_key, not_after FROM snapshot_public_keys($1::uuid)', [
        operatorId,
      ]);
      return rows.map((row) => ({
        keyId: row.key_id,
        algorithm: row.algorithm,
        publicKey: row.public_key,
        notAfter: row.not_after,
      }));
    });
  }

  /** Publication en UNE transaction courte. Rend `false` si le brouillon n'est plus `READY`. */
  async publish(draft: DraftRow, keyId: string, signature: Buffer): Promise<boolean> {
    try {
      await this.tx.run(draft.operatorId, (client) =>
        client.query('SELECT * FROM publish_offline_snapshot($1::bigint, $2::text, $3::bytea)', [
          draft.id.toString(),
          keyId,
          signature,
        ]),
      );
      return true;
    } catch (error) {
      if (isDraftGone(error)) return false;
      throw error;
    }
  }

  /** Jette un brouillon qui ne se vérifie pas (ADR-140). `reason` : code court, sans valeur d'entrée. */
  async discard(draft: DraftRow, reason: string): Promise<void> {
    await this.tx.run(draft.operatorId, (client) =>
      client.query('SELECT discard_offline_snapshot_draft($1::bigint, $2::text)', [
        draft.id.toString(),
        reason,
      ]),
    );
  }

  async seqGapsToAlert(): Promise<SeqGapAlert[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{
        anomaly_id: string;
        operator_id: string;
        device_id: string | null;
        seq: string | null;
        created_at: Date;
      }>(
        `SELECT anomaly_id, operator_id, device_id, seq::text AS seq, created_at
           FROM offline_seq_gaps_to_alert($1::interval)`,
        [ALERT_AFTER],
      );
      return rows.map((row) => ({
        anomalyId: row.anomaly_id,
        operatorId: row.operator_id,
        deviceId: row.device_id,
        seq: row.seq === null ? null : BigInt(row.seq),
        createdAt: row.created_at,
      }));
    });
  }

  async markSeqGapAlerted(alert: SeqGapAlert): Promise<void> {
    await this.tx.run(alert.operatorId, (client) =>
      client.query('SELECT mark_seq_gap_alerted($1::uuid)', [alert.anomalyId]),
    );
  }

  async retriesToAlert(): Promise<RetryAlert[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{
        operator_id: string;
        device_id: string;
        batch_id: string;
        seq: string;
        created_at: Date;
      }>(
        `SELECT operator_id, device_id, batch_id, seq::text AS seq, created_at
           FROM offline_retries_to_alert($1::interval)`,
        [ALERT_AFTER],
      );
      return rows.map((row) => ({
        operatorId: row.operator_id,
        deviceId: row.device_id,
        batchId: row.batch_id,
        seq: BigInt(row.seq),
        createdAt: row.created_at,
      }));
    });
  }

  async markRetryAlerted(alert: RetryAlert): Promise<void> {
    await this.tx.run(alert.operatorId, (client) =>
      client.query('SELECT mark_offline_retry_alerted($1::uuid, $2::bigint)', [
        alert.batchId,
        alert.seq.toString(),
      ]),
    );
  }
}
