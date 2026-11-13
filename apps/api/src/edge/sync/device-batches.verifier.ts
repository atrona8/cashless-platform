// Lots de terminal relayés (WP13, T061 ; R-12). Pour chaque `device_batch_id` cité par une
// opération
// `DEVICE_OFFLINE` : (a) signature ECDSA P-256 de l'en-tête d'ORIGINE (JCS) avec
// `device.public_key` du terminal de
// l'événement de la passerelle (sinon `400 BATCH_SIGNATURE_INVALID`) ; (b) chaîne du terminal
// recalculée avec les
// fonctions pures de `@cashless/shared-rules`, jusqu'à `header.last_chain_hash` quand toutes les
// opérations du lot
// d'origine sont dans ce lot (sinon `409 CHAIN_BROKEN`) ; (c) chaque opération `DEVICE_OFFLINE`
// cite un lot présent,
// du même terminal que `device_serial`. Terminal révoqué, inconnu ou d'un autre événement : refus
// uniforme. Aucune
// signature par opération n'existe : le terminal signe l'en-tête. L'API écrase ensuite
// `device_batch_verified`.
import { createPublicKey, verify } from 'node:crypto';
import { chainedContent, chainStep, contentSha256 } from '@cashless/shared-rules';
import canonicalize from 'canonicalize';
import { ProblemException } from '../../errors/problem';
import type { EdgeGateway } from '../auth/edge-gateway';
import type { ParsedEdgeBatch } from './edge-sync-body';
import type { EdgeSyncCentral } from './edge-sync-central.port';

const refuseSignature = (): ProblemException => new ProblemException('BATCH_SIGNATURE_INVALID');
const malformed = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

interface RelayedHeader {
  deviceSerial: string;
  seqFrom: bigint;
  seqTo: bigint;
  prev: string;
  last: string;
}

function header(raw: Record<string, unknown>): RelayedHeader {
  const asSeq = (v: unknown): bigint => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1)
      throw malformed('device_batches : numéro invalide.');
    return BigInt(v);
  };
  if (
    typeof raw.device_serial !== 'string' ||
    typeof raw.prev_chain_hash !== 'string' ||
    typeof raw.last_chain_hash !== 'string' ||
    typeof raw.batch_id !== 'string' ||
    typeof raw.ledger_id !== 'string'
  )
    throw malformed('device_batches : en-tête incomplet.');
  return {
    deviceSerial: raw.device_serial,
    seqFrom: asSeq(raw.seq_from),
    seqTo: asSeq(raw.seq_to),
    prev: raw.prev_chain_hash.toLowerCase(),
    last: raw.last_chain_hash.toLowerCase(),
  };
}

function signatureValid(
  raw: Record<string, unknown>,
  signature: string,
  spki: Buffer | null,
): boolean {
  if (spki === null) return false;
  try {
    const canonical = canonicalize(raw);
    if (canonical === undefined) return false;
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return verify(
      'sha256',
      Buffer.from(canonical, 'utf8'),
      { key, dsaEncoding: 'der' },
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Identifiants des lots de terminal vérifiés ; lève sans rien écrire au premier défaut. */
export async function verifyDeviceBatches(
  gateway: EdgeGateway,
  batch: ParsedEdgeBatch,
  central: EdgeSyncCentral,
): Promise<Set<string>> {
  const relayed = batch.operations.filter((op) => op.mode === 'DEVICE_OFFLINE');
  const entries = new Map<
    string,
    { header: RelayedHeader; raw: Record<string, unknown>; sig: string }
  >();
  for (const entry of (batch.raw.device_batches as Array<Record<string, unknown>> | undefined) ??
    []) {
    const raw = entry.header as Record<string, unknown>;
    const id = typeof raw.batch_id === 'string' ? raw.batch_id.toLowerCase() : '';
    entries.set(id, { header: header(raw), raw, sig: entry.signature as string });
  }
  const verified = new Set<string>();
  for (const op of relayed) {
    const id = op.deviceBatchId;
    const entry = id === null ? undefined : entries.get(id);
    if (id === null || entry === undefined)
      throw malformed('device_batch_id absent des device_batches.');
    if (entry.header.deviceSerial !== op.deviceSerial)
      throw malformed('device_batch_id d’un autre terminal que device_serial.');
    if (String(entry.raw.ledger_id).toLowerCase() !== gateway.ledgerId) throw refuseSignature();
    if (verified.has(id)) continue;
    const device = await central.device(gateway, op.deviceSerial);
    if (device === null || device.status === 'REVOKED') throw refuseSignature();
    if (!signatureValid(entry.raw, entry.sig, device.publicKey)) throw refuseSignature();
    verified.add(id);
  }
  for (const id of verified) verifyTerminalChain(batch, id, entries.get(id)!.header);
  return verified;
}

/**
 * Chaîne du terminal des opérations relayées de ce lot d'origine (R-12 : `chain_hash` = maillon du
 * terminal).
 */
function verifyTerminalChain(batch: ParsedEdgeBatch, id: string, h: RelayedHeader): void {
  const ops = batch.operations
    .filter((op) => op.deviceBatchId === id && op.mode === 'DEVICE_OFFLINE')
    .map((op) => ({ seq: op.raw.seq, chain: op.raw.chain_hash, raw: op.raw }))
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  let previous: Buffer | null = null;
  let expectedSeq: bigint | null = null;
  for (const op of ops) {
    if (typeof op.seq !== 'number' || typeof op.chain !== 'string')
      throw malformed('Opération relayée sans seq ni chain_hash.');
    const seq = BigInt(op.seq);
    if (expectedSeq === null) {
      // Premier numéro présent : relié à l'en-tête seulement s'il est le premier du lot d'origine.
      if (seq === h.seqFrom) previous = Buffer.from(h.prev, 'hex');
    } else if (seq !== expectedSeq) {
      previous = null;
    }
    if (previous !== null) {
      const link = chainStep(previous, contentSha256(chainedContent(op.raw)));
      if (link.toString('hex') !== op.chain.toLowerCase())
        throw new ProblemException('CHAIN_BROKEN', {
          status: 409,
          detail: 'Chaîne du terminal rompue.',
        });
    }
    previous = Buffer.from(op.chain, 'hex');
    expectedSeq = seq + 1n;
  }
  // Lot d'origine complet dans ce lot : le dernier maillon est celui de l'en-tête signé.
  const complete =
    ops.length > 0 &&
    BigInt(ops.length) === h.seqTo - h.seqFrom + 1n &&
    BigInt(ops[0]!.seq as number) === h.seqFrom;
  if (complete && previous !== null && previous.toString('hex') !== h.last)
    throw new ProblemException('CHAIN_BROKEN', {
      status: 409,
      detail: 'Chaîne du terminal rompue.',
    });
}
