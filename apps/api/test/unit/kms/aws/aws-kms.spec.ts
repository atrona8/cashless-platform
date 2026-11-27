// AwsKms (mission 12b-1, WP09, T038-T040, T042) : le client du SDK pointe sur un faux KMS local qui calcule
// réellement (HMAC, AES-GCM, ECDSA en DER). Identifiants factices, aucun appel à AWS.
import type { KMSClient } from '@aws-sdk/client-kms';
import { createHmac, createPublicKey, verify } from 'node:crypto';
import { AwsKms, KMS_MAX_MESSAGE_BYTES } from '../../../../src/kms/aws/aws-kms';
import { KmsKeyError, KmsUnavailableError } from '../../../../src/kms/kms.ports';
import { assertSpkiP256 } from '../../../../src/snapshot-keys/spki-p256';
import { kmsClientFor, startFakeKms, type FakeKmsServer } from '../../../support/fake-servers/kms';

let server: FakeKmsServer;
let kms: AwsKms;

beforeAll(async () => {
  server = await startFakeKms();
  kms = new AwsKms(kmsClientFor(server));
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  server.calls.length = 0;
});

const verifyDer = (spki: Buffer, message: Uint8Array, signature: Buffer): boolean =>
  verify(
    'sha256',
    message,
    { key: createPublicKey({ key: spki, format: 'der', type: 'spki' }), dsaEncoding: 'der' },
    signature,
  );

describe('AwsKms : MacPort', () => {
  it('rend un MAC de 32 octets, déterministe, égal au HMAC-SHA256 de la clé', async () => {
    const key = server.addKey('HMAC_256');
    const message = Buffer.from('uid-04a1b2c3d4e5f6');
    const a = await kms.generateMac(key.arn, message);
    const b = await kms.generateMac(key.id, message);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(createHmac('sha256', key.secret).update(message).digest())).toBe(true);
    expect((await kms.generateMac(key.arn, Buffer.from('autre'))).equals(a)).toBe(false);
    expect(server.calls[0]?.body).toEqual({
      KeyId: key.arn,
      Message: message.toString('base64'),
      MacAlgorithm: 'HMAC_SHA_256',
    });
  });

  it('refuse un message de plus de 4 096 octets sans requête, accepte 4 096', async () => {
    const key = server.addKey('HMAC_256');
    await expect(kms.generateMac(key.arn, Buffer.alloc(KMS_MAX_MESSAGE_BYTES + 1))).rejects.toThrow(
      KmsKeyError,
    );
    expect(server.calls).toHaveLength(0);
    await expect(
      kms.generateMac(key.arn, Buffer.alloc(KMS_MAX_MESSAGE_BYTES)),
    ).resolves.toHaveLength(32);
  });
});

describe('AwsKms : DataKeyPort et DecryptPort', () => {
  it('clé de données : aller-retour, 32 octets, deux clés distinctes', async () => {
    const wrap = server.addKey('SYMMETRIC_DEFAULT');
    const one = await kms.generateDataKey(wrap.arn);
    const two = await kms.generateDataKey(wrap.arn);
    expect(one.plaintext).toHaveLength(32);
    expect(one.plaintext.equals(two.plaintext)).toBe(false);
    const reopened = await kms.decrypt(wrap.arn, one.encrypted);
    expect(reopened.equals(one.plaintext)).toBe(true);
    expect(server.calls[0]?.body).toEqual({ KeyId: wrap.arn, KeySpec: 'AES_256' });
  });

  it('une autre clé d’emballage ou un blob altéré : erreur de clé', async () => {
    const wrap = server.addKey('SYMMETRIC_DEFAULT');
    const other = server.addKey('SYMMETRIC_DEFAULT');
    const { encrypted } = await kms.generateDataKey(wrap.arn);
    await expect(kms.decrypt(other.arn, encrypted)).rejects.toThrow(KmsKeyError);
    const tampered = Buffer.from(encrypted);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    await expect(kms.decrypt(wrap.arn, tampered)).rejects.toThrow(KmsKeyError);
  });
});

describe('AwsKms : SignPort', () => {
  it('signature en DER (pas r||s) vérifiée par crypto.verify avec la clé publique servie', async () => {
    const key = server.addKey('ECC_NIST_P256');
    const message = Buffer.from('{"alg":"ECDSA_P256_SHA256","kid":"k1"}');
    const spki = await kms.publicKey(key.arn);
    expect(spki).toHaveLength(91);
    assertSpkiP256(spki);
    for (let i = 0; i < 10; i += 1) {
      const signature = await kms.sign(key.arn, message);
      expect(signature[0]).toBe(0x30);
      expect(signature[1]).toBe(signature.length - 2);
      expect(signature.length).not.toBe(64);
      expect(verifyDer(spki, message, signature)).toBe(true);
      expect(verifyDer(spki, Buffer.from('autre'), signature)).toBe(false);
    }
  });

  it('envoie le message tel quel, en RAW avec ECDSA_SHA_256', async () => {
    const key = server.addKey('ECC_NIST_P256');
    const message = Buffer.from('en-tête JCS');
    await kms.sign(key.arn, message);
    expect(server.calls[0]).toEqual({
      operation: 'Sign',
      body: {
        KeyId: key.arn,
        Message: message.toString('base64'),
        MessageType: 'RAW',
        SigningAlgorithm: 'ECDSA_SHA_256',
      },
    });
  });

  it('4 097 octets : refus sans aucune requête ; 4 096 passent', async () => {
    const key = server.addKey('ECC_NIST_P256');
    await expect(kms.sign(key.arn, Buffer.alloc(KMS_MAX_MESSAGE_BYTES + 1))).rejects.toThrow(
      KmsKeyError,
    );
    expect(server.calls).toHaveLength(0);
    const spki = await kms.publicKey(key.arn);
    const big = Buffer.alloc(KMS_MAX_MESSAGE_BYTES, 7);
    expect(verifyDer(spki, big, await kms.sign(key.arn, big))).toBe(true);
  });

  it('la clé publique d’une clé qui n’est pas ECC_NIST_P256 est refusée', async () => {
    const sym = server.addKey('SYMMETRIC_DEFAULT');
    await expect(kms.publicKey(sym.arn)).rejects.toThrow(KmsKeyError);
  });
});

describe('AwsKms : KeyAdminPort', () => {
  it.each([
    ['HMAC_256', 'GENERATE_VERIFY_MAC'],
    ['SYMMETRIC_DEFAULT', 'ENCRYPT_DECRYPT'],
    ['ECC_NIST_P256', 'SIGN_VERIFY'],
  ] as const)(
    'createKey(%s) envoie KeySpec et KeyUsage exacts et rend l’ARN',
    async (kind, usage) => {
      const arn = await kms.createKey(kind);
      expect(server.calls).toEqual([
        { operation: 'CreateKey', body: { KeySpec: kind, KeyUsage: usage } },
      ]);
      expect(arn).toMatch(/^arn:aws:kms:eu-west-3:000000000000:key\/[0-9a-f-]{36}$/);
      expect(server.keys.get(arn.slice(arn.lastIndexOf('/') + 1))?.spec).toBe(kind);
    },
  );

  it('disableKey désactive la clé : les opérations suivantes sont refusées', async () => {
    const arn = await kms.createKey('ECC_NIST_P256');
    await kms.disableKey(arn);
    expect(server.calls.at(-1)).toEqual({ operation: 'DisableKey', body: { KeyId: arn } });
    await expect(kms.sign(arn, Buffer.from('x'))).rejects.toThrow(KmsKeyError);
  });
});

describe('AwsKms : erreurs', () => {
  const KEY = 'arn:aws:kms:eu-west-3:000000000000:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('clé inconnue : classe et code AWS seulement, ni identifiant de clé ni message du SDK', async () => {
    const error = await kms.generateMac(KEY, Buffer.from('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KmsKeyError);
    const text = `${(error as Error).message} ${(error as Error).stack ?? ''}`;
    expect(text).toContain('NotFoundException');
    expect(text).not.toContain('aaaaaaaa');
    expect(text).not.toContain('does not exist');
  });

  it('panne du service : erreur d’indisponibilité sans identifiant de clé', async () => {
    const key = server.addKey('HMAC_256');
    server.forceNext('GenerateMac', { type: 'ThrottlingException', status: 400 });
    const error = await kms.generateMac(key.arn, Buffer.from('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KmsUnavailableError);
    expect((error as Error).message).toContain('ThrottlingException');
    expect((error as Error).message).not.toContain(key.id);
  });

  it('un type d’erreur au nom étrange devient « Unknown »', async () => {
    const key = server.addKey('HMAC_256');
    server.forceNext('GenerateMac', { type: 'Erreur avec la clé 123', status: 400 });
    const error = await kms.generateMac(key.arn, Buffer.from('x')).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('123');
  });
});

describe('AwsKms : tampons du SDK remis à zéro', () => {
  const stub = (output: object): { client: KMSClient; sent: unknown[] } => {
    const sent: unknown[] = [];
    const client = {
      send: (command: unknown) => {
        sent.push(command);
        return Promise.resolve(output);
      },
    } as unknown as KMSClient;
    return { client, sent };
  };

  it('generateMac : copie remise à l’appelant, tampon du SDK à zéro', async () => {
    const sdkMac = new Uint8Array(32).fill(0xab);
    const result = await new AwsKms(stub({ Mac: sdkMac }).client).generateMac(
      'k',
      Buffer.from('m'),
    );
    expect(result.equals(Buffer.alloc(32, 0xab))).toBe(true);
    expect(sdkMac.every((b) => b === 0)).toBe(true);
    expect(result.buffer).not.toBe(sdkMac.buffer);
  });

  it('generateDataKey et decrypt : clair copié, tampons du SDK à zéro', async () => {
    const plain = new Uint8Array(32).fill(0x11);
    const blob = new Uint8Array(60).fill(0x22);
    const out = await new AwsKms(
      stub({ Plaintext: plain, CiphertextBlob: blob }).client,
    ).generateDataKey('k');
    expect(out.plaintext.equals(Buffer.alloc(32, 0x11))).toBe(true);
    expect(out.encrypted.equals(Buffer.alloc(60, 0x22))).toBe(true);
    expect(plain.every((b) => b === 0) && blob.every((b) => b === 0)).toBe(true);

    const plain2 = new Uint8Array(32).fill(0x33);
    const opened = await new AwsKms(stub({ Plaintext: plain2 }).client).decrypt('k', blob);
    expect(opened.equals(Buffer.alloc(32, 0x33))).toBe(true);
    expect(plain2.every((b) => b === 0)).toBe(true);
  });

  it('une réponse de taille inattendue est refusée et son tampon quand même mis à zéro', async () => {
    const short = new Uint8Array(16).fill(0x44);
    await expect(
      new AwsKms(stub({ Mac: short }).client).generateMac('k', Buffer.from('m')),
    ).rejects.toThrow(KmsUnavailableError);
    expect(short.every((b) => b === 0)).toBe(true);
  });

  it('une signature brute r||s (64 octets) est refusée', async () => {
    const raw = new Uint8Array(64).fill(0x30);
    await expect(
      new AwsKms(stub({ Signature: raw }).client).sign('k', Buffer.from('m')),
    ).rejects.toThrow(KmsUnavailableError);
  });
});

describe('AwsKms.forCapabilities (C-005)', () => {
  it('sign : ni generateMac, ni decrypt, ni generateDataKey, ni createKey', async () => {
    const view = kms.forCapabilities(['sign']);
    expect(Object.keys(view).sort()).toEqual(['publicKey', 'sign']);
    for (const absent of ['generateMac', 'decrypt', 'generateDataKey', 'createKey', 'disableKey'])
      expect(absent in view).toBe(false);
    expect(Object.isFrozen(view)).toBe(true);
    const key = server.addKey('ECC_NIST_P256');
    const message = Buffer.from('signé par le port seul');
    expect(
      verifyDer(await view.publicKey(key.arn), message, await view.sign(key.arn, message)),
    ).toBe(true);
  });

  it('chaque droit n’expose que ses méthodes', () => {
    expect(Object.keys(kms.forCapabilities(['mac']))).toEqual(['generateMac']);
    expect(Object.keys(kms.forCapabilities(['dataKey']))).toEqual(['generateDataKey']);
    expect(Object.keys(kms.forCapabilities(['decrypt']))).toEqual(['decrypt']);
    expect(Object.keys(kms.forCapabilities(['keyAdmin'])).sort()).toEqual([
      'createKey',
      'disableKey',
      'publicKey',
    ]);
    expect(Object.keys(kms.forCapabilities(['mac', 'decrypt'])).sort()).toEqual([
      'decrypt',
      'generateMac',
    ]);
    expect(Object.keys(kms.forCapabilities([]))).toEqual([]);
  });

  it('l’objet rendu n’est pas l’adaptateur et ne le laisse pas atteindre par son prototype', () => {
    const view = kms.forCapabilities(['mac']);
    expect(view).not.toBe(kms);
    expect(Object.getPrototypeOf(view)).toBe(Object.prototype);
    expect(() => {
      (view as unknown as Record<string, unknown>).decrypt = () => undefined;
    }).toThrow(TypeError);
  });

  it('le typage refuse un port non demandé', () => {
    const view = kms.forCapabilities(['sign']);
    // @ts-expect-error generateMac n'existe pas dans les ports du droit « sign »
    expect(view.generateMac).toBeUndefined();
  });
});
