// Chaîne d'un lot, RECALCULÉE par le serveur (mission 7, lot WP18, contrôle 8 de `batches.md`). La signature du lot
// n'engage que l'en-tête : les empreintes des opérations ne sont donc jamais crues. Pour chaque opération,
// `content_sha256 = SHA-256(JCS(champs chaînés))` par `chainedContent` (WP16, point unique) puis
// `chain_hash(n) = SHA-256(chain_hash(n-1) ‖ content_sha256(n))`, départ `prev_chain_hash` (sync_protocol.md §3.3).
import { chainedContent, chainStep, contentSha256 } from '@cashless/shared-rules';
import type { ParsedBatch } from './batch.types';

export interface ChainCheck {
  /** `content_sha256` recalculés, dans l'ordre des numéros (ce que reçoit `open_offline_batch`). */
  opHashes: Buffer[];
  /** Dernière empreinte de chaîne recalculée. */
  recomputedLast: Buffer;
  /** Vrai si tout `chain_hash` déclaré et `last_chain_hash` égalent le recalcul. */
  consistent: boolean;
  /**
   * `p_last_chain_hash` à passer à `open_offline_batch`. Lot cohérent : l'empreinte de l'en-tête. Lot incohérent : elle
   * doit DIFFÉRER du recalcul, sinon la base ne verrait aucun écart et ouvrirait le lot ; si l'en-tête égale le
   * recalcul (seule une empreinte intermédiaire est fausse), on passe le recalcul dont un octet est inversé.
   */
  lastForOpen: Buffer;
}

export function verifyChain(batch: ParsedBatch): ChainCheck {
  let consistent = true;
  let chain = batch.header.prevChainHash;
  const opHashes: Buffer[] = [];
  for (const op of batch.operations) {
    const content = contentSha256(chainedContent(op.raw));
    opHashes.push(content);
    chain = chainStep(chain, content);
    if (!chain.equals(op.chainHash)) consistent = false;
  }
  if (!chain.equals(batch.header.lastChainHash)) consistent = false;
  let lastForOpen = batch.header.lastChainHash;
  if (!consistent && chain.equals(lastForOpen)) {
    lastForOpen = Buffer.from(chain);
    lastForOpen[0] = lastForOpen[0]! ^ 0xff;
  }
  return { opHashes, recomputedLast: chain, consistent, lastForOpen };
}
