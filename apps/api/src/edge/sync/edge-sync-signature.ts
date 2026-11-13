// Signature du lot par la passerelle (WP13, T057 point 4 ; R-13) : ECDSA P-256 / SHA-256 sur
// `batchSigningPayload`
// (JCS du lot sans `signature`, `staff_token_audit` et `local_orders` compris), signature DER
// stricte, clé SPKI
// `edge_gateway.public_key` lue en base avec la ligne de la passerelle (jamais dans la requête).
// Toute impossibilité
// (clé absente, base64 invalide, signature mal formée) vaut signature invalide. `request_sha256`
// est l'empreinte du
// même contenu : un lot rejoué à l'identique donne la même empreinte, l'octet changé une autre.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { batchSigningPayload } from '@cashless/shared-rules';
import type { ParsedEdgeBatch } from './edge-sync-body';

export const requestSha256 = (batch: ParsedEdgeBatch): Buffer =>
  createHash('sha256').update(batchSigningPayload(batch.raw)).digest();

export function isGatewaySignatureValid(
  batch: ParsedEdgeBatch,
  publicKeySpki: Buffer | null,
): boolean {
  if (publicKeySpki === null) return false;
  try {
    const key = createPublicKey({ key: publicKeySpki, format: 'der', type: 'spki' });
    return verify(
      'sha256',
      batchSigningPayload(batch.raw),
      { key, dsaEncoding: 'der' },
      Buffer.from(batch.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
