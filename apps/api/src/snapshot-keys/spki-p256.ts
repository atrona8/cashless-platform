// Contrôle d'une clé publique de signature de snapshots (research R-07) : la base ne vérifie que la longueur
// (91 octets) de `rotate_snapshot_signing_key`, l'API vérifie la forme avant tout appel.
import { createPublicKey } from 'node:crypto';

/** En-tête SPKI fixe d'une clé P-256 non compressée : SEQUENCE, id-ecPublicKey, prime256v1, BIT STRING 0x04. */
export const SPKI_P256_HEADER = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

export class InvalidSigningPublicKeyError extends Error {
  constructor(reason: string) {
    super(`Clé publique de signature refusée : ${reason}`);
    this.name = 'InvalidSigningPublicKeyError';
  }
}

/** Refuse tout ce qui n'est pas une clé publique P-256 SPKI DER de 91 octets, point valide sur la courbe. */
export function assertSpkiP256(publicKey: Uint8Array): void {
  const key = Buffer.from(publicKey);
  if (key.length !== 91) throw new InvalidSigningPublicKeyError('91 octets attendus');
  if (!key.subarray(0, SPKI_P256_HEADER.length).equals(SPKI_P256_HEADER))
    throw new InvalidSigningPublicKeyError('en-tête SPKI P-256 attendu');
  if (key[26] !== 0x04) throw new InvalidSigningPublicKeyError('point non compressé attendu');
  try {
    const parsed = createPublicKey({ key, format: 'der', type: 'spki' });
    if (
      parsed.asymmetricKeyType !== 'ec' ||
      parsed.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    )
      throw new Error('courbe');
  } catch {
    throw new InvalidSigningPublicKeyError('point absent de la courbe P-256');
  }
}
