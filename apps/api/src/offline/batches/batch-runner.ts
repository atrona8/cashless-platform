// Ouverture, boucle, reprise et clôture d'un lot (mission 7, lot WP18 ; contracts/batches.md « Traitement » et
// « Reprise et lecture » ; research R-11, R-30.7). Ce lot ne calcule aucune règle d'argent : il tient l'ordre des
// transactions, appelle le processeur de WP19 par l'interface figée (une opération = un appel, sa propre transaction),
// relit le statut du lot avant chaque opération (`ABANDONED` : arrêt, résultats déjà inscrits rendus) et ne clôt que
// par `complete_offline_batch`. Les résultats rendus viennent TOUJOURS des lignes inscrites (`offline_op_result`), de
// sorte qu'un renvoi rend les mêmes octets que la première réponse (NFR-002).
import { Inject, Injectable } from '@nestjs/common';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import {
  OFFLINE_OPERATION_PROCESSOR,
  BatchNotProcessing,
  type BatchContext,
  type BatchOpening,
  type OfflineBatchResult,
  type OfflineOperationProcessor,
  type OperationResult,
  type ParsedOperation,
} from './batch.types';
import { ReferenceMemo } from '../../ledger/ports/reference-memo';
import { TOLERANCE_MS } from '../processing/compliance-input.reader';
import { detectInversions } from '../rules/offline-time';

/** Ligne de `offline_batch_state` (lot du prestataire de la transaction seulement). */
export interface BatchState {
  status: 'PROCESSING' | 'COMPLETED' | 'REJECTED';
  rejectReason: string | null;
  deviceId: string;
  receivedAt: Date;
  completedAt: Date | null;
  seqFrom: bigint;
  seqTo: bigint;
  missingSeqs: bigint[];
}

interface StateSql {
  status: BatchState['status'];
  reject_reason: string | null;
  device_id: string;
  received_at: Date;
  completed_at: Date | null;
  seq_from: string;
  seq_to: string;
  missing_seqs: string[] | null;
}

const toState = (r: StateSql): BatchState => ({
  status: r.status,
  rejectReason: r.reject_reason,
  deviceId: r.device_id,
  receivedAt: r.received_at,
  completedAt: r.completed_at,
  seqFrom: BigInt(r.seq_from),
  seqTo: BigInt(r.seq_to),
  missingSeqs: (r.missing_seqs ?? []).map((s) => BigInt(s)),
});

export interface OpenInput {
  batchId: string;
  deviceId: string;
  ledgerId: string;
  seqFrom: bigint;
  prevChainHash: Buffer;
  opHashes: Buffer[];
  lastChainHash: Buffer;
  signature: Buffer;
  sizeBytes: number;
}

export interface Opened {
  status: 'PROCESSING' | 'COMPLETED' | 'REJECTED';
  rejectReason: string | null;
  receivedAt: Date;
}

const RETRY_AFTER_IN_PROGRESS = { 'Retry-After': '2' };

/** `CL010` (un lot déjà en cours pour ce terminal) : `409 BATCH_IN_PROGRESS` avec `Retry-After: 2`. */
export function inProgress(): ProblemException {
  return new ProblemException('BATCH_IN_PROGRESS', { headers: RETRY_AFTER_IN_PROGRESS });
}

@Injectable()
export class BatchRunner {
  constructor(
    private readonly tx: TenantTx,
    @Inject(OFFLINE_OPERATION_PROCESSOR) private readonly processor: OfflineOperationProcessor,
  ) {}

  /** État du lot sous le prestataire ; `null` si inconnu OU d'un autre prestataire (RLS). */
  state(client: TxClient, batchId: string): Promise<BatchState | null> {
    return client
      .query<StateSql>(
        `SELECT status, reject_reason, device_id, received_at, completed_at, seq_from::text AS seq_from,
                seq_to::text AS seq_to, missing_seqs::text[] AS missing_seqs
           FROM offline_batch_state($1)`,
        [batchId],
      )
      .then(({ rows }) => (rows[0] ? toState(rows[0]) : null));
  }

  readState(operatorId: string, batchId: string): Promise<BatchState | null> {
    return this.tx.run(operatorId, (client) => this.state(client, batchId));
  }

  /**
   * Contrôle 10 : `open_offline_batch` (canal `CENTRAL`) dans une transaction courte. `onNew` s'exécute dans la même
   * transaction quand le lot n'existait pas encore (ligne d'audit « reçu », atomique avec l'ouverture).
   * `CL010` devient `409 BATCH_IN_PROGRESS` + `Retry-After: 2` ; les autres codes (`CL021`, `CL011`, `CL002`)
   * passent tels quels par la table des SQLSTATE.
   */
  async open(
    operatorId: string,
    input: OpenInput,
    onNew?: (client: TxClient) => Promise<void>,
  ): Promise<Opened> {
    try {
      return await this.tx.run(operatorId, async (client) => {
        const before = onNew ? await this.state(client, input.batchId) : null;
        const { rows } = await client.query<{
          status: Opened['status'];
          reject_reason: string | null;
          received_at: Date;
        }>(
          `SELECT status, reject_reason, received_at
             FROM open_offline_batch($1, $2, $3, $4::bigint, $5, $6::bytea[], $7, $8, 'CENTRAL', $9)`,
          [
            input.batchId,
            input.deviceId,
            input.ledgerId,
            input.seqFrom.toString(),
            input.prevChainHash,
            input.opHashes,
            input.lastChainHash,
            input.signature,
            input.sizeBytes,
          ],
        );
        const row = rows[0]!;
        if (onNew && before === null && row.status === 'PROCESSING') await onNew(client);
        return { status: row.status, rejectReason: row.reject_reason, receivedAt: row.received_at };
      });
    } catch (error) {
      if (isSqlError(error) && error.code === 'CL010') throw inProgress();
      throw error;
    }
  }

  /** Numéros du lot déjà munis d'une ligne de résultat. */
  private async doneSeqs(operatorId: string, batchId: string): Promise<Set<string>> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ seq: string }>(
        'SELECT seq::text AS seq FROM offline_op_results($1)',
        [batchId],
      );
      return new Set(rows.map((r) => r.seq));
    });
  }

  /**
   * Garde de l'opération : relit l'état du lot DANS la transaction de l'opération (une requête, au lieu d'une
   * transaction à part de quatre) et lève `BatchNotProcessing` si le lot n'est plus `PROCESSING`; la transaction de
   * l'opération est alors annulée, rien n'est écrit pour elle.
   *
   * Ordre des verrous : le processeur l'appelle APRÈS `lock_device` (première instruction de la transaction, ordre
   * du chemin en ligne). `offline_batch_state` ne verrouille rien (fonction SQL en lecture, sans `FOR UPDATE`), donc
   * la lire avant ou après ne crée aucun risque d'interblocage ; après est plus sûr : l'abandon d'un lot (`UPDATE
   * offline_batch … 'ABANDONED'`, dans `open_offline_batch`) se fait sous le verrou de ce même terminal, de sorte
   * qu'une fois le verrou obtenu l'état lu est soit déjà abandonné (vu, on s'arrête), soit protégé jusqu'à notre
   * COMMIT. Lue avant le verrou, une valeur `PROCESSING` périmée aurait pu précéder une écriture après l'abandon.
   */
  private assertProcessing(batchId: string): (client: TxClient) => Promise<void> {
    return async (client) => {
      const { rows } = await client.query<{ status: string; reject_reason: string | null }>(
        'SELECT status, reject_reason FROM offline_batch_state($1)',
        [batchId],
      );
      const row = rows[0];
      if (row?.status === 'PROCESSING') return;
      throw new BatchNotProcessing(
        row
          ? row.status === 'REJECTED'
            ? `REJECTED:${row.reject_reason ?? ''}`
            : row.status
          : null,
      );
    };
  }

  /**
   * Boucle : chaque opération sans résultat, dans l'ordre des numéros, un appel du processeur. Une exception du
   * processeur arrête le lot (il reste `PROCESSING`, rien n'est inventé) et remonte. Rend `abandoned: true` si le
   * lot est passé `REJECTED` pendant le traitement.
   */
  async run(opening: BatchOpening, operations: ParsedOperation[]): Promise<{ abandoned: boolean }> {
    // Inversions de dates : sur le lot ENTIER (une reprise ne doit pas en perdre), avant de sauter les opérations
    // déjà faites. Une date illisible est ignorée ici (le processeur rejette l'opération).
    const dated = operations.flatMap((op) => {
      const at = typeof op.raw.occurred_at === 'string' ? Date.parse(op.raw.occurred_at) : NaN;
      return Number.isNaN(at) ? [] : [{ seq: op.seq, occurredAt: new Date(at) }];
    });
    // Mémoire de référence propre à CETTE exécution : jetée avec `ctx` à la fin de `run`, jamais partagée.
    const ctx: BatchContext = {
      ...opening,
      inversions: detectInversions(dated, TOLERANCE_MS),
      reference: new ReferenceMemo(),
      assertProcessing: this.assertProcessing(opening.batchId),
    };
    const done = await this.doneSeqs(ctx.operatorId, ctx.batchId);
    const returned = new Map<string, OperationResult>();
    for (const op of operations) {
      if (done.has(op.seq.toString())) continue;
      try {
        returned.set(op.seq.toString(), await this.processor.process(ctx, op));
      } catch (error) {
        // Lot plus `PROCESSING` (relu dans la transaction de l'opération) : même issue qu'avant.
        if (!(error instanceof BatchNotProcessing)) throw error;
        if (error.status !== null && error.status.startsWith('REJECTED'))
          return { abandoned: true };
        break;
      }
    }
    await this.recordMissingResults(ctx, returned);
    return { abandoned: false };
  }

  /**
   * Filet : un résultat rendu par le processeur mais sans ligne (le processeur ne l'a pas inscrit) l'est ici, par
   * `record_offline_op_result` (idempotent, même valeur : rien ; autre valeur : `CL002`).
   */
  private async recordMissingResults(
    ctx: BatchContext,
    returned: Map<string, OperationResult>,
  ): Promise<void> {
    if (returned.size === 0) return;
    await this.tx.run(ctx.operatorId, async (client) => {
      const { rows } = await client.query<{ seq: string }>(
        'SELECT seq::text AS seq FROM offline_op_results($1)',
        [ctx.batchId],
      );
      const present = new Set(rows.map((r) => r.seq));
      for (const [seq, result] of returned) {
        if (present.has(seq)) continue;
        await client.query('SELECT record_offline_op_result($1, $2::bigint, $3::jsonb)', [
          ctx.batchId,
          seq,
          JSON.stringify(result),
        ]);
      }
    });
  }

  /** Clôture : `complete_offline_batch(batch, results)` avec les résultats inscrits. */
  async complete(operatorId: string, batchId: string): Promise<void> {
    await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ result: OperationResult }>(
        'SELECT result FROM offline_op_results($1) ORDER BY seq',
        [batchId],
      );
      await client.query('SELECT complete_offline_batch($1, $2::jsonb)', [
        batchId,
        JSON.stringify(rows.map((r) => r.result)),
      ]);
    });
  }

  /**
   * Réponse `OfflineBatchResult`, relue de la base : résultats inscrits (octets identiques d'un envoi à l'autre),
   * plus grand numéro continu, trous, version de snapshot suivante. `processed_at` = fin du traitement (stable).
   */
  async response(
    operatorId: string,
    batchId: string,
    abandoned: boolean,
  ): Promise<OfflineBatchResult | null> {
    return this.tx.run(operatorId, async (client) => {
      const state = await this.state(client, batchId);
      if (!state) return null;
      const { rows: results } = await client.query<{ result: OperationResult }>(
        'SELECT result FROM offline_op_results($1) ORDER BY seq',
        [batchId],
      );
      const { rows: device } = await client.query<{ contiguous: string; now: Date }>(
        `SELECT contiguous_acked_seq::text AS contiguous, clock_timestamp() AS now
           FROM device WHERE id = $1`,
        [state.deviceId],
      );
      const next = await this.nextSnapshotVersion(client, batchId, state.deviceId);
      const now = device[0]!.now;
      return {
        batch_id: batchId,
        processed_at: (state.completedAt ?? now).toISOString(),
        results: results.map((r) => r.result),
        contiguous_acked_seq: Number(device[0]!.contiguous),
        missing_seqs: state.missingSeqs.map((s) => Number(s)),
        next_snapshot_version: next,
        abandoned,
        server_time: now.toISOString(),
      };
    });
  }

  /**
   * Dernière version de snapshot du grand livre, plus 1 si une écriture du lot n'y est pas encore reflétée (R-11) ;
   * sinon la dernière version. `null` sans snapshot ni écriture. Une écriture est « reflétée » si elle est inscrite
   * au registre avant la génération du dernier snapshot.
   */
  private async nextSnapshotVersion(
    client: TxClient,
    batchId: string,
    deviceId: string,
  ): Promise<number | null> {
    const { rows } = await client.query<{ latest: string | null; unreflected: boolean }>(
      `SELECT s.version::text AS latest,
              EXISTS (SELECT 1 FROM device_seq_registry r
                       WHERE r.batch_id = $1 AND r.device_id = $2 AND r.transaction_id IS NOT NULL
                         AND (s.generated_at IS NULL OR r.recorded_at > s.generated_at)) AS unreflected
         FROM (SELECT 1) one
         LEFT JOIN LATERAL (SELECT o.version, o.generated_at FROM offline_snapshot o
                              JOIN device d ON d.id = $2
                              JOIN ledger l ON l.id = o.ledger_id AND l.scope_type = 'EVENT'
                                           AND l.scope_id = d.event_id
                             ORDER BY o.version DESC LIMIT 1) s ON true`,
      [batchId, deviceId],
    );
    const latest = rows[0]?.latest ? Number(rows[0].latest) : null;
    if (rows[0]?.unreflected) return (latest ?? 0) + 1;
    return latest;
  }
}
