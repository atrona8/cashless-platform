// Signature de l'en-tête d'un snapshot (WP13, T054 ; research R-07). ECDSA P-256 / SHA-256 sur `JCS(en-tête)`, format
// DER (le port calcule lui-même le SHA-256, on lui passe les octets canoniques). Base64 : à la charge de l'API.
// Cette fonction n'accepte qu'un `VerifiedDraft`, sortie `ok: true` de `verifyDraft` : aucun chemin ne signe un
// brouillon non vérifié. Rien n'est journalisé ici (ni octets, ni signature, ni clé).
// Avant de rendre la signature, elle est vérifiée avec la clé publique du port pour la MÊME référence : une
// référence de clé fausse (désactivée, autre type) ou une signature corrompue ne produit jamais de publication.
// Décision du porteur (02/11/2026) : après la signature, `verifyWithPublishedKey` la revérifie avec la clé publique
// PUBLIÉE du `key_id` de l'en-tête (`snapshot_public_keys`, seul droit de lecture accordé au rôle). Une référence KMS
// qui désigne une autre clé que celle du `key_id`, une clé introuvable ou non ACTIVE : rien n'est publié.
import { createPublicKey, verify } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { SignPort } from '../kms/kms.ports';
import type { VerifiedDraft } from './draft-verifier';

/** La signature rendue par le port ne se vérifie pas avec sa propre clé publique. */
export class SignatureInvalidError extends Error {
  constructor() {
    super('Signature de snapshot invalide : rien n’est publié');
    this.name = 'SignatureInvalidError';
  }
}

/** Octets signés : `JCS(en-tête)` en UTF-8. */
export function headerMessage(verified: VerifiedDraft): Buffer {
  const canonical = canonicalize(verified.header);
  if (canonical === undefined) throw new Error('En-tête non canonicalisable');
  return Buffer.from(canonical, 'utf8');
}

export async function signHeader(
  kms: SignPort,
  kmsKeyRef: string,
  verified: VerifiedDraft,
): Promise<Buffer> {
  const message = headerMessage(verified);
  const signature = await kms.sign(kmsKeyRef, message);
  const publicKey = createPublicKey({
    key: await kms.publicKey(kmsKeyRef),
    format: 'der',
    type: 'spki',
  });
  if (!verify('sha256', message, { key: publicKey, dsaEncoding: 'der' }, signature))
    throw new SignatureInvalidError();
  return signature;
}

/** Clé publique publiée (`snapshot_public_keys`) : `notAfter` nul = ACTIVE, sinon RETIRED. */
export interface PublishedKey {
  keyId: string;
  algorithm: string;
  publicKey: Buffer;
  notAfter: Date | null;
}

/** La signature ne correspond pas à la clé publiée du `key_id` : `reason` est un code court, sans valeur. */
export class PublishedKeyError extends Error {
  constructor(
    readonly reason: 'KEY_NOT_PUBLISHED' | 'KEY_NOT_ACTIVE' | 'SIGNATURE_VS_PUBLISHED_KEY',
  ) {
    super(`Clé publiée du key_id : ${reason}`);
    this.name = 'PublishedKeyError';
  }
}

export function verifyWithPublishedKey(
  verified: VerifiedDraft,
  signature: Buffer,
  keys: PublishedKey[],
): void {
  const key = keys.find((candidate) => candidate.keyId === verified.keyId);
  if (key === undefined) throw new PublishedKeyError('KEY_NOT_PUBLISHED');
  if (key.notAfter !== null || key.algorithm !== 'ECDSA_P256_SHA256')
    throw new PublishedKeyError('KEY_NOT_ACTIVE');
  let ok = false;
  try {
    ok = verify(
      'sha256',
      headerMessage(verified),
      {
        key: createPublicKey({ key: key.publicKey, format: 'der', type: 'spki' }),
        dsaEncoding: 'der',
      },
      signature,
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new PublishedKeyError('SIGNATURE_VS_PUBLISHED_KEY');
}
