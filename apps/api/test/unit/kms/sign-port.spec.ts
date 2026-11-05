// SignPort et faux déterministe (WP09, T038-T039) : signature DER vérifiable, clé publique SPKI stable.
import { createPublicKey, verify } from 'node:crypto';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KmsKeyError, type KeyAdminPort, KmsUnavailableError } from '../../../src/kms/kms.ports';
import { assertSpkiP256, InvalidSigningPublicKeyError } from '../../../src/snapshot-keys/spki-p256';

const REF = 'fake-kms:ecc:test-1';
const MESSAGE = Buffer.from('{"alg":"ECDSA_P256_SHA256","kid":"k1"}');

const verifyDer = (spki: Buffer, message: Uint8Array, signature: Buffer): boolean =>
  verify(
    'sha256',
    message,
    { key: createPublicKey({ key: spki, format: 'der', type: 'spki' }), dsaEncoding: 'der' },
    signature,
  );

describe('FakeKms : SignPort', () => {
  it('la signature est du DER vérifiable avec la clé publique SPKI', async () => {
    const kms = new FakeKms();
    const spki = await kms.publicKey(REF);
    expect(spki).toHaveLength(91);
    assertSpkiP256(spki);
    for (let i = 0; i < 20; i += 1) {
      const signature = await kms.sign(REF, MESSAGE);
      expect(signature[0]).toBe(0x30);
      expect(verifyDer(spki, MESSAGE, signature)).toBe(true);
    }
  });

  it('autre message ou autre référence : la vérification échoue', async () => {
    const kms = new FakeKms();
    const signature = await kms.sign(REF, MESSAGE);
    expect(verifyDer(await kms.publicKey(REF), Buffer.from('autre'), signature)).toBe(false);
    expect(verifyDer(await kms.publicKey('fake-kms:ecc:test-2'), MESSAGE, signature)).toBe(false);
  });

  it('deux instances : même clé publique pour une même référence, autre clé pour une autre', async () => {
    const a = new FakeKms();
    const b = new FakeKms();
    expect((await a.publicKey(REF)).equals(await b.publicKey(REF))).toBe(true);
    expect((await a.publicKey(REF)).equals(await a.publicKey('fake-kms:ecc:test-2'))).toBe(false);
    // Une signature de l'une se vérifie avec la clé publique de l'autre.
    expect(verifyDer(await b.publicKey(REF), MESSAGE, await a.sign(REF, MESSAGE))).toBe(true);
  });

  it('createKey(ECC_NIST_P256) rend une référence utilisable', async () => {
    const kms = new FakeKms();
    const ref = await kms.createKey('ECC_NIST_P256');
    expect(ref).toMatch(/^fake-kms:ecc:/);
    expect(verifyDer(await kms.publicKey(ref), MESSAGE, await kms.sign(ref, MESSAGE))).toBe(true);
  });

  it('référence d’un autre type ou inconnue : KmsKeyError', async () => {
    const kms = new FakeKms();
    await expect(kms.sign('fake-kms:hmac:x', MESSAGE)).rejects.toThrow(KmsKeyError);
    await expect(kms.publicKey('fake-kms:wrap:x')).rejects.toThrow(KmsKeyError);
    await expect(kms.sign('arn:aws:kms:x', MESSAGE)).rejects.toThrow(KmsKeyError);
    await expect(kms.generateMac(REF, MESSAGE)).rejects.toThrow(KmsKeyError);
  });

  it('panne injectée : KmsUnavailableError, puis reprise', async () => {
    const kms = new FakeKms();
    kms.failNext('sign');
    kms.failNext('publicKey');
    await expect(kms.sign(REF, MESSAGE)).rejects.toThrow(KmsUnavailableError);
    await expect(kms.publicKey(REF)).rejects.toThrow(KmsUnavailableError);
    await expect(kms.sign(REF, MESSAGE)).resolves.toBeInstanceOf(Buffer);
    expect(kms.calls.sign).toBe(2);
  });

  it('clé désactivée : refusée', async () => {
    const kms = new FakeKms();
    await kms.disableKey(REF);
    await expect(kms.sign(REF, MESSAGE)).rejects.toThrow(KmsKeyError);
  });

  it('marqué faux', () => {
    expect(new FakeKms().isFake).toBe(true);
  });

  it('aucun scalaire privé dans les erreurs ni dans l’objet', async () => {
    const kms = new FakeKms();
    await kms.sign(REF, MESSAGE);
    expect(JSON.stringify(kms)).not.toMatch(/"d"/);
  });
});

describe('assertSpkiP256 (contrôle de l’API avant rotate_snapshot_signing_key)', () => {
  it('refuse une longueur, un en-tête ou un point invalides', async () => {
    const good = await new FakeKms().publicKey(REF);
    expect(() => assertSpkiP256(good.subarray(0, 90))).toThrow(InvalidSigningPublicKeyError);
    const header = Buffer.from(good);
    header[10] = (header[10] ?? 0) ^ 1;
    expect(() => assertSpkiP256(header)).toThrow(InvalidSigningPublicKeyError);
    const offCurve = Buffer.from(good);
    offCurve[90] = (offCurve[90] ?? 0) ^ 1;
    expect(() => assertSpkiP256(offCurve)).toThrow(InvalidSigningPublicKeyError);
    // 91 octets mais clé d'une autre nature (ed25519 SPKI 44 octets complétés) : refusée.
    expect(() => assertSpkiP256(Buffer.alloc(91, 1))).toThrow(InvalidSigningPublicKeyError);
  });
});

describe('KeyAdminPort : surface', () => {
  it('createKey, disableKey et publicKey seulement ; jamais sign', () => {
    const port: KeyAdminPort = new FakeKms();
    // Contrôle de type : un KeyAdminPort n'a pas `sign`.
    // @ts-expect-error `sign` n'appartient pas à KeyAdminPort
    void port.sign;
    const keys: Array<keyof KeyAdminPort> = ['createKey', 'disableKey', 'publicKey'];
    expect(keys).toHaveLength(3);
  });
});
