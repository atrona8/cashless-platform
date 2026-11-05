// Enveloppes de snapshot (WP12, T049) : AAD, correspondance WrappedKey, vecteurs produits par un
// script Python indépendant (gen_snapshot_vectors.py).
import { createECDH } from 'node:crypto';
import {
  TagFormatError,
  deviceAad,
  fromWrappedKey,
  openForRecipient,
  sealForRecipient,
  snapshotKeyAad,
  snapshotPwdAad,
  toWrappedKey,
  openPwdPack,
  type EncryptedBlob,
} from '../src';
import vectors from './snapshot-vectors.json';

const bytes = (hexa: string): Buffer => Buffer.from(hexa, 'hex');
const VERSION = BigInt(vectors.version);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof TagFormatError ? error.code : `autre: ${String(error)}`;
  }
  return undefined;
}

describe('AAD de snapshot', () => {
  it('SNAPKEY : octets identiques au script Python', () => {
    expect(snapshotKeyAad(vectors.ledger_id, VERSION, vectors.device_id).toString('hex')).toBe(
      vectors.snapkey_aad_hex,
    );
  });

  it('SNAPPWD : octets identiques au script Python', () => {
    expect(
      snapshotPwdAad(
        vectors.ledger_id,
        VERSION,
        bytes(vectors.token_hash),
        bytes(vectors.nfc_uid),
      ).toString('hex'),
    ).toBe(vectors.snappwd_aad_hex);
  });

  it('la version change l’AAD (un seul octet), le terminal aussi', () => {
    const a = snapshotKeyAad(vectors.ledger_id, VERSION, vectors.device_id);
    expect(a.equals(snapshotKeyAad(vectors.ledger_id, VERSION + 1n, vectors.device_id))).toBe(
      false,
    );
    expect(
      a.equals(snapshotKeyAad(vectors.ledger_id, VERSION, 'd0000000-0000-0000-0000-000000000003')),
    ).toBe(false);
  });

  it('bornes : version négative ou au-delà de 2^64-1, longueurs, UUID', () => {
    const device = vectors.device_id;
    expect(codeOf(() => snapshotKeyAad(vectors.ledger_id, -1n, device))).toBe('BAD_LENGTH');
    expect(codeOf(() => snapshotKeyAad(vectors.ledger_id, 1n << 64n, device))).toBe('BAD_LENGTH');
    expect(
      codeOf(() => snapshotKeyAad(vectors.ledger_id, (1n << 64n) - 1n, device)),
    ).toBeUndefined();
    expect(codeOf(() => snapshotKeyAad('pas-un-uuid', 1n, device))).toBe('BAD_UUID');
    expect(
      codeOf(() => snapshotPwdAad(vectors.ledger_id, 1n, Buffer.alloc(31), bytes(vectors.nfc_uid))),
    ).toBe('BAD_LENGTH');
    expect(
      codeOf(() => snapshotPwdAad(vectors.ledger_id, 1n, Buffer.alloc(32), Buffer.alloc(6))),
    ).toBe('BAD_UID');
  });

  it('deviceAad est inchangée', () => {
    expect(deviceAad(vectors.device_id, bytes(vectors.nfc_uid)).toString('hex')).toBe(
      Buffer.concat([
        Buffer.from('CASHLESS/PWDPACK/DEV/v1', 'ascii'),
        bytes(vectors.device_id.replace(/-/g, '')),
        bytes(vectors.nfc_uid),
      ]).toString('hex'),
    );
  });
});

describe('enveloppe de K_v (vecteur Python)', () => {
  const aad = (): Buffer => snapshotKeyAad(vectors.ledger_id, VERSION, vectors.device_id);

  it('openForRecipient ouvre l’enveloppe produite par Python', () => {
    const opened = openForRecipient({
      recipientPrivateKey: bytes(vectors.recipient_private_key_hex),
      blob: vectors.envelope as EncryptedBlob,
      aad: aad(),
    });
    expect(opened.toString('hex')).toBe(vectors.k_v_hex);
  });

  it('un octet de divergence (AAD, chiffré) : ouverture refusée', () => {
    const key = bytes(vectors.recipient_private_key_hex);
    const otherVersion = snapshotKeyAad(vectors.ledger_id, VERSION + 1n, vectors.device_id);
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: key,
          blob: vectors.envelope as EncryptedBlob,
          aad: otherVersion,
        }),
      ),
    ).toBe('AUTH_FAILED');
    const bad = Buffer.from(vectors.envelope.ciphertext, 'base64');
    bad[0] = bad[0]! ^ 1;
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: key,
          blob: { ...(vectors.envelope as EncryptedBlob), ciphertext: bad.toString('base64') },
          aad: aad(),
        }),
      ),
    ).toBe('AUTH_FAILED');
  });

  it('WrappedKey : forme Python = conversion TypeScript, dans les deux sens', () => {
    expect(toWrappedKey(vectors.envelope as EncryptedBlob)).toEqual(vectors.wrapped_key);
    expect(fromWrappedKey(vectors.wrapped_key as never)).toEqual(vectors.envelope);
  });

  it('aller-retour : scellé ici, rendu en WrappedKey, rouvert', () => {
    const recipient = createECDH('prime256v1');
    recipient.generateKeys();
    const blob = sealForRecipient({
      recipientPublicKey: recipient.getPublicKey(),
      plaintext: bytes(vectors.k_v_hex),
      aad: aad(),
    });
    const wrapped = toWrappedKey(blob);
    expect(Object.keys(wrapped).sort()).toEqual(['alg', 'epk', 'iv', 'wrapped_key']);
    expect(Buffer.from(wrapped.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(wrapped.wrapped_key, 'base64')).toHaveLength(32 + 16);
    const opened = openForRecipient({
      recipientPrivateKey: recipient.getPrivateKey(),
      blob: fromWrappedKey(wrapped),
      aad: aad(),
    });
    expect(opened.toString('hex')).toBe(vectors.k_v_hex);
  });

  it('fromWrappedKey refuse un algorithme inconnu et un wrapped_key trop court', () => {
    expect(codeOf(() => fromWrappedKey({ ...vectors.wrapped_key, alg: 'A256KW' } as never))).toBe(
      'AUTH_FAILED',
    );
    expect(
      codeOf(() => fromWrappedKey({ ...vectors.wrapped_key, wrapped_key: 'AAAA' } as never)),
    ).toBe('BAD_LENGTH');
  });
});

describe('mot de passe chiffré sous K_v (vecteur Python)', () => {
  it('openPwdPack rouvre le pwd_pack_enc de Python avec l’AAD SNAPPWD seulement', () => {
    const aad = snapshotPwdAad(
      vectors.ledger_id,
      VERSION,
      bytes(vectors.token_hash),
      bytes(vectors.nfc_uid),
    );
    const opened = openPwdPack({
      dek: bytes(vectors.k_v_hex),
      blob: bytes(vectors.pwd_pack_enc_hex),
      aad,
    });
    expect(opened.toString('hex')).toBe(vectors.pwd_pack_hex);
    const other = snapshotPwdAad(
      vectors.ledger_id,
      VERSION + 1n,
      bytes(vectors.token_hash),
      bytes(vectors.nfc_uid),
    );
    expect(
      codeOf(() =>
        openPwdPack({
          dek: bytes(vectors.k_v_hex),
          blob: bytes(vectors.pwd_pack_enc_hex),
          aad: other,
        }),
      ),
    ).toBe('AUTH_FAILED');
  });
});
