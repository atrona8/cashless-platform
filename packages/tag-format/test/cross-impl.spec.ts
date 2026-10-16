// Preuve croisée (SC-001) : 1 000 entrées tirées d'une graine fixe et leurs sorties, écrites dans
// vectors/cross-impl.json. La suite Dart recalcule chaque sortie à partir des mêmes entrées.
// `UPDATE_VECTORS=1 npm test -w @cashless/tag-format` régénère le fichier ; sinon le test vérifie qu'il est à jour.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAIM_CODE_LENGTH,
  derivationMessage,
  encodeFormatB,
  formatClaimCode,
  generateClaimCode,
  pwdPackAad,
  sealPwdPack,
  tokenHash,
} from '../src';
import { VECTORS_DIR } from './vectors';

const FILE = join(VECTORS_DIR, 'cross-impl.json');
const COUNT = 1000;

/** Générateur déterministe : SHA-256(graine ‖ compteur), découpé à la demande. */
function prng(seed: string) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  return (size: number): Buffer => {
    while (pool.length < size) {
      pool = Buffer.concat([pool, createHash('sha256').update(`${seed}:${counter}`).digest()]);
      counter += 1;
    }
    const out = pool.subarray(0, size);
    pool = pool.subarray(size);
    return Buffer.from(out);
  };
}

const uuid = (bytes: Buffer): string => {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function build() {
  const next = prng('cashless-tag-format-cross-impl-v1');
  const entries = [];
  for (let n = 0; n < COUNT; n += 1) {
    const keyIndex = next(2).readUInt16BE(0);
    const identity = next(16);
    const operatorId = uuid(next(16));
    const mediaId = uuid(next(16));
    const uid = next(7);
    const dek = next(32);
    const nonce = next(12);
    const pwdPack = next(6);
    const claimBytes = next(CLAIM_CODE_LENGTH);
    const aad = pwdPackAad({ mediaId, operatorId, keyIndex, uid });
    const code = generateClaimCode(() => claimBytes);
    entries.push({
      key_index: keyIndex,
      identity: identity.toString('hex'),
      operator_id: operatorId,
      media_id: mediaId,
      uid: uid.toString('hex'),
      dek: dek.toString('hex'),
      nonce: nonce.toString('hex'),
      pwd_pack: pwdPack.toString('hex'),
      claim_bytes: claimBytes.toString('hex'),
      out: {
        format_b: encodeFormatB({ keyIndex, identity }).toString('hex'),
        token_hash: tokenHash(identity).toString('hex'),
        derivation_message: derivationMessage({ operatorId, keyIndex, uid }).toString('hex'),
        aad: aad.toString('hex'),
        pwd_pack_enc: sealPwdPack({ dek, nonce, pwdPack, aad }).toString('hex'),
        claim_code: code,
        claim_code_formatted: formatClaimCode(code),
      },
    });
  }
  return `${JSON.stringify({ seed: 'cashless-tag-format-cross-impl-v1', count: COUNT, entries })}\n`;
}

describe('preuve croisée TypeScript / Dart', () => {
  it(`vectors/cross-impl.json est à jour (${COUNT} entrées)`, () => {
    const text = build();
    if (process.env.UPDATE_VECTORS === '1' || !existsSync(FILE)) writeFileSync(FILE, text);
    expect(readFileSync(FILE, 'utf8')).toBe(text);
    expect(JSON.parse(text).entries).toHaveLength(COUNT);
  });
});
