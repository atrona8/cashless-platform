// Cryptographie des colis de mots de passe sur la passerelle (WP23 ; R-22, R-27, NFR-010).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, secrets en mémoire).
//
// Chaîne : clé de contenu `K` du flux (`edge_pwd_pack_key`, scellée pour la clé d'accord de la
// passerelle) -> ouverte EN MÉMOIRE par `HARDWARE_KEYSTORE.agree` (la clé d'accord privée ne sort
// jamais du port) -> ouvre `pwd_pack_enc` (AES-256-GCM, AAD `pwdPackAad`) -> le clair `PWD‖PACK` est
// rescellé pour le terminal (`sealForRecipient`, AAD `deviceAad`) ou chiffré sous la clé `K_v` d'un
// snapshot (AAD `snapshotPwdAad`). Tout tampon secret est mis à zéro dans un `finally`. Aucune
// exception ne porte une valeur secrète (les erreurs sont des codes).
//
// POINT OUVERT (signalé au compte rendu) : l'AAD du scellement de `K` n'est pas figé par le contrat
// (« fixé par le plan », replication-page-additions.yaml) ; `sealedKeyAad` ci-dessous est le choix de
// ce lot (liaison au grand livre et à la passerelle) et doit être aligné avec le dépôt côté central.
import { createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import {
  deviceAad,
  fromWrappedKey,
  openPwdPack,
  pwdPackAad,
  sealForRecipient,
  sealPwdPack,
  snapshotPwdAad,
  type EncryptedBlob,
  type WrappedKey,
} from '@cashless/tag-format';
import type { HardwareKeystore } from '../../key-store/hardware-keystore.port';

/** Préfixe SPKI DER d'une clé publique EC P-256 (point non compressé de 65 octets à suivre). */
const SPKI_P256_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

export class PackCryptoError extends Error {
  constructor(readonly code: 'KEY_UNREADABLE' | 'PACK_UNREADABLE' | 'BAD_INPUT') {
    super(code);
    this.name = 'PackCryptoError';
  }
}

/** Zéro sur un tampon (secret) ; sans effet sur `undefined`. */
export function wipe(...buffers: Array<Buffer | undefined | null>): void {
  for (const buffer of buffers) buffer?.fill(0);
}

/** AAD du scellement de la clé de contenu pour la passerelle (choix de ce lot, voir l'en-tête). */
export function sealedKeyAad(ledgerId: string, gatewayId: string): Buffer {
  return Buffer.concat([
    Buffer.from('CASHLESS/PWDPACK-KEY/EDGE/v1|', 'ascii'),
    Buffer.from(ledgerId, 'ascii'),
    Buffer.from('|', 'ascii'),
    Buffer.from(gatewayId, 'ascii'),
  ]);
}

/**
 * Ouvre la clé de contenu `K` scellée pour la passerelle. Le tampon rendu (32 octets) est à
 * effacer par l'appelant. Toute défaillance (clé détruite, enveloppe altérée, mauvaise AAD) :
 * `PackCryptoError('KEY_UNREADABLE')`, sans détail.
 */
export async function openSealedContentKey(
  keystore: HardwareKeystore,
  sealed: WrappedKey,
  aad: Uint8Array,
): Promise<Buffer> {
  let shared: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    const blob = fromWrappedKey(sealed);
    const ephemeral = Buffer.from(blob.epk ?? '', 'base64url');
    if (ephemeral.length !== 65 || ephemeral[0] !== 0x04) throw new PackCryptoError('BAD_INPUT');
    shared = await keystore.agree(Buffer.concat([SPKI_P256_PREFIX, ephemeral]));
    key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), aad, 32));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.nonce, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const part = decipher.update(Buffer.from(blob.ciphertext, 'base64'));
    const rest = decipher.final();
    const content = Buffer.concat([part, rest]);
    wipe(part, rest);
    if (content.length !== 32) {
      wipe(content);
      throw new PackCryptoError('KEY_UNREADABLE');
    }
    return content;
  } catch {
    throw new PackCryptoError('KEY_UNREADABLE');
  } finally {
    wipe(shared, key);
  }
}

/** Le colis stocké est le JSON UTF-8 d'un `EncryptedBlob` (nonce, ciphertext, tag en base64). */
export function packBlobBytes(stored: Buffer): Buffer {
  let blob: EncryptedBlob;
  try {
    blob = JSON.parse(stored.toString('utf8')) as EncryptedBlob;
    const raw = Buffer.concat([
      Buffer.from(blob.nonce, 'base64'),
      Buffer.from(blob.ciphertext, 'base64'),
      Buffer.from(blob.tag, 'base64'),
    ]);
    if (raw.length !== 34) throw new PackCryptoError('BAD_INPUT');
    return raw;
  } catch {
    throw new PackCryptoError('PACK_UNREADABLE');
  }
}

/** Ouvre `PWD‖PACK` d'un bracelet avec la clé de contenu. Le clair est à effacer par l'appelant. */
export function openMediaPack(input: {
  contentKey: Buffer;
  stored: Buffer;
  mediaId: string;
  operatorId: string;
  keyIndex: number;
  uid: Buffer;
}): Buffer {
  const raw = packBlobBytes(input.stored);
  try {
    return openPwdPack({
      dek: input.contentKey,
      blob: raw,
      aad: pwdPackAad({
        mediaId: input.mediaId,
        operatorId: input.operatorId,
        keyIndex: input.keyIndex,
        uid: input.uid,
      }),
    });
  } catch {
    throw new PackCryptoError('PACK_UNREADABLE');
  } finally {
    wipe(raw);
  }
}

/** Rescelle `PWD‖PACK` pour la clé d'accord d'un terminal (point P-256 non compressé, 65 octets). */
export function resealForDevice(input: {
  pwdPack: Buffer;
  deviceAgreementKey: Buffer;
  deviceId: string;
  uid: Buffer;
}): EncryptedBlob {
  try {
    return sealForRecipient({
      recipientPublicKey: input.deviceAgreementKey,
      plaintext: input.pwdPack,
      aad: deviceAad(input.deviceId, input.uid),
    });
  } catch {
    throw new PackCryptoError('BAD_INPUT');
  }
}

/** Chiffre `PWD‖PACK` sous `K_v` pour un snapshot ; rend les 34 octets et leur empreinte. */
export function sealForSnapshot(input: {
  snapshotKey: Buffer;
  pwdPack: Buffer;
  ledgerId: string;
  version: bigint;
  tokenHash: Buffer;
  uid: Buffer;
}): { blob: { nonce: string; ciphertext: string; tag: string }; sha256: string } {
  const sealed = sealPwdPack({
    dek: input.snapshotKey,
    nonce: randomBytes(12),
    pwdPack: input.pwdPack,
    aad: snapshotPwdAad(input.ledgerId, input.version, input.tokenHash, input.uid),
  });
  const blob = {
    nonce: sealed.subarray(0, 12).toString('base64'),
    ciphertext: sealed.subarray(12, 18).toString('base64'),
    tag: sealed.subarray(18).toString('base64'),
  };
  return { blob, sha256: createHash('sha256').update(sealed).digest('hex') };
}
