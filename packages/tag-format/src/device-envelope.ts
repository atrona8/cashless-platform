// Enveloppe d'un secret pour un destinataire (terminal ou poste de personnalisation) : le mot de passe d'un bracelet
// n'est jamais transmis en clair. Forme du contrat (`EncryptedBlob` de openapi.yaml) :
//   ECDH-ES P-256 (clé éphémère de l'émetteur × clé publique du destinataire) → HKDF-SHA256 → AES-256-GCM.
// Le contrat fixe les algorithmes et l'AAD, pas les paramètres de HKDF : sel vide et `info` = AAD, de sorte que la clé
// de chiffrement est elle aussi liée au destinataire et au bracelet.
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { TagFormatError, requireLength } from './errors';
import { assertUid, uuidToBytes } from './kdf';

const MAX_U64 = (1n << 64n) - 1n;
const TOKEN_HASH_LENGTH = 32;
const GCM_TAG_LENGTH = 16;

export const RECIPIENT_ALG = 'ECDH-ES+HKDF-SHA256+A256GCM';
export const P256_PUBLIC_KEY_LENGTH = 65; // point non compressé : 04 ‖ X ‖ Y

export interface EncryptedBlob {
  alg: typeof RECIPIENT_ALG;
  /** Clé publique éphémère, point non compressé, base64url. */
  epk: string;
  /** base64 */
  nonce: string;
  /** base64 */
  ciphertext: string;
  /** base64 */
  tag: string;
}

/** AAD de l'enveloppe remise à un terminal (`POST /media/auth-keys`). */
export function deviceAad(deviceId: string, uid: Uint8Array): Buffer {
  assertUid(uid);
  return Buffer.concat([
    Buffer.from('CASHLESS/PWDPACK/DEV/v1', 'ascii'),
    uuidToBytes(deviceId),
    uid,
  ]);
}

/** AAD de l'enveloppe remise à un poste de personnalisation. */
export function stationAad(mediaId: string, uid: Uint8Array): Buffer {
  assertUid(uid);
  return Buffer.concat([
    Buffer.from('CASHLESS/PWDPACK/PERSO/v1', 'ascii'),
    uuidToBytes(mediaId),
    uid,
  ]);
}

function versionBytes(version: bigint): Buffer {
  if (typeof version !== 'bigint' || version < 0n || version > MAX_U64)
    throw new TagFormatError('BAD_LENGTH', 'version de snapshot : entier de 0 à 2^64-1 attendu');
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(version);
  return out;
}

/** AAD de l'enveloppe de la clé de contenu `K_v` d'un terminal (snapshot hors ligne, R-08). */
export function snapshotKeyAad(ledgerId: string, version: bigint, deviceId: string): Buffer {
  return Buffer.concat([
    Buffer.from('CASHLESS/SNAPKEY/v1', 'ascii'),
    uuidToBytes(ledgerId),
    versionBytes(version),
    uuidToBytes(deviceId),
  ]);
}

/** AAD d'un mot de passe de bracelet chiffré sous `K_v` dans un snapshot (R-08). */
export function snapshotPwdAad(
  ledgerId: string,
  version: bigint,
  tokenHash: Uint8Array,
  nfcUid: Uint8Array,
): Buffer {
  requireLength(tokenHash, TOKEN_HASH_LENGTH, 'BAD_LENGTH', 'token_hash');
  assertUid(nfcUid);
  return Buffer.concat([
    Buffer.from('CASHLESS/SNAPPWD/v1', 'ascii'),
    uuidToBytes(ledgerId),
    versionBytes(version),
    tokenHash,
    nfcUid,
  ]);
}

/** `WrappedKey` du contrat : `iv` = nonce, `wrapped_key` = chiffré ‖ étiquette (base64). */
export interface WrappedKey {
  alg: typeof RECIPIENT_ALG;
  /** Clé publique éphémère, point non compressé, base64url. */
  epk: string;
  /** Nonce AES-GCM de 12 octets, base64. */
  iv: string;
  /** Chiffré ‖ étiquette d'authentification de 16 octets, base64. */
  wrapped_key: string;
}

export function toWrappedKey(blob: EncryptedBlob): WrappedKey {
  const sealed = Buffer.concat([
    Buffer.from(blob.ciphertext, 'base64'),
    Buffer.from(blob.tag, 'base64'),
  ]);
  return { alg: blob.alg, epk: blob.epk, iv: blob.nonce, wrapped_key: sealed.toString('base64') };
}

export function fromWrappedKey(key: WrappedKey): EncryptedBlob {
  if (key.alg !== RECIPIENT_ALG)
    throw new TagFormatError('AUTH_FAILED', 'algorithme d’enveloppe inconnu');
  const sealed = Buffer.from(key.wrapped_key, 'base64');
  if (sealed.length <= GCM_TAG_LENGTH)
    throw new TagFormatError('BAD_LENGTH', 'wrapped_key : chiffré et étiquette attendus');
  return {
    alg: key.alg,
    epk: key.epk,
    nonce: key.iv,
    ciphertext: sealed.subarray(0, sealed.length - GCM_TAG_LENGTH).toString('base64'),
    tag: sealed.subarray(sealed.length - GCM_TAG_LENGTH).toString('base64'),
  };
}

function contentKey(shared: Buffer, aad: Uint8Array): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), aad, 32));
}

function assertPublicKey(key: Uint8Array): void {
  requireLength(key, P256_PUBLIC_KEY_LENGTH, 'BAD_KEY', 'clé publique P-256');
  if (key[0] !== 0x04)
    throw new TagFormatError('BAD_KEY', 'clé publique P-256 : point non compressé attendu');
}

export function sealForRecipient(input: {
  recipientPublicKey: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}): EncryptedBlob {
  assertPublicKey(input.recipientPublicKey);
  const ephemeral = createECDH('prime256v1');
  ephemeral.generateKeys();
  let shared: Buffer;
  try {
    shared = ephemeral.computeSecret(input.recipientPublicKey);
  } catch {
    throw new TagFormatError('BAD_KEY', 'clé publique P-256 invalide');
  }
  const key = contentKey(shared, input.aad);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(input.aad);
    const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
    return {
      alg: RECIPIENT_ALG,
      epk: ephemeral.getPublicKey().toString('base64url'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  } finally {
    shared.fill(0);
    key.fill(0);
  }
}

/** Ouverture côté destinataire (tests, faux terminal). `recipientPrivateKey` : scalaire P-256 de 32 octets. */
export function openForRecipient(input: {
  recipientPrivateKey: Uint8Array;
  blob: EncryptedBlob;
  aad: Uint8Array;
}): Buffer {
  if (input.blob.alg !== RECIPIENT_ALG)
    throw new TagFormatError('AUTH_FAILED', 'algorithme d’enveloppe inconnu');
  const recipient = createECDH('prime256v1');
  let key: Buffer | undefined;
  try {
    recipient.setPrivateKey(Buffer.from(input.recipientPrivateKey));
    key = contentKey(recipient.computeSecret(Buffer.from(input.blob.epk, 'base64url')), input.aad);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.blob.nonce, 'base64'));
    decipher.setAAD(input.aad);
    decipher.setAuthTag(Buffer.from(input.blob.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(input.blob.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } catch {
    throw new TagFormatError('AUTH_FAILED', 'ouverture de l’enveloppe refusée');
  } finally {
    key?.fill(0);
  }
}
