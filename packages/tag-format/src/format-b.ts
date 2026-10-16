// Format B, version 1.0 (SPECIFICATION §7.2) : 28 octets, pages 4 à 10 d'une MIFARE Ultralight EV1.
//   0      version majeure (1)        — un majeur inconnu est refusé
//   1      version mineure (0)        — un mineur plus récent est accepté
//   2-3    index de clé, big-endian
//   4-19   identité (16 octets aléatoires)
//   20     drapeaux (0 en 1.0)
//   21-23  réservé (zéros à l'écriture, ignorés à la lecture)
//   24-27  CRC-32/ISO-HDLC des octets 0 à 23, big-endian
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { TagFormatError, requireLength } from './errors';

export const FORMAT_B_LENGTH = 28;
export const FORMAT_B_MAJOR = 1;
export const FORMAT_B_MINOR = 0;
export const IDENTITY_LENGTH = 16;

export interface FormatB {
  major: number;
  minor: number;
  keyIndex: number;
  identity: Buffer;
  flags: number;
}

/** CRC-32/ISO-HDLC (zlib), rendu sur 4 octets big-endian. Contrôle : « 123456789 » → CBF43926. */
export function crc32IsoHdlc(bytes: Uint8Array): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc32(bytes) >>> 0);
  return out;
}

export function assertKeyIndex(keyIndex: number): void {
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 65535) {
    throw new TagFormatError('BAD_KEY_INDEX', `index de clé hors bornes (0 à 65535) : ${keyIndex}`);
  }
}

export function encodeFormatB(input: { keyIndex: number; identity: Uint8Array }): Buffer {
  assertKeyIndex(input.keyIndex);
  requireLength(input.identity, IDENTITY_LENGTH, 'BAD_IDENTITY', 'identité');
  const out = Buffer.alloc(FORMAT_B_LENGTH);
  out[0] = FORMAT_B_MAJOR;
  out[1] = FORMAT_B_MINOR;
  out.writeUInt16BE(input.keyIndex, 2);
  out.set(input.identity, 4);
  crc32IsoHdlc(out.subarray(0, 24)).copy(out, 24);
  return out;
}

export function decodeFormatB(bytes: Uint8Array): FormatB {
  requireLength(bytes, FORMAT_B_LENGTH, 'BAD_LENGTH', 'format B');
  const buf = Buffer.from(bytes);
  const major = buf[0]!;
  // La page 4 est gelée pour toutes les versions : le majeur se lit avant tout contrôle du reste.
  if (major !== FORMAT_B_MAJOR)
    throw new TagFormatError('UNKNOWN_MAJOR', `version majeure inconnue : ${major}`);
  if (!crc32IsoHdlc(buf.subarray(0, 24)).equals(buf.subarray(24, 28)))
    throw new TagFormatError('BAD_CRC', 'CRC du format B incorrect');
  return {
    major,
    minor: buf[1]!,
    keyIndex: buf.readUInt16BE(2),
    identity: Buffer.from(buf.subarray(4, 20)),
    flags: buf[20]!,
  };
}

/** Empreinte de l'identité : seule forme que le serveur conserve (`media.token_hash`). */
export function tokenHash(identity: Uint8Array): Buffer {
  requireLength(identity, IDENTITY_LENGTH, 'BAD_IDENTITY', 'identité');
  return createHash('sha256').update(identity).digest();
}
