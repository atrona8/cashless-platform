// Dérivation du mot de passe d'un bracelet (SPECIFICATION §7.3) : KDF NIST SP 800-108 en mode compteur, PRF
// HMAC-SHA256, un seul bloc. Le message construit ici est passé tel quel à KMS GenerateMac ; la clé ne sort pas du KMS.
import { TagFormatError, requireLength } from './errors';
import { assertKeyIndex } from './format-b';

const LABEL = Buffer.from('CASHLESS/UL-EV1/PWD/v1', 'ascii');
const COUNTER = Buffer.from('00000001', 'hex');
const LENGTH_BITS = Buffer.from('00000030', 'hex'); // 48 bits : PWD (4 octets) + PACK (2 octets)
export const UID_LENGTH = 7;
export const PWD_PACK_LENGTH = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Buffer {
  if (!UUID.test(uuid)) throw new TagFormatError('BAD_UUID', 'identifiant UUID attendu');
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function assertUid(uid: Uint8Array): void {
  requireLength(uid, UID_LENGTH, 'BAD_UID', 'UID');
}

export function derivationMessage(input: { operatorId: string; keyIndex: number; uid: Uint8Array }): Buffer {
  assertKeyIndex(input.keyIndex);
  assertUid(input.uid);
  const keyIndex = Buffer.alloc(2);
  keyIndex.writeUInt16BE(input.keyIndex);
  return Buffer.concat([COUNTER, LABEL, Buffer.from([0]), uuidToBytes(input.operatorId), keyIndex, input.uid, LENGTH_BITS]);
}

/** Sépare les 6 premiers octets du MAC : `PWD‖PACK`, `PWD` (4 octets) et `PACK` (2 octets). */
export function splitPwdPack(mac: Uint8Array): { pwdPack: Buffer; pwd: Buffer; pack: Buffer } {
  if (mac.length < PWD_PACK_LENGTH) throw new TagFormatError('BAD_LENGTH', 'MAC trop court');
  const pwdPack = Buffer.from(mac.subarray(0, PWD_PACK_LENGTH));
  return { pwdPack, pwd: pwdPack.subarray(0, 4), pack: pwdPack.subarray(4, 6) };
}
