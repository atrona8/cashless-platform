// Chaîne et ordre d'un lot (WP13, T058 ; R-12). Le central ne croit pas la chaîne de la passerelle
// : il recalcule
// `content_sha256` de chaque opération (`edgeContentSha256`) puis `chain(n) =
// chainStep(chain(n-1), content(n))` depuis
// `prev_chain_hash`. Il compare ensuite à SA chaîne (le curseur du registre, calculée en SQL par
// `record_edge_seq`) :
// la chaîne de la passerelle au dernier numéro déjà reçu doit égaler celle du central, ce qui
// couvre un
// `prev_chain_hash` falsifié mais cohérent avec un `last_chain_hash` falsifié. Aucune écriture n'a
// lieu avant.
import { chainStep, edgeChainGenesis, edgeContentSha256 } from '@cashless/shared-rules';
import { ProblemException } from '../../errors/problem';
import type { ParsedEdgeBatch } from './edge-sync-body';
import type { SyncCursor } from './edge-sync-central.port';

export interface ChainCheck {
  /** `content_sha256` de chaque opération, dans l'ordre (ce que reçoivent les enveloppes). */
  contents: Buffer[];
}

const outOfOrder = (detail: string): ProblemException =>
  new ProblemException('SEQ_OUT_OF_ORDER', { status: 409, detail });
const broken = (detail: string): ProblemException =>
  new ProblemException('CHAIN_BROKEN', { status: 409, detail });

/** Numéros continus de `edge_seq_from` à `edge_seq_to`, sans trou ni doublon. */
export function checkNumbers(batch: ParsedEdgeBatch): void {
  batch.operations.forEach((op, i) => {
    if (op.edgeSeq !== batch.from + BigInt(i))
      throw outOfOrder(
        'Les numéros des opérations ne sont pas continus à partir de edge_seq_from.',
      );
  });
  if (batch.to !== batch.from + BigInt(batch.operations.length) - 1n)
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'edge_seq_to ne correspond pas au nombre d’opérations.',
    });
}

/**
 * `edge_seq_from` au plus égal au suivant attendu (au-delà : `SEQ_OUT_OF_ORDER`), chaîne
 * recalculée, maillons des opérations `EDGE_ONLINE` égaux au recalcul, chaîne de la passerelle
 * au dernier numéro reçu égale à celle du central.
 */
export function verifyEdgeChain(
  batch: ParsedEdgeBatch,
  cursor: SyncCursor,
  gatewayId: string,
): ChainCheck {
  checkNumbers(batch);
  const expected = cursor.contiguousEdgeSeq + 1n;
  if (batch.from > expected)
    throw outOfOrder(`edge_seq_from ${batch.from} reçu, ${expected} attendu.`);
  // Lot sans opération : il ne recouvre aucun numéro, il se place exactement après le dernier reçu.
  if (batch.operations.length === 0 && batch.from !== expected)
    throw outOfOrder(`lot sans opération : edge_seq_from ${batch.from} reçu, ${expected} attendu.`);
  const central = cursor.lastChainHash ?? edgeChainGenesis(gatewayId);
  const contents: Buffer[] = [];
  let chain = batch.prevChainHash;
  // Chaîne de la passerelle au numéro `contiguous` (déjà reçu par le central), s'il est dans ou
  // juste avant le lot.
  let atCursor: Buffer | null = batch.from - 1n === cursor.contiguousEdgeSeq ? chain : null;
  batch.operations.forEach((op) => {
    let content: Buffer;
    try {
      content = edgeContentSha256(op.raw as never);
    } catch {
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: `Opération ${op.edgeSeq} : contenu non canonisable.`,
      });
    }
    contents.push(content);
    chain = chainStep(chain, content);
    // Maillon d'une opération EDGE_ONLINE : chaîne de la passerelle (R-12) ; pour DEVICE_OFFLINE,
    // celui du terminal.
    if (op.mode === 'EDGE_ONLINE') {
      const declared = op.raw.chain_hash;
      if (typeof declared !== 'string' || declared.toLowerCase() !== chain.toString('hex'))
        throw broken(`Opération ${op.edgeSeq} : maillon de chaîne différent du recalcul.`);
    }
    if (op.edgeSeq === cursor.contiguousEdgeSeq) atCursor = chain;
  });
  if (!chain.equals(batch.lastChainHash)) throw broken('last_chain_hash différent du recalcul.');
  // Le lot recouvre le curseur du central : leurs chaînes doivent coïncider à ce numéro.
  if (atCursor !== null && !atCursor.equals(central))
    throw broken('La chaîne de la passerelle diffère de celle du central.');
  return { contents };
}
