// Chaîne des opérations d'une passerelle (research R-12) : chain_hash(0) = genèse, puis
// chain_hash(n) = SHA-256(chain_hash(n-1) ‖ content_sha256(n)) (`chain_step` du schéma, l. 1973-1981).
import { createHash } from 'node:crypto';

const EDGE_CHAIN_DOMAIN = 'CASHLESS/EDGE-CHAIN/v1';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** SHA-256(`"CASHLESS/EDGE-CHAIN/v1"` ‖ UUID de la passerelle sur 16 octets bruts). */
export function edgeChainGenesis(gatewayId: string): Buffer {
  if (!UUID_RE.test(gatewayId))
    throw new Error('edgeChainGenesis : identifiant de passerelle non UUID');
  return createHash('sha256')
    .update(EDGE_CHAIN_DOMAIN, 'utf8')
    .update(Buffer.from(gatewayId.replace(/-/g, ''), 'hex'))
    .digest();
}

/** SHA-256(prev ‖ content). */
export const chainStep = (prev: Buffer, content: Buffer): Buffer =>
  createHash('sha256').update(prev).update(content).digest();
