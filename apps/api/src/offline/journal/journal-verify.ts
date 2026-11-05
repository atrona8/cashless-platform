// Vérification, synthèse et empreinte d'un export de journal (mission 7, lot WP20, T084 ; R-30.10). Aucun code de
// contrôle n'est recopié : les contrôles 3 (schéma), 6 (signature), 7 (continuité) et 8 (chaîne recalculée) sont ceux
// du réceptionneur de lots (WP18, `batches/batch-intake.ts`, `batch-chain.ts`). Utilisé deux fois : à la demande
// (refus immédiat) et à l'exécution de l'approbation (sur les lots RELUS en base, jamais sur ceux de la demande).
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { verifyChain } from '../batches/batch-chain';
import { checkContinuity, checkSignature, parseBatchShape } from '../batches/batch-intake';
import { MAX_BATCH_BYTES, type ParsedBatch, type ParsedOperation } from '../batches/batch.types';
import { MAX_IMPORT_BATCHES } from './journal-body';

/** Terminal tel que la base le connaît (lu sous la RLS du prestataire). */
export interface ImportTerminal {
  deviceId: string;
  operatorId: string;
  serial: string;
  status: string;
  publicKey: Buffer | null;
  ledgerId: string | null;
  eventId: string | null;
  lastSeenAt: Date | null;
}

/**
 * Élément stocké dans `device_journal_import.batches` : `batch_id` (minuscules) et `seq_from` en tête, comme l'exige
 * `create_device_journal_import` (WP05), puis le lot TEL QUE REÇU (`header`, `operations`, `signature`).
 */
export interface StoredBatch {
  batch_id: string;
  seq_from: number;
  header: Record<string, unknown>;
  operations: Array<Record<string, unknown>>;
  signature: string;
}

const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

/** Lots du corps : schéma (contrôle 3), taille de chaque lot, doublons ; rend les lots analysés et leur forme stockée. */
export function parseImportBatches(raw: unknown): { parsed: ParsedBatch[]; stored: StoredBatch[] } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_IMPORT_BATCHES)
    throw invalid(`batches : de 1 à ${MAX_IMPORT_BATCHES} lots attendus.`);
  const parsed: ParsedBatch[] = [];
  const stored: StoredBatch[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, index) => {
    if (Buffer.byteLength(JSON.stringify(item), 'utf8') > MAX_BATCH_BYTES)
      throw new ProblemException('BATCH_TOO_LARGE', { status: 413 });
    let batch: ParsedBatch;
    try {
      batch = parseBatchShape(item);
    } catch (error) {
      if (error instanceof ProblemException && error.status === 400)
        throw invalid(`batches/${index} : ${error.detail ?? 'lot invalide'}`);
      throw error;
    }
    // Normalisé en minuscules : `open_imported_batch` compare le texte (un uuid en majuscules bloquerait l'import).
    const id = batch.header.batchId;
    if (seen.has(id)) throw invalid('batches : identifiant de lot en double.');
    seen.add(id);
    parsed.push(batch);
    stored.push({
      batch_id: id,
      seq_from: Number(batch.header.seqFrom),
      header: batch.header.raw,
      operations: batch.operations.map((op) => op.raw),
      signature: batch.signature,
    });
  });
  return { parsed, stored };
}

/** Relit un lot stocké (jsonb relu en base) sous la forme analysée : même contrôle de schéma. */
export function parseStoredBatches(stored: unknown): ParsedBatch[] {
  if (!Array.isArray(stored)) throw invalid('batches : tableau attendu.');
  return stored.map((item: unknown) => {
    const e = (item ?? {}) as Record<string, unknown>;
    return parseBatchShape({ header: e.header, operations: e.operations, signature: e.signature });
  });
}

/**
 * Contrôles 3 (déjà fait), 6, 7, 8 de chaque lot et raccord entre lots successifs. Refus : `400
 * VALIDATION_FAILED` (série ou grand livre d'un autre terminal), `400 BATCH_SIGNATURE_INVALID`, `400
 * SEQ_OUT_OF_ORDER` (numéros non continus ou lots qui se chevauchent), `CHAIN_BROKEN` (empreinte d'opération, dernière
 * empreinte ou raccord entre deux lots contigus).
 */
export function verifyImportBatches(
  batches: readonly ParsedBatch[],
  terminal: ImportTerminal,
): void {
  for (const batch of batches) {
    const { header } = batch;
    if (header.deviceSerial !== terminal.serial) throw invalid('header.device_serial');
    if (terminal.ledgerId === null || header.ledgerId !== terminal.ledgerId.toLowerCase())
      throw invalid('header.ledger_id');
    checkSignature(batch, terminal.publicKey);
    checkContinuity(batch);
    if (!verifyChain(batch).consistent) throw new ProblemException('CHAIN_BROKEN');
  }
  const sorted = [...batches].sort((a, b) =>
    a.header.seqFrom < b.header.seqFrom ? -1 : a.header.seqFrom > b.header.seqFrom ? 1 : 0,
  );
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!.header;
    const cur = sorted[i]!.header;
    if (cur.seqFrom <= prev.seqTo)
      throw new ProblemException('SEQ_OUT_OF_ORDER', {
        status: 400,
        detail: 'Deux lots de l’export se chevauchent.',
      });
    if (cur.seqFrom === prev.seqTo + 1n && !cur.prevChainHash.equals(prev.lastChainHash))
      throw new ProblemException('CHAIN_BROKEN');
  }
}

/** Opérations d'un lot sous la forme que prend le processeur (empreintes recalculées). */
export function parsedOperations(batch: ParsedBatch): ParsedOperation[] {
  const chain = verifyChain(batch);
  return batch.operations.map((op, i) => ({
    seq: op.seq,
    raw: op.raw,
    type: op.type,
    contentSha256: chain.opHashes[i]!,
  }));
}

/** SHA-256 du JCS (RFC 8785) de `batches` tel que stocké. */
export function batchesSha256(stored: unknown): Buffer {
  const canonical = canonicalize(stored);
  if (canonical === undefined) throw invalid('batches : non sérialisable.');
  return createHash('sha256').update(canonical, 'utf8').digest();
}

export interface ImportSummary {
  batch_count: number;
  operation_count: number;
  /** Somme des `PURCHASE` en unités mineures, en TEXTE (bigint). */
  sales_total: string;
  seq_min: number;
  seq_max: number;
  last_seen_at: string | null;
  /** Opérations datées après la dernière présence du terminal (au plus 100 numéros listés). */
  after_last_seen: { count: number; seqs: number[] };
}

/** Synthèse montrée à l'approbateur : calculée sur les lots vérifiés, jamais d'une valeur déclarée. */
export function summarize(batches: readonly ParsedBatch[], lastSeenAt: Date | null): ImportSummary {
  let operations = 0;
  let sales = 0n;
  let min: bigint | null = null;
  let max: bigint | null = null;
  const after: number[] = [];
  let afterCount = 0;
  for (const batch of batches) {
    if (min === null || batch.header.seqFrom < min) min = batch.header.seqFrom;
    if (max === null || batch.header.seqTo > max) max = batch.header.seqTo;
    for (const op of batch.operations) {
      operations += 1;
      const amount = op.raw.amount;
      if (op.type === 'PURCHASE' && typeof amount === 'number' && Number.isSafeInteger(amount))
        sales += BigInt(amount);
      const at = typeof op.raw.occurred_at === 'string' ? Date.parse(op.raw.occurred_at) : NaN;
      if (lastSeenAt !== null && !Number.isNaN(at) && at > lastSeenAt.getTime()) {
        afterCount += 1;
        if (after.length < 100) after.push(Number(op.seq));
      }
    }
  }
  return {
    batch_count: batches.length,
    operation_count: operations,
    sales_total: sales.toString(),
    seq_min: Number(min ?? 0n),
    seq_max: Number(max ?? 0n),
    last_seen_at: lastSeenAt ? lastSeenAt.toISOString() : null,
    after_last_seen: { count: afterCount, seqs: after },
  };
}

/** Terminal et grand livre de son événement, lus sous la RLS du prestataire ; `null` : inconnu ou d'un autre prestataire. */
export async function readImportTerminal(
  client: TxClient,
  deviceId: string,
): Promise<ImportTerminal | null> {
  const { rows } = await client.query<{
    id: string;
    operator_id: string;
    serial: string;
    status: string;
    public_key: Buffer | null;
    ledger_id: string | null;
    event_id: string | null;
    last_seen_at: Date | null;
  }>(
    `SELECT d.id, d.operator_id, d.serial, d.status, d.public_key, d.event_id, d.last_seen_at,
            l.id AS ledger_id
       FROM device d
       LEFT JOIN event e ON e.id = d.event_id
       LEFT JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id AND l.currency = e.currency
      WHERE d.id = $1`,
    [deviceId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    deviceId: r.id,
    operatorId: r.operator_id,
    serial: r.serial,
    status: r.status,
    publicKey: r.public_key,
    ledgerId: r.ledger_id,
    eventId: r.event_id,
    lastSeenAt: r.last_seen_at,
  };
}
