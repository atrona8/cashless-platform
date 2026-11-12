// Application des résultats du central (T091, A26, FR-026, data-model.md B.2).
//
// Pour chaque résultat, dans UNE transaction avec le passage du lot à `DONE` :
//  - seuls `central_status`, `central_transaction_id`, `central_reason`, `central_detail` et
//    `sent_batch_id` de `edge_op` changent (le déclencheur de la base refuse le reste) ;
//  - la règle de purge des deltas est celle de WP18, appelée par le jeton `DELTA_PURGE`
//    (`onOpResult(tx, edgeSeq, status)`) : elle retrouve elle-même le portefeuille de chaque delta
//    de l'opération, et ne purge un `ACCEPTED` que si le solde répliqué DU PORTEFEUILLE le couvre ;
//  - `edge_chain_head.acked_*` avance jusqu'au premier numéro sans résultat (exclu) ;
//  - les accusés des terminaux (`edge_device_seq.central_acked_seq`) viennent des RÉSULTATS du
//    central, jamais de la file locale (FR-026).
// Un résultat pour une clé inconnue, ou qui contredit une issue déjà enregistrée, n'écrit rien et
// laisse une ligne d'alerte dans `edge_audit`.
import type { TxClient } from '../db/gateway-tx';
import { markLocalOrdersSent } from '../purge/local-orders-feed';
import { markStaffTokenAuditSent } from './staff-audit-feed';

/** Règle de purge des deltas, fournie par WP18 (`DeltaPurge`). */
export interface DeltaPurgePort {
  onOpResult(tx: TxClient, edgeSeq: number, status: string): Promise<void>;
}
export const DELTA_PURGE = Symbol('DELTA_PURGE');

/**
 * Règle de repli quand WP18 n'est pas branché sous `DELTA_PURGE` : seuls `REJECTED` et `VOID`
 * (le central n'a rien écrit) annulent leurs deltas ; tout le reste est GARDÉ (solde sous-estimé,
 * jamais surestimé). Ce n'est pas un faux : c'est le sous-ensemble sûr de la règle.
 */
export const resultOnlyDeltaPurge: DeltaPurgePort = {
  async onOpResult(tx, edgeSeq, status) {
    if (status === 'REJECTED' || status === 'VOID') {
      await tx.query('DELETE FROM edge_op_delta WHERE edge_seq = $1', [edgeSeq]);
    }
  },
};

export class MalformedResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedResultError';
  }
}

const CENTRAL_STATUSES = ['ACCEPTED', 'DUPLICATE', 'ACCEPTED_WITH_SHORTFALL', 'REJECTED'] as const;
type CentralStatus = (typeof CENTRAL_STATUSES)[number];

interface OpResult {
  idempotency_key: string;
  status: CentralStatus;
  transaction_id: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
}

export interface BatchResult {
  batch_id: string;
  results: OpResult[];
  abandoned: boolean;
  missingSeqs: number[];
}

/** Valide la forme de `OfflineBatchResult` ; une réponse mal formée n'est JAMAIS appliquée. */
export function parseBatchResult(body: unknown, expectedBatchId: string): BatchResult {
  const bad = (message: string): never => {
    throw new MalformedResultError(message);
  };
  if (typeof body !== 'object' || body === null) return bad('corps absent');
  const record = body as Record<string, unknown>;
  if (record.batch_id !== expectedBatchId) return bad('batch_id différent du lot envoyé');
  if (!Array.isArray(record.results)) return bad('results absent');
  const results: OpResult[] = record.results.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return bad('résultat illisible');
    const r = raw as Record<string, unknown>;
    if (typeof r.idempotency_key !== 'string' || r.idempotency_key === '') {
      return bad('idempotency_key absent');
    }
    if (!CENTRAL_STATUSES.includes(r.status as CentralStatus)) return bad('status inconnu');
    const detail: Record<string, unknown> = {};
    for (const key of [
      'effect',
      'charged_to_wallet',
      'shortfall_amount',
      'retryable',
      'detail',
      'anomaly_id',
    ]) {
      if (r[key] !== undefined) detail[key] = r[key];
    }
    const reason =
      typeof r.reject_reason === 'string'
        ? r.reject_reason
        : typeof r.shortfall_reason === 'string'
          ? r.shortfall_reason
          : null;
    return {
      idempotency_key: r.idempotency_key,
      status: r.status as CentralStatus,
      transaction_id: typeof r.transaction_id === 'string' ? r.transaction_id : null,
      reason,
      detail: Object.keys(detail).length > 0 ? detail : null,
    };
  });
  const missing = Array.isArray(record.missing_seqs)
    ? record.missing_seqs.filter((n): n is number => Number.isSafeInteger(n) && n >= 1)
    : [];
  return {
    batch_id: expectedBatchId,
    results,
    abandoned: record.abandoned === true,
    missingSeqs: missing,
  };
}

interface OpState {
  edge_seq: string;
  type: string;
  device_id: string;
  central_status: string;
}

export interface ApplyOutcome {
  applied: number;
  /** Plus haut numéro du lot qui a une issue (résolue maintenant ou avant). */
  resolvedTo: number;
  ackedEdgeSeq: number;
  unresolvedInBatch: number;
  conflicts: number;
}

async function alert(
  tx: TxClient,
  kind: string,
  edgeSeq: number | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO edge_audit (kind, actor, edge_seq, detail) VALUES ($1, 'gateway', $2, $3)`,
    [kind, edgeSeq, JSON.stringify(detail)],
  );
}

const RESOLVED_OK = new Set(['ACCEPTED', 'ACCEPTED_WITH_SHORTFALL', 'VOID']);

/** À appeler DANS la transaction qui passe le lot à `DONE`. */
export async function applyResults(
  tx: TxClient,
  batch: { batchId: string; from: number; to: number },
  result: BatchResult,
  purge: DeltaPurgePort,
  now: Date,
): Promise<ApplyOutcome> {
  let applied = 0;
  let conflicts = 0;
  const devices = new Set<string>();
  for (const r of result.results) {
    // Le terminal, la passerelle et le central partagent la même clé `<serial>:<seq>` (seq sur
    // 4 chiffres au moins, décision 52) : rapprochement par clé exacte.
    const found = await tx.query<OpState>(
      `SELECT edge_seq, type, device_id, central_status FROM edge_op
        WHERE origin_key = $1 LIMIT 1 FOR UPDATE`,
      [r.idempotency_key],
    );
    const op = found.rows[0];
    if (!op) {
      await alert(tx, 'DRAIN_RESULT_UNKNOWN_OP', null, {
        batch_id: batch.batchId,
        origin_key: r.idempotency_key.slice(0, 200),
      });
      continue;
    }
    const edgeSeq = Number(op.edge_seq);
    // Un `VOID` consomme son numéro sans effet : le central le range comme une opération sans
    // écriture. Localement, c'est `VOID`.
    const status: string = op.type === 'VOID' && r.status !== 'REJECTED' ? 'VOID' : r.status;
    const unresolved = op.central_status === 'PENDING' || op.central_status === 'SENT';
    if (!unresolved) {
      const same = op.central_status === status;
      const duplicateOfKnown = status === 'DUPLICATE' && RESOLVED_OK.has(op.central_status);
      if (!same && !duplicateOfKnown) {
        conflicts += 1;
        await alert(tx, 'DRAIN_RESULT_CONFLICT', edgeSeq, {
          batch_id: batch.batchId,
          recorded: op.central_status,
          received: status,
        });
      }
      continue;
    }
    await tx.query(
      `UPDATE edge_op SET central_status = $2, central_transaction_id = $3, central_reason = $4,
                          central_detail = $5, sent_batch_id = $6
        WHERE edge_seq = $1`,
      [
        edgeSeq,
        status,
        r.transaction_id,
        r.reason,
        r.detail === null ? null : JSON.stringify(r.detail),
        batch.batchId,
      ],
    );
    await purge.onOpResult(tx, edgeSeq, status);
    devices.add(op.device_id);
    applied += 1;
    if (r.detail?.retryable === true) {
      await alert(tx, 'DRAIN_RESULT_RETRYABLE', edgeSeq, { batch_id: batch.batchId });
    }
  }

  await advanceDeviceAcks(tx, [...devices], now);
  const ackedEdgeSeq = await advanceHead(tx);

  const inBatch = await tx.query<{ unresolved: string; resolved_to: string | null }>(
    `SELECT count(*) FILTER (WHERE central_status IN ('PENDING', 'SENT')) AS unresolved,
            max(edge_seq) FILTER (WHERE central_status NOT IN ('PENDING', 'SENT')) AS resolved_to
       FROM edge_op WHERE edge_seq BETWEEN $1 AND $2`,
    [batch.from, batch.to],
  );
  const unresolvedInBatch = Number(inBatch.rows[0]?.unresolved ?? 0);
  const resolvedTo = Number(inBatch.rows[0]?.resolved_to ?? batch.from - 1);
  // Le premier numéro sans issue borne ce qui est réellement versé (audit de tolérance compris).
  const contiguousTo = await contiguousResolvedTo(tx, batch.from, batch.to);
  await markStaffTokenAuditSent(tx, batch.batchId, batch.from, contiguousTo);
  if (!result.abandoned) await markLocalOrdersSent(tx, batch.batchId);
  await tx.query(
    `UPDATE edge_device_batch SET relayed_in_batch = $1
      WHERE relayed_in_batch IS NULL AND device_batch_id IN (
        SELECT device_batch_id FROM edge_op
         WHERE edge_seq BETWEEN $2 AND $3 AND device_batch_id IS NOT NULL
           AND central_status NOT IN ('PENDING', 'SENT'))`,
    [batch.batchId, batch.from, contiguousTo],
  );
  if (!result.abandoned && unresolvedInBatch > 0) {
    await alert(tx, 'DRAIN_RESULTS_INCOMPLETE', null, {
      batch_id: batch.batchId,
      unresolved: unresolvedInBatch,
    });
  }
  return { applied, resolvedTo, ackedEdgeSeq, unresolvedInBatch, conflicts };
}

async function contiguousResolvedTo(tx: TxClient, from: number, to: number): Promise<number> {
  const { rows } = await tx.query<{ first_open: string | null }>(
    `SELECT min(edge_seq) AS first_open FROM edge_op
      WHERE edge_seq BETWEEN $1 AND $2 AND central_status IN ('PENDING', 'SENT')`,
    [from, to],
  );
  return rows[0]?.first_open == null ? to : Number(rows[0].first_open) - 1;
}

/** `acked_edge_seq` = dernier numéro avant le premier sans issue (jamais en arrière). */
async function advanceHead(tx: TxClient): Promise<number> {
  const { rows } = await tx.query<{ acked: string }>(
    `SELECT COALESCE((SELECT min(edge_seq) FROM edge_op
                       WHERE central_status IN ('PENDING', 'SENT')) - 1,
                     (SELECT last_edge_seq FROM edge_chain_head)) AS acked`,
  );
  const acked = Number(rows[0]!.acked);
  await tx.query(
    `UPDATE edge_chain_head h
        SET acked_edge_seq = $1,
            acked_chain_hash = COALESCE(
              (SELECT chain_hash FROM edge_op WHERE edge_seq = $1), h.acked_chain_hash)
      WHERE h.acked_edge_seq < $1`,
    [acked],
  );
  const head = await tx.query<{ acked_edge_seq: string }>(
    'SELECT acked_edge_seq FROM edge_chain_head',
  );
  return Number(head.rows[0]!.acked_edge_seq);
}

/**
 * Accusé par terminal : le plus grand numéro `seq` du terminal tel que tous ses prédécesseurs ont
 * une issue du central. Lu dans les opérations dont le central a RENDU un résultat.
 */
async function advanceDeviceAcks(tx: TxClient, deviceIds: string[], now: Date): Promise<void> {
  for (const deviceId of deviceIds) {
    const current = await tx.query<{ central_acked_seq: string }>(
      'SELECT central_acked_seq FROM edge_device_seq WHERE device_id = $1',
      [deviceId],
    );
    let acked = BigInt(current.rows[0]?.central_acked_seq ?? 0);
    const start = acked;
    const { rows } = await tx.query<{ tseq: string }>(
      `SELECT (operation->>'seq')::bigint AS tseq FROM edge_op
        WHERE device_id = $1 AND central_status NOT IN ('PENDING', 'SENT')
          AND (operation->>'seq')::bigint > $2
        ORDER BY tseq`,
      [deviceId, start.toString()],
    );
    for (const row of rows) {
      const seq = BigInt(row.tseq);
      if (seq === acked + 1n) acked = seq;
      else if (seq > acked + 1n) break;
    }
    if (acked === start && current.rows[0]) continue;
    await tx.query(
      `INSERT INTO edge_device_seq (device_id, central_acked_seq, central_acked_at, acked_known)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (device_id) DO UPDATE
         SET central_acked_seq = greatest(edge_device_seq.central_acked_seq, EXCLUDED.central_acked_seq),
             central_acked_at = EXCLUDED.central_acked_at, acked_known = true`,
      [deviceId, acked.toString(), now],
    );
  }
}
