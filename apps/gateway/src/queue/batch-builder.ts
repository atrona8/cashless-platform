// Construction d'un lot sortant (T090, R-12, R-13, contracts/edge-routes.md `submitEdgeSyncBatch`).
//
// Un lot couvre des numéros CONTIGUS, au plus 500 opérations et 1 Mio de corps (le premier seuil
// atteint). Un lot peut aussi n'avoir AUCUNE opération s'il ne porte que des ordres locaux
// (`buildOrdersOnlyBatch`, décision 50, ADR-187). Il porte l'en-tête et la signature d'ORIGINE de chaque lot de terminal relayé, et le
// `staff_token_audit` des opérations qu'il contient. La signature n'est pas posée ici : elle porte
// sur le lot COMPLET sans elle (`batchSigningPayload`), donc sur ce que ce module construit.
import type { TxClient } from '../db/gateway-tx';
import { pendingLocalOrders, type LocalOrderLine } from '../purge/local-orders-feed';
import { pendingStaffTokenAudit, type StaffTokenAuditLine } from './staff-audit-feed';

export const MAX_BATCH_OPERATIONS = 500;
export const MAX_BATCH_BYTES = 1024 * 1024;
/** Longueur de `,"signature":"<base64 de 64 octets>"` ajoutée après la construction. */
const SIGNATURE_ALLOWANCE = 120;

export interface UnsignedBatch {
  batch_id: string;
  edge_gateway_id: string;
  ledger_id: string;
  epoch: number;
  edge_seq_from: number;
  edge_seq_to: number;
  prev_chain_hash: string;
  last_chain_hash: string;
  staff_token_audit?: StaffTokenAuditLine[];
  /** Ordres locaux à deux personnes (décision 33, ADR-169), facultatif. */
  local_orders?: LocalOrderLine[];
  operations: Record<string, unknown>[];
  device_batches?: { header: unknown; signature: string }[];
}

export class BatchTooLargeError extends Error {
  constructor(readonly edgeSeq: number) {
    super(`opération ${edgeSeq} : plus grande que le lot maximal (1 Mio)`);
    this.name = 'BatchTooLargeError';
  }
}

interface OpRow {
  edge_seq: string;
  operation: Record<string, unknown>;
  chain_hash: Buffer;
  device_batch_id: string | null;
}

export interface BuildParams {
  batchId: string;
  gatewayId: string;
  ledgerId: string;
  epoch: number;
  /** Premier numéro du lot. */
  from: number;
}

/** Premier numéro sans résultat du central (`PENDING` ou `SENT`), ou `null` si la file est vide. */
export async function firstUnresolvedSeq(tx: TxClient): Promise<number | null> {
  const { rows } = await tx.query<{ seq: string | null }>(
    `SELECT min(edge_seq) AS seq FROM edge_op WHERE central_status IN ('PENDING', 'SENT')`,
  );
  return rows[0]?.seq == null ? null : Number(rows[0].seq);
}

export async function buildBatch(
  tx: TxClient,
  params: BuildParams,
  genesis: Buffer,
): Promise<UnsignedBatch | null> {
  const { rows } = await tx.query<OpRow>(
    `SELECT edge_seq, operation, chain_hash, device_batch_id FROM edge_op
      WHERE edge_seq >= $1 ORDER BY edge_seq LIMIT $2`,
    [params.from, MAX_BATCH_OPERATIONS],
  );
  if (rows.length === 0) return null;
  let previous = genesis;
  if (params.from > 1) {
    const prev = await tx.query<{ chain_hash: Buffer }>(
      'SELECT chain_hash FROM edge_op WHERE edge_seq = $1',
      [params.from - 1],
    );
    if (!prev.rows[0]) throw new Error(`chaîne : maillon ${params.from - 1} absent`);
    previous = prev.rows[0].chain_hash;
  }

  const sizes = rows.map((row) => Buffer.byteLength(JSON.stringify(row.operation)) + 1);
  let count = rows.length;
  let assembled = await assemble(tx, params, rows, count, previous);
  for (;;) {
    const bytes = Buffer.byteLength(JSON.stringify(assembled)) + SIGNATURE_ALLOWANCE;
    if (bytes <= MAX_BATCH_BYTES) return assembled;
    if (count === 1) throw new BatchTooLargeError(Number(rows[0]!.edge_seq));
    // Réduit d'une part proportionnelle au dépassement (au moins une opération), puis recompte.
    const overflow = bytes - MAX_BATCH_BYTES;
    let drop = 0;
    let dropped = 0;
    for (let i = count - 1; i > 0 && dropped < overflow; i -= 1) {
      dropped += sizes[i]!;
      drop += 1;
    }
    count -= Math.max(1, drop);
    assembled = await assemble(tx, params, rows, count, previous);
  }
}

async function assemble(
  tx: TxClient,
  params: BuildParams,
  rows: OpRow[],
  count: number,
  previous: Buffer,
): Promise<UnsignedBatch> {
  const used = rows.slice(0, count);
  const first = Number(used[0]!.edge_seq);
  const last = Number(used[count - 1]!.edge_seq);
  const batchIds = [...new Set(used.map((r) => r.device_batch_id).filter((id) => id !== null))];
  const deviceBatches: UnsignedBatch['device_batches'] = [];
  if (batchIds.length > 0) {
    const found = await tx.query<{ device_batch_id: string; header: unknown; signature: Buffer }>(
      `SELECT device_batch_id, header, signature FROM edge_device_batch
        WHERE device_batch_id = ANY($1::uuid[]) ORDER BY device_batch_id`,
      [batchIds],
    );
    if (found.rows.length !== batchIds.length) {
      throw new Error('lot de terminal relayé absent de edge_device_batch');
    }
    for (const row of found.rows) {
      deviceBatches.push({ header: row.header, signature: row.signature.toString('base64') });
    }
  }
  const audit = await pendingStaffTokenAudit(tx, first, last);
  const localOrders = await pendingLocalOrders(tx);
  return {
    batch_id: params.batchId,
    edge_gateway_id: params.gatewayId,
    ledger_id: params.ledgerId,
    epoch: params.epoch,
    edge_seq_from: first,
    edge_seq_to: last,
    prev_chain_hash: previous.toString('hex'),
    last_chain_hash: used[count - 1]!.chain_hash.toString('hex'),
    ...(audit.length > 0 ? { staff_token_audit: audit } : {}),
    ...(localOrders.length > 0 ? { local_orders: localOrders } : {}),
    operations: used.map((r) => r.operation),
    ...(deviceBatches.length > 0 ? { device_batches: deviceBatches } : {}),
  };
}

/** Un lot sans opération : intervalle vide (`edge_seq_to < edge_seq_from`), ordres locaux seuls. */
export const isOrdersOnly = (batch: { edge_seq_from: unknown; edge_seq_to: unknown }): boolean =>
  Number(batch.edge_seq_to) < Number(batch.edge_seq_from);

/**
 * Lot d'ordres seuls (décision 50, ADR-187, OP-N119) : seulement s'il y a au moins un ordre local à verser, sinon
 * `null` (le central refuse un lot vide sans ordre). Représentation : `edge_seq_from` = dernier numéro + 1,
 * `edge_seq_to` = `edge_seq_from - 1`, `prev_chain_hash` = `last_chain_hash` = la chaîne au dernier numéro (genèse si
 * aucune opération). Ni `edge_seq` ni la chaîne ne bougent. N'est appelé que file entièrement résolue.
 */
export async function buildOrdersOnlyBatch(
  tx: TxClient,
  params: Omit<BuildParams, 'from'>,
): Promise<UnsignedBatch | null> {
  const localOrders = await pendingLocalOrders(tx);
  if (localOrders.length === 0) return null;
  const { rows } = await tx.query<{ last_edge_seq: string; last_chain_hash: Buffer }>(
    'SELECT last_edge_seq, last_chain_hash FROM edge_chain_head',
  );
  const head = rows[0];
  if (!head) throw new Error('edge_chain_head absent');
  const last = Number(head.last_edge_seq);
  const chain = head.last_chain_hash.toString('hex');
  return {
    batch_id: params.batchId,
    edge_gateway_id: params.gatewayId,
    ledger_id: params.ledgerId,
    epoch: params.epoch,
    edge_seq_from: last + 1,
    edge_seq_to: last,
    prev_chain_hash: chain,
    last_chain_hash: chain,
    local_orders: localOrders,
    operations: [],
  };
}
