// Accès central de la réception des lots, SANS droit de table (décision 39, ADR-174) : chaque lecture ou écriture
// passe par une fonction SQL étroite `SECURITY DEFINER` (migration 0066), exécutée sous `cashless_edge`, dans une
// transaction de la passerelle (`EdgeTx` : `app.operator_id` et `app.gateway_id`).
import { Injectable } from '@nestjs/common';
import type { EdgeGateway } from '../auth/edge-gateway';
import { EdgeTx } from '../edge-tx';
import { feeLinesFromConfig, type FeeConfigRow } from './edge-fee-lines';
import type {
  CentralAudit,
  DeviceFacts,
  EdgeSyncCentral,
  FeeInput,
  FeeLine,
  StoredResult,
  SyncCursor,
} from './edge-sync-central.port';
import type { TapProofInput, TapProofVerifier } from './tap-proof.port';

@Injectable()
export class PgEdgeSyncCentral implements EdgeSyncCentral {
  constructor(private readonly tx: EdgeTx) {}

  cursor(gateway: EdgeGateway): Promise<SyncCursor> {
    return this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<{
        contiguous_edge_seq: string;
        last_chain_hash: Buffer | null;
      }>('SELECT * FROM edge_sync_cursor($1::uuid)', [gateway.gatewayId]);
      return {
        contiguousEdgeSeq: BigInt(rows[0]!.contiguous_edge_seq),
        lastChainHash: rows[0]!.last_chain_hash,
      };
    });
  }

  device(gateway: EdgeGateway, serial: string): Promise<DeviceFacts | null> {
    return this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<{
        device_id: string;
        public_key: Buffer | null;
        status: string;
      }>('SELECT * FROM edge_sync_device_key($1::uuid, $2)', [gateway.gatewayId, serial]);
      const row = rows[0];
      return row
        ? { deviceId: row.device_id, publicKey: row.public_key, status: row.status }
        : null;
    });
  }

  feeLines(gateway: EdgeGateway, input: FeeInput): Promise<FeeLine[]> {
    return this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<FeeConfigRow>(
        'SELECT * FROM edge_fee_config($1::uuid, $2, $3::timestamptz)',
        [gateway.gatewayId, input.deviceSerial, input.occurredAt.toISOString()],
      );
      return feeLinesFromConfig(rows[0], input.amount);
    });
  }

  results(gateway: EdgeGateway, batchId: string): Promise<StoredResult[]> {
    return this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<{
        edge_seq: string;
        outcome: StoredResult['outcome'];
        reason: string | null;
        detail: string | null;
        transaction_id: string | null;
        retryable: boolean;
      }>('SELECT * FROM edge_sync_results($1::uuid, $2::uuid)', [gateway.gatewayId, batchId]);
      return rows.map((r) => ({
        edgeSeq: BigInt(r.edge_seq),
        outcome: r.outcome,
        reason: r.reason,
        detail: r.detail,
        transactionId: r.transaction_id,
        retryable: r.retryable,
      }));
    });
  }

  async audit(gateway: EdgeGateway, entry: CentralAudit): Promise<void> {
    await this.tx.run(gateway, (client) =>
      client.query('SELECT edge_sync_audit($1::uuid, $2, $3::uuid, $4::jsonb)', [
        gateway.gatewayId,
        entry.action,
        entry.batchId,
        JSON.stringify(entry.detail),
      ]),
    );
  }
}

/** Preuve du bracelet : `edge_tap_proof` rend un booléen, jamais une empreinte. */
@Injectable()
export class PgTapProofVerifier implements TapProofVerifier {
  constructor(private readonly tx: EdgeTx) {}

  verify(gateway: EdgeGateway, input: TapProofInput): Promise<boolean> {
    if (input.originalitySignature === null) return Promise.resolve(false);
    return this.tx.run(gateway, async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT edge_tap_proof($1::uuid, $2::bytea, $3::bytea, $4::bytea) AS ok',
        [gateway.gatewayId, input.tokenHash, input.nfcUid, input.originalitySignature],
      );
      return rows[0]?.ok === true;
    });
  }
}
