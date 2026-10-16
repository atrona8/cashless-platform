// Stockage chiffré de PWD‖PACK (SPECIFICATION §7.4) : AES-256-GCM sous la clé de données.
// Valeur stockée : nonce (12) ‖ chiffré (6) ‖ étiquette (16) = 34 octets. L'AAD lie le secret à CE bracelet.
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { TagFormatError, requireLength } from './errors';
import { assertKeyIndex } from './format-b';
import { PWD_PACK_LENGTH, assertUid, uuidToBytes } from './kdf';

const AAD_PREFIX = Buffer.from('CASHLESS/PWDPACK/v1', 'ascii');
export const DEK_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const PWD_PACK_ENC_LENGTH = NONCE_LENGTH + PWD_PACK_LENGTH + TAG_LENGTH;

export function pwdPackAad(input: {
  mediaId: string;
  operatorId: string;
  keyIndex: number;
  uid: Uint8Array;
}): Buffer {
  assertKeyIndex(input.keyIndex);
  assertUid(input.uid);
  const keyIndex = Buffer.alloc(2);
  keyIndex.writeUInt16BE(input.keyIndex);
  return Buffer.concat([
    AAD_PREFIX,
    uuidToBytes(input.mediaId),
    uuidToBytes(input.operatorId),
    keyIndex,
    input.uid,
  ]);
}

/** Le nonce est fourni par l'appelant (12 octets aléatoires en production) : la bibliothèque ne tire aucun aléa ici. */
export function sealPwdPack(input: {
  dek: Uint8Array;
  nonce: Uint8Array;
  pwdPack: Uint8Array;
  aad: Uint8Array;
}): Buffer {
  requireLength(input.dek, DEK_LENGTH, 'BAD_KEY', 'clé de données');
  requireLength(input.nonce, NONCE_LENGTH, 'BAD_LENGTH', 'nonce');
  requireLength(input.pwdPack, PWD_PACK_LENGTH, 'BAD_LENGTH', 'PWD‖PACK');
  const cipher = createCipheriv('aes-256-gcm', input.dek, input.nonce);
  cipher.setAAD(input.aad);
  const ciphertext = Buffer.concat([cipher.update(input.pwdPack), cipher.final()]);
  return Buffer.concat([input.nonce, ciphertext, cipher.getAuthTag()]);
}

export function openPwdPack(input: { dek: Uint8Array; blob: Uint8Array; aad: Uint8Array }): Buffer {
  requireLength(input.dek, DEK_LENGTH, 'BAD_KEY', 'clé de données');
  requireLength(input.blob, PWD_PACK_ENC_LENGTH, 'BAD_LENGTH', 'pwd_pack_enc');
  const decipher = createDecipheriv('aes-256-gcm', input.dek, input.blob.subarray(0, NONCE_LENGTH));
  decipher.setAAD(input.aad);
  decipher.setAuthTag(input.blob.subarray(NONCE_LENGTH + PWD_PACK_LENGTH));
  // Morceaux intermédiaires en clair mis à zéro après la copie (le tampon rendu est à effacer par l'appelant).
  let head: Buffer | null = null;
  let tail: Buffer | null = null;
  try {
    head = decipher.update(input.blob.subarray(NONCE_LENGTH, NONCE_LENGTH + PWD_PACK_LENGTH));
    tail = decipher.final();
    return Buffer.concat([head, tail]);
  } catch {
    throw new TagFormatError('AUTH_FAILED', 'déchiffrement refusé : clé, chiffré ou AAD incorrect');
  } finally {
    head?.fill(0);
    tail?.fill(0);
  }
}
