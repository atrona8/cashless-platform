// Enveloppe pour un terminal ou un poste : le mot de passe d'un bracelet n'est jamais transmis en clair.
import { createECDH } from 'node:crypto';
import {
  RECIPIENT_ALG,
  TagFormatError,
  deviceAad,
  openForRecipient,
  sealForRecipient,
  stationAad,
} from '../src';
import { hex, vectors } from './vectors';

const uid = hex(vectors.kdf.uid);
const secret = hex(vectors.kdf.okm);
const DEVICE = '70000000-0000-0000-0000-000000000001';

function keyPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof TagFormatError ? error.code : `autre: ${String(error)}`;
  }
  return undefined;
}

describe('enveloppe pour un destinataire', () => {
  it('le destinataire rouvre le secret ; la forme est celle du contrat', () => {
    const recipient = keyPair();
    const aad = deviceAad(DEVICE, uid);
    const blob = sealForRecipient({
      recipientPublicKey: recipient.publicKey,
      plaintext: secret,
      aad,
    });
    expect(Object.keys(blob).sort()).toEqual(['alg', 'ciphertext', 'epk', 'nonce', 'tag']);
    expect(blob.alg).toBe(RECIPIENT_ALG);
    expect(Buffer.from(blob.epk, 'base64url').length).toBe(65);
    expect([
      Buffer.from(blob.nonce, 'base64').length,
      Buffer.from(blob.ciphertext, 'base64').length,
      Buffer.from(blob.tag, 'base64').length,
    ]).toEqual([12, 6, 16]);
    expect(
      openForRecipient({ recipientPrivateKey: recipient.privateKey, blob, aad }).equals(secret),
    ).toBe(true);
  });

  it('deux enveloppes du même secret diffèrent (clé éphémère et nonce neufs)', () => {
    const recipient = keyPair();
    const aad = deviceAad(DEVICE, uid);
    const a = sealForRecipient({ recipientPublicKey: recipient.publicKey, plaintext: secret, aad });
    const b = sealForRecipient({ recipientPublicKey: recipient.publicKey, plaintext: secret, aad });
    expect([a.epk === b.epk, a.nonce === b.nonce, a.ciphertext === b.ciphertext]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('un autre destinataire, un autre terminal ou un autre UID ne rouvre rien', () => {
    const recipient = keyPair();
    const aad = deviceAad(DEVICE, uid);
    const blob = sealForRecipient({
      recipientPublicKey: recipient.publicKey,
      plaintext: secret,
      aad,
    });
    expect(
      codeOf(() => openForRecipient({ recipientPrivateKey: keyPair().privateKey, blob, aad })),
    ).toBe('AUTH_FAILED');
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: recipient.privateKey,
          blob,
          aad: deviceAad('70000000-0000-0000-0000-000000000002', uid),
        }),
      ),
    ).toBe('AUTH_FAILED');
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: recipient.privateKey,
          blob,
          aad: deviceAad(DEVICE, hex('04a1b2c3d4e5f7')),
        }),
      ),
    ).toBe('AUTH_FAILED');
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: recipient.privateKey,
          blob: { ...blob, tag: Buffer.alloc(16).toString('base64') },
          aad,
        }),
      ),
    ).toBe('AUTH_FAILED');
  });

  it('l’enveloppe d’un poste n’est pas celle d’un terminal', () => {
    const recipient = keyPair();
    const media = '40000000-0000-0000-0000-000000000001';
    const blob = sealForRecipient({
      recipientPublicKey: recipient.publicKey,
      plaintext: secret,
      aad: stationAad(media, uid),
    });
    expect(
      openForRecipient({
        recipientPrivateKey: recipient.privateKey,
        blob,
        aad: stationAad(media, uid),
      }).equals(secret),
    ).toBe(true);
    expect(
      codeOf(() =>
        openForRecipient({
          recipientPrivateKey: recipient.privateKey,
          blob,
          aad: deviceAad(media, uid),
        }),
      ),
    ).toBe('AUTH_FAILED');
  });

  it('refuse une clé publique mal formée ou hors courbe', () => {
    const aad = deviceAad(DEVICE, uid);
    expect(
      codeOf(() =>
        sealForRecipient({ recipientPublicKey: Buffer.alloc(64), plaintext: secret, aad }),
      ),
    ).toBe('BAD_KEY');
    expect(
      codeOf(() =>
        sealForRecipient({
          recipientPublicKey: Buffer.concat([Buffer.from([2]), Buffer.alloc(64, 1)]),
          plaintext: secret,
          aad,
        }),
      ),
    ).toBe('BAD_KEY');
    expect(
      codeOf(() =>
        sealForRecipient({
          recipientPublicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]),
          plaintext: secret,
          aad,
        }),
      ),
    ).toBe('BAD_KEY');
  });
});
