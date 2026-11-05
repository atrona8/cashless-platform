// Contrôles d'entrée d'un lot (mission 7, lot WP18 ; contracts/batches.md, tableau « contrôles d'entrée », dans cet
// ordre exact, le premier refus gagne). Aucune valeur reçue n'apparaît dans un message d'erreur : seulement le chemin
// du champ fautif. Les contrôles 1 et 2 (taille, JSON) sont dans `batch-body.ts` et `raw-json.ts`; le 8 (chaîne) dans
// `batch-chain.ts`; le 10 (`open_offline_batch`) dans `batch-runner.ts`.
//   3 schéma, 4 liaisons à la requête, 5 époque, 6 signature, 7 continuité, 9 autorité de débit.
import { createPublicKey, verify } from 'node:crypto';
import canonicalize from 'canonicalize';
import { ProblemException } from '../../errors/problem';
import {
  ENTRY_OPERATION_TYPES,
  MAX_BATCH_OPERATIONS,
  type EntryOperationType,
  type ParsedBatch,
  type ParsedHeader,
  type ReceivedOperation,
} from './batch.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const invalid = (path: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', {
    status: 400,
    detail: `Lot invalide : ${path}.`,
  });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isSafeSeq = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

const isTimestamp = (v: unknown): boolean =>
  typeof v === 'string' && TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v));

/** Contrôle 3 : schéma, 1 à 500 opérations, `count = |ops| = seq_to - seq_from + 1`, types permis. */
export function parseBatchShape(parsed: unknown): ParsedBatch {
  if (!isObject(parsed)) throw invalid('/');
  const { header, operations, signature } = parsed;
  if (!isObject(header)) throw invalid('/header');
  if (!Array.isArray(operations)) throw invalid('/operations');
  if (operations.length === 0) throw invalid('/operations (vide)');
  if (operations.length > MAX_BATCH_OPERATIONS)
    throw new ProblemException('BATCH_TOO_LARGE', { status: 413 });
  if (typeof signature !== 'string') throw invalid('/signature');

  if (typeof header.batch_id !== 'string' || !UUID.test(header.batch_id))
    throw invalid('/header/batch_id');
  if (typeof header.device_serial !== 'string' || header.device_serial === '')
    throw invalid('/header/device_serial');
  if (typeof header.ledger_id !== 'string' || !UUID.test(header.ledger_id))
    throw invalid('/header/ledger_id');
  const epoch = header.authority_epoch;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0)
    throw invalid('/header/authority_epoch');
  if (!isSafeSeq(header.seq_from)) throw invalid('/header/seq_from');
  if (!isSafeSeq(header.seq_to)) throw invalid('/header/seq_to');
  if (!isTimestamp(header.created_at)) throw invalid('/header/created_at');
  if (typeof header.prev_chain_hash !== 'string' || !HEX32.test(header.prev_chain_hash))
    throw invalid('/header/prev_chain_hash');
  if (typeof header.last_chain_hash !== 'string' || !HEX32.test(header.last_chain_hash))
    throw invalid('/header/last_chain_hash');
  const seqFrom = BigInt(header.seq_from);
  const seqTo = BigInt(header.seq_to);
  if (
    header.count !== operations.length ||
    seqTo < seqFrom ||
    seqTo - seqFrom + 1n !== BigInt(operations.length)
  )
    throw invalid('/header/count, seq_from, seq_to (incohérents avec les opérations)');

  const ops: ReceivedOperation[] = operations.map((op: unknown, index) => {
    const at = `/operations/${index}`;
    if (!isObject(op)) throw invalid(at);
    if (!isSafeSeq(op.seq)) throw invalid(`${at}/seq`);
    if (
      typeof op.type !== 'string' ||
      !(ENTRY_OPERATION_TYPES as readonly string[]).includes(op.type)
    )
      throw invalid(`${at}/type`);
    if (!isTimestamp(op.occurred_at)) throw invalid(`${at}/occurred_at`);
    if (typeof op.chain_hash !== 'string' || !HEX32.test(op.chain_hash))
      throw invalid(`${at}/chain_hash`);
    return {
      seq: BigInt(op.seq),
      raw: op,
      type: op.type as EntryOperationType,
      chainHash: Buffer.from(op.chain_hash, 'hex'),
    };
  });

  const parsedHeader: ParsedHeader = {
    raw: header,
    batchId: header.batch_id.toLowerCase(),
    deviceSerial: header.device_serial,
    ledgerId: header.ledger_id.toLowerCase(),
    authorityEpoch: epoch,
    seqFrom,
    seqTo,
    prevChainHash: Buffer.from(header.prev_chain_hash, 'hex'),
    lastChainHash: Buffer.from(header.last_chain_hash, 'hex'),
  };
  return { header: parsedHeader, operations: ops, signature };
}

export interface RequestBindings {
  /** En-tête `Idempotency-Key` de la requête. */
  idempotencyKey: string | undefined;
  /** En-tête `X-Authority-Epoch` de la requête. */
  epochHeader: string | undefined;
  /** Série du terminal authentifié (lue en base, jamais sur parole). */
  serial: string;
  /** Grand livre de l'événement du terminal, `null` s'il n'en a pas. */
  ledgerId: string | null;
}

/** Contrôle 4 : `Idempotency-Key`, série, grand livre, `X-Authority-Epoch` égaux à ceux de l'en-tête signé. */
export function checkBindings(batch: ParsedBatch, req: RequestBindings): void {
  const { header } = batch;
  if (
    req.idempotencyKey === undefined ||
    req.idempotencyKey.trim().toLowerCase() !== header.batchId
  )
    throw invalid('Idempotency-Key différente de header.batch_id');
  if (header.deviceSerial !== req.serial) throw invalid('header.device_serial');
  if (req.ledgerId === null || header.ledgerId !== req.ledgerId.toLowerCase())
    throw invalid('header.ledger_id');
  const raw = req.epochHeader;
  if (raw === undefined || raw.trim() === '')
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'X-Authority-Epoch : en-tête obligatoire sur un lot.',
    });
  if (!/^[0-9]{1,15}$/.test(raw.trim()))
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'X-Authority-Epoch : entier positif ou nul attendu.',
    });
  if (Number(raw.trim()) !== header.authorityEpoch) throw invalid('X-Authority-Epoch');
}

/** Contrôle 5 : époque du lot inférieure à l'époque courante -> 409 (avec l'époque courante) ; supérieure -> 400. */
export function checkEpoch(batch: ParsedBatch, current: number): void {
  const epoch = batch.header.authorityEpoch;
  if (epoch < current)
    throw new ProblemException('STALE_AUTHORITY_EPOCH', {
      extensions: { authority_epoch: current },
    });
  if (epoch > current) throw invalid('header.authority_epoch (supérieure à l’époque courante)');
}

/**
 * Contrôle 6 : ECDSA P-256 / SHA-256 de `JCS(header)`, signature DER STRICTE (une signature IEEE P1363 de 64 octets
 * est refusée), par la clé publique SPKI du terminal. Toute impossibilité (clé absente, base64 invalide, signature
 * mal formée) vaut signature invalide : `400 BATCH_SIGNATURE_INVALID`.
 */
export function checkSignature(batch: ParsedBatch, publicKeySpki: Buffer | null): void {
  const refuse = (): never => {
    throw new ProblemException('BATCH_SIGNATURE_INVALID');
  };
  if (publicKeySpki === null) return refuse();
  if (!BASE64.test(batch.signature) || batch.signature === '') return refuse();
  const signature = Buffer.from(batch.signature, 'base64');
  const canonical = canonicalize(batch.header.raw);
  if (canonical === undefined) return refuse();
  let ok = false;
  try {
    const key = createPublicKey({ key: publicKeySpki, format: 'der', type: 'spki' });
    ok = verify('sha256', Buffer.from(canonical, 'utf8'), { key, dsaEncoding: 'der' }, signature);
  } catch {
    ok = false;
  }
  if (!ok) refuse();
}

/** Contrôle 7 : numéros continus d'une opération à la suivante, le premier égal à `seq_from`. */
export function checkContinuity(batch: ParsedBatch): void {
  let expected = batch.header.seqFrom;
  for (const op of batch.operations) {
    if (op.seq !== expected)
      throw new ProblemException('SEQ_OUT_OF_ORDER', {
        status: 400,
        detail: 'Les numéros des opérations ne sont pas continus à partir de seq_from.',
      });
    expected += 1n;
  }
}

/** Contrôle 9 : le central ne reçoit pas de lot tant que la passerelle détient l'autorité de débit. */
export function checkAuthority(authority: string | null, moving: boolean): void {
  if (authority === 'EDGE')
    throw new ProblemException(moving ? 'DEBIT_AUTHORITY_MOVING' : 'DEBIT_AUTHORITY_EDGE');
}
