// Faux service de clés : reproduit les vecteurs du kit, sans état partagé entre processus, compte ses appels.
import {
  derivationMessage,
  openPwdPack,
  pwdPackAad,
  sealPwdPack,
  splitPwdPack,
} from '@cashless/tag-format';
import { FakeKms, KIT_VECTOR_HMAC_KEY_REF, TEST_WRAPPING_KEY_REF } from '../../../src/kms/fake-kms';
import { KmsKeyError, KmsUnavailableError } from '../../../src/kms/kms.ports';

const OPERATOR = '00000000-0000-0000-0000-000000000002';
const UID = Buffer.from('04a1b2c3d4e5f6', 'hex');

describe('faux service de clés', () => {
  it('calcule PWD et PACK du kit (SPECIFICATION §7.3)', async () => {
    const kms = new FakeKms();
    const mac = await kms.generateMac(
      KIT_VECTOR_HMAC_KEY_REF,
      derivationMessage({ operatorId: OPERATOR, keyIndex: 1, uid: UID }),
    );
    const { pwd, pack } = splitPwdPack(mac);
    expect([pwd.toString('hex'), pack.toString('hex')]).toEqual(['283e8c48', '428c']);
  });

  it('une clé créée par un processus est utilisable par un autre (aucun état partagé)', async () => {
    const admin = new FakeKms();
    const personalization = new FakeKms();
    const check = new FakeKms();
    const ref = await admin.createKey('HMAC_256');
    const message = derivationMessage({ operatorId: OPERATOR, keyIndex: 7, uid: UID });
    expect(
      (await personalization.generateMac(ref, message)).equals(
        await check.generateMac(ref, message),
      ),
    ).toBe(true);
    expect(
      (await personalization.generateMac(ref, message)).equals(
        await personalization.generateMac(await admin.createKey('HMAC_256'), message),
      ),
    ).toBe(false);
  });

  it('une clé de données ouverte par la personnalisation se rouvre dans le processus des clés', async () => {
    const personalization = new FakeKms();
    const tagKeys = new FakeKms();
    const { plaintext, encrypted } = await personalization.generateDataKey(TEST_WRAPPING_KEY_REF);
    expect(plaintext.length).toBe(32);
    expect(encrypted.includes(plaintext)).toBe(false);
    const reopened = await tagKeys.decrypt(TEST_WRAPPING_KEY_REF, encrypted);
    expect(reopened.equals(plaintext)).toBe(true);

    const aad = pwdPackAad({
      mediaId: '40000000-0000-0000-0000-000000000001',
      operatorId: OPERATOR,
      keyIndex: 1,
      uid: UID,
    });
    const blob = sealPwdPack({
      dek: plaintext,
      nonce: Buffer.alloc(12, 3),
      pwdPack: Buffer.from('283e8c48428c', 'hex'),
      aad,
    });
    expect(openPwdPack({ dek: reopened, blob, aad }).toString('hex')).toBe('283e8c48428c');
  });

  it('deux clés de données diffèrent, et une clé d’emballage ne rouvre pas la clé d’une autre', async () => {
    const kms = new FakeKms();
    const a = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    const b = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    expect(a.plaintext.equals(b.plaintext)).toBe(false);
    await expect(kms.decrypt('fake-kms:wrap:autre', a.encrypted)).rejects.toBeInstanceOf(
      KmsKeyError,
    );
    await expect(kms.decrypt(TEST_WRAPPING_KEY_REF, Buffer.alloc(10))).rejects.toBeInstanceOf(
      KmsKeyError,
    );
  });

  it('refuse une référence inconnue ou d’un autre type', async () => {
    const kms = new FakeKms();
    await expect(kms.generateMac('arn:aws:kms:inconnue', Buffer.alloc(4))).rejects.toBeInstanceOf(
      KmsKeyError,
    );
    await expect(kms.generateMac(TEST_WRAPPING_KEY_REF, Buffer.alloc(4))).rejects.toBeInstanceOf(
      KmsKeyError,
    );
    await expect(kms.generateDataKey(KIT_VECTOR_HMAC_KEY_REF)).rejects.toBeInstanceOf(KmsKeyError);
  });

  it('une clé désactivée ne sert plus', async () => {
    const kms = new FakeKms();
    const ref = await kms.createKey('HMAC_256');
    await kms.disableKey(ref);
    expect(kms.isDisabled(ref)).toBe(true);
    await expect(kms.generateMac(ref, Buffer.alloc(4))).rejects.toBeInstanceOf(KmsKeyError);
    await expect(kms.disableKey('arn:aws:kms:inconnue')).rejects.toBeInstanceOf(KmsKeyError);
  });

  it('compte ses appels par opération et simule une panne', async () => {
    const kms = new FakeKms();
    const { encrypted } = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    await kms.decrypt(TEST_WRAPPING_KEY_REF, encrypted);
    await kms.decrypt(TEST_WRAPPING_KEY_REF, encrypted);
    expect(kms.calls).toMatchObject({ generateDataKey: 1, decrypt: 2, generateMac: 0 });
    kms.failNext('decrypt');
    await expect(kms.decrypt(TEST_WRAPPING_KEY_REF, encrypted)).rejects.toBeInstanceOf(
      KmsUnavailableError,
    );
    await expect(kms.decrypt(TEST_WRAPPING_KEY_REF, encrypted)).resolves.toHaveLength(32);
    kms.resetCalls();
    expect(kms.calls.decrypt).toBe(0);
  });
});
