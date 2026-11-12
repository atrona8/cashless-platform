// Contrôles d'entrée d'un lot hors ligne sur la passerelle (WP23, T103 ; contrat des lots de la mission 7,
// `batch-intake.ts` / `batch-chain.ts` de l'API, RÉÉCRITS ici : le code de l'API est lié à la base
// centrale et ne s'importe pas). La chaîne et le contenu haché viennent du code partagé
// (`@cashless/shared-rules`), jamais d'une recopie de règle.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie : signature d'origine du lot, chaîne).
//
// Ordre des contrôles (le premier refus gagne), l'autorité de débit étant contrôlée par l'appelant
// (`AuthorityService.assertCanDebit`, règle INVERSÉE par rapport au central : le central refuse un lot
// sous `EDGE`, la passerelle l'exige) :
//   3 schéma et taille  ->  4 liaisons à la requête  ->  6 signature d'origine  ->  7 continuité  ->  8 chaîne.
// Aucune valeur reçue n'apparaît dans un message : seulement le chemin du champ fautif.
import { createPublicKey, verify } from 'node:crypto';
import canonicalize from 'canonicalize';
import { chainStep, chainedContent, contentSha256 } from '@cashless/shared-rules';
import { ProblemException } from '../../device-proofs/problem';

export const MAX_BATCH_OPERATIONS = 500;
export const MAX_BATCH_BYTES = 1_048_576;
/** Types admis à l'entrée d'un lot de terminal (`TOPUP_CASH` entre, puis il est rejeté : C-006). */
export const ENTRY_OPERATION_TYPES = [
  'PURCHASE',
  'REVERSAL',
  'TOPUP_CASH',
  'VOID',
  'ONLINE_REF',
] as const;
export type EntryOperationType = (typeof ENTRY_OPERATION_TYPES)[number];

/** Champs posés par la file (`EdgeQueue.append`) : un terminal ne peut pas les porter. */
const QUEUE_OWNED_FIELDS = ['edge_seq', 'device_serial', 'authorized_mode', 'device_batch_id'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const invalid = (path: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail: `Lot invalide : ${path}.` });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isSafeSeq = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isTimestamp = (v: unknown): boolean =>
  typeof v === 'string' && TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v));

export interface ReceivedOperation {
  seq: number;
  raw: Record<string, unknown>;
  type: EntryOperationType;
  /** `chain_hash` déclaré par le terminal (comparé au recalcul, jamais cru). */
  chainHash: Buffer;
}

export interface ParsedHeader {
  /** En-tête tel que reçu : la signature porte sur `JCS(header)`. */
  raw: Record<string, unknown>;
  batchId: string;
  deviceSerial: string;
  ledgerId: string;
  authorityEpoch: number;
  seqFrom: number;
  seqTo: number;
  prevChainHash: Buffer;
  lastChainHash: Buffer;
}

export interface ParsedBatch {
  header: ParsedHeader;
  operations: ReceivedOperation[];
  /** Signature reçue (base64 standard, DER). */
  signature: string;
}

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
  if (
    header.count !== operations.length ||
    header.seq_to < header.seq_from ||
    header.seq_to - header.seq_from + 1 !== operations.length
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
    if (op.type === 'VOID' && typeof op.void_reason !== 'string')
      throw invalid(`${at}/void_reason`);
    if (typeof op.chain_hash !== 'string' || !HEX32.test(op.chain_hash))
      throw invalid(`${at}/chain_hash`);
    for (const owned of QUEUE_OWNED_FIELDS) {
      if (op[owned] !== undefined) throw invalid(`${at}/${owned}`);
    }
    return {
      seq: op.seq,
      raw: op,
      type: op.type as EntryOperationType,
      chainHash: Buffer.from(op.chain_hash, 'hex'),
    };
  });

  return {
    header: {
      raw: header,
      batchId: header.batch_id.toLowerCase(),
      deviceSerial: header.device_serial,
      ledgerId: header.ledger_id.toLowerCase(),
      authorityEpoch: epoch,
      seqFrom: header.seq_from,
      seqTo: header.seq_to,
      prevChainHash: Buffer.from(header.prev_chain_hash, 'hex'),
      lastChainHash: Buffer.from(header.last_chain_hash, 'hex'),
    },
    operations: ops,
    signature,
  };
}

export interface RequestBindings {
  idempotencyKey: string | undefined;
  /** En-tête `X-Authority-Epoch`. */
  epochHeader: string | undefined;
  /** En-tête `X-Device-Serial`. */
  serialHeader: string | undefined;
  /** Série du terminal authentifié (copie locale, jamais sur parole). */
  serial: string;
  ledgerId: string;
}

/** Contrôle 4 : clé d'idempotence, série, grand livre, époque égaux à ceux de l'en-tête signé. */
export function checkBindings(batch: ParsedBatch, req: RequestBindings): void {
  const { header } = batch;
  if (
    req.idempotencyKey === undefined ||
    req.idempotencyKey.trim().toLowerCase() !== header.batchId
  )
    throw invalid('Idempotency-Key différente de header.batch_id');
  if (header.deviceSerial !== req.serial) throw invalid('header.device_serial');
  if (req.serialHeader !== undefined && req.serialHeader !== req.serial)
    throw invalid('X-Device-Serial');
  if (header.ledgerId !== req.ledgerId.toLowerCase()) throw invalid('header.ledger_id');
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

/**
 * Contrôle 6 : ECDSA P-256 / SHA-256 de `JCS(header)`, signature DER STRICTE (une signature IEEE
 * P1363 de 64 octets est refusée), par la clé publique SPKI du terminal AUTHENTIFIÉ (copie locale).
 * Toute impossibilité vaut signature invalide : `400 BATCH_SIGNATURE_INVALID`, lot non traité.
 */
export function checkSignature(batch: ParsedBatch, publicKeySpki: Buffer | null): void {
  const refuse = (): never => {
    throw new ProblemException('BATCH_SIGNATURE_INVALID');
  };
  if (publicKeySpki === null) return refuse();
  if (batch.signature === '' || !BASE64.test(batch.signature)) return refuse();
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
    expected += 1;
  }
}

export interface ChainCheck {
  /** `content_sha256` recalculés, dans l'ordre des numéros. */
  contentHashes: Buffer[];
  recomputedLast: Buffer;
}

/**
 * Contrôle 8 : la chaîne du terminal est RECALCULÉE (la signature n'engage que l'en-tête : les
 * empreintes des opérations ne sont jamais crues). `chain_hash(n) = SHA-256(chain_hash(n-1) ‖
 * content_sha256(n))` depuis `prev_chain_hash`, jusqu'à `header.last_chain_hash`. Rupture :
 * `409 CHAIN_BROKEN`, lot non traité.
 */
export function verifyChain(batch: ParsedBatch): ChainCheck {
  let chain = batch.header.prevChainHash;
  const contentHashes: Buffer[] = [];
  let consistent = true;
  for (const op of batch.operations) {
    const content = contentSha256(chainedContent(op.raw));
    contentHashes.push(content);
    chain = chainStep(chain, content);
    if (!chain.equals(op.chainHash)) consistent = false;
  }
  if (!chain.equals(batch.header.lastChainHash)) consistent = false;
  if (!consistent) throw new ProblemException('CHAIN_BROKEN');
  return { contentHashes, recomputedLast: chain };
}
