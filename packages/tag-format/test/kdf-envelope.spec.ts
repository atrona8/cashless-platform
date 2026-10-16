// Dérivation SP 800-108 et stockage chiffré de PWD‖PACK : vecteurs du kit (SPECIFICATION §7.3, §7.4) et refus.
import { createHmac, randomBytes } from 'node:crypto';
import {
  TagFormatError,
  derivationMessage,
  openPwdPack,
  pwdPackAad,
  sealPwdPack,
  splitPwdPack,
  uuidToBytes,
} from '../src';
import { hex, vectors } from './vectors';

const k = vectors.kdf;
const e = vectors.envelope;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof TagFormatError ? error.code : `autre: ${String(error)}`;
  }
  return undefined;
}

describe('dérivation du mot de passe', () => {
  it('construit le message de GenerateMac du kit', () => {
    expect(
      derivationMessage({
        operatorId: k.operator_id,
        keyIndex: k.key_index,
        uid: hex(k.uid),
      }).toString('hex'),
    ).toBe(k.message);
  });

  it('un HMAC-SHA256 sous la clé de test donne PWD et PACK du kit', () => {
    const mac = createHmac('sha256', hex(k.test_key)).update(hex(k.message)).digest();
    const { pwdPack, pwd, pack } = splitPwdPack(mac);
    expect([pwdPack.toString('hex'), pwd.toString('hex'), pack.toString('hex')]).toEqual([
      k.okm,
      k.pwd,
      k.pack,
    ]);
  });

  it('refuse un UID, un index ou un prestataire mal formés', () => {
    expect(
      codeOf(() =>
        derivationMessage({ operatorId: k.operator_id, keyIndex: 1, uid: Buffer.alloc(6) }),
      ),
    ).toBe('BAD_UID');
    expect(
      codeOf(() =>
        derivationMessage({ operatorId: k.operator_id, keyIndex: 70000, uid: hex(k.uid) }),
      ),
    ).toBe('BAD_KEY_INDEX');
    expect(
      codeOf(() => derivationMessage({ operatorId: 'pas-un-uuid', keyIndex: 1, uid: hex(k.uid) })),
    ).toBe('BAD_UUID');
    expect(codeOf(() => uuidToBytes('00000000000000000000000000000002'))).toBe('BAD_UUID');
    expect(codeOf(() => splitPwdPack(Buffer.alloc(5)))).toBe('BAD_LENGTH');
  });
});

describe('stockage chiffré de PWD‖PACK', () => {
  const aad = () =>
    pwdPackAad({
      mediaId: e.media_id,
      operatorId: k.operator_id,
      keyIndex: k.key_index,
      uid: hex(k.uid),
    });

  it('construit l’AAD du kit', () => {
    expect(aad().toString('hex')).toBe(e.aad);
  });

  it('scelle les 34 octets du kit et les rouvre', () => {
    const blob = sealPwdPack({
      dek: hex(e.dek),
      nonce: hex(e.nonce),
      pwdPack: hex(e.plaintext),
      aad: aad(),
    });
    expect(blob.toString('hex')).toBe(e.pwd_pack_enc);
    expect(openPwdPack({ dek: hex(e.dek), blob, aad: aad() }).toString('hex')).toBe(e.plaintext);
  });

  it.each(vectors.refusals.envelope as { name: string; blob: string; aad: string; code: string }[])(
    'refuse : $name',
    (refusal) => {
      expect(
        codeOf(() =>
          openPwdPack({ dek: hex(e.dek), blob: hex(refusal.blob), aad: hex(refusal.aad) }),
        ),
      ).toBe(refusal.code);
    },
  );

  it('un autre bracelet, prestataire, index ou UID fait échouer l’ouverture', () => {
    const base = {
      mediaId: e.media_id,
      operatorId: k.operator_id,
      keyIndex: k.key_index,
      uid: hex(k.uid),
    };
    const others = [
      { ...base, mediaId: '40000000-0000-0000-0000-000000000002' },
      { ...base, operatorId: '00000000-0000-0000-0000-000000000003' },
      { ...base, keyIndex: 2 },
      { ...base, uid: hex('04a1b2c3d4e5f7') },
    ];
    for (const other of others) {
      expect(
        codeOf(() =>
          openPwdPack({ dek: hex(e.dek), blob: hex(e.pwd_pack_enc), aad: pwdPackAad(other) }),
        ),
      ).toBe('AUTH_FAILED');
    }
    expect(
      codeOf(() =>
        openPwdPack({ dek: Buffer.alloc(32, 9), blob: hex(e.pwd_pack_enc), aad: aad() }),
      ),
    ).toBe('AUTH_FAILED');
  });

  it('refuse une clé, un nonce ou un clair de mauvaise longueur', () => {
    expect(
      codeOf(() =>
        sealPwdPack({
          dek: Buffer.alloc(16),
          nonce: hex(e.nonce),
          pwdPack: hex(e.plaintext),
          aad: aad(),
        }),
      ),
    ).toBe('BAD_KEY');
    expect(
      codeOf(() =>
        sealPwdPack({
          dek: hex(e.dek),
          nonce: Buffer.alloc(11),
          pwdPack: hex(e.plaintext),
          aad: aad(),
        }),
      ),
    ).toBe('BAD_LENGTH');
    expect(
      codeOf(() =>
        sealPwdPack({ dek: hex(e.dek), nonce: hex(e.nonce), pwdPack: Buffer.alloc(5), aad: aad() }),
      ),
    ).toBe('BAD_LENGTH');
  });

  it('aller-retour sur 200 entrées aléatoires', () => {
    for (let n = 0; n < 200; n += 1) {
      const dek = randomBytes(32);
      const pwdPack = randomBytes(6);
      const blob = sealPwdPack({ dek, nonce: randomBytes(12), pwdPack, aad: aad() });
      expect(blob.length).toBe(34);
      expect(openPwdPack({ dek, blob, aad: aad() }).equals(pwdPack)).toBe(true);
    }
  });
});
