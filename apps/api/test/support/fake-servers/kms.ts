// Faux serveur AWS KMS local (protocole JSON 1.1, `X-Amz-Target: TrentService.<Opération>`, champs binaires en
// base64). Il CALCULE réellement avec `node:crypto` : HMAC-SHA256, enveloppe AES-256-GCM, signature ECDSA P-256
// SHA-256 en DER, clé publique SPKI. Aucune clé n'est celle d'un vrai compte : chaque clé est tirée au hasard à sa
// création. Jamais d'appel à AWS : le client pointe sur 127.0.0.1 avec des identifiants factices.
import { KMSClient } from '@aws-sdk/client-kms';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';
import type { ServerResponse } from 'node:http';

export interface FakeKmsKey {
  id: string;
  arn: string;
  spec: 'HMAC_256' | 'SYMMETRIC_DEFAULT' | 'ECC_NIST_P256';
  usage: string;
  enabled: boolean;
  secret: Buffer;
  publicKey?: KeyObject;
  privateKey?: KeyObject;
}

export interface FakeKmsServer extends FakeServer {
  keys: Map<string, FakeKmsKey>;
  /** Corps JSON décodés des requêtes reçues, avec l'opération (`GenerateMac`, …). */
  calls: Array<{ operation: string; body: Record<string, unknown> }>;
  /** Crée une clé du type voulu (comme `CreateKey`) et rend ses métadonnées. */
  addKey(spec: FakeKmsKey['spec']): FakeKmsKey;
  /** Réponse forcée pour la prochaine opération donnée (erreur AWS ou valeur brute). */
  forceNext(operation: string, response: { status?: number; type?: string; body?: object }): void;
}

const USAGES: Record<FakeKmsKey['spec'], string> = {
  HMAC_256: 'GENERATE_VERIFY_MAC',
  SYMMETRIC_DEFAULT: 'ENCRYPT_DECRYPT',
  ECC_NIST_P256: 'SIGN_VERIFY',
};

export const FAKE_AWS_CREDENTIALS = {
  accessKeyId: 'AKIAFAKEFAKEFAKEFAKE',
  secretAccessKey: 'fake-secret-access-key-not-real',
};

export async function startFakeKms(): Promise<FakeKmsServer> {
  const keys = new Map<string, FakeKmsKey>();
  const calls: FakeKmsServer['calls'] = [];
  const forced = new Map<string, { status?: number; type?: string; body?: object }>();

  const addKey: FakeKmsServer['addKey'] = (spec) => {
    const id = randomUUID();
    const key: FakeKmsKey = {
      id,
      arn: `arn:aws:kms:eu-west-3:000000000000:key/${id}`,
      spec,
      usage: USAGES[spec],
      enabled: true,
      secret: randomBytes(32),
    };
    if (spec === 'ECC_NIST_P256') {
      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      key.publicKey = pair.publicKey;
      key.privateKey = pair.privateKey;
    }
    keys.set(id, key);
    return key;
  };

  const lookup = (keyId: unknown): FakeKmsKey | null => {
    if (typeof keyId !== 'string') return null;
    const id = keyId.startsWith('arn:') ? keyId.slice(keyId.lastIndexOf('/') + 1) : keyId;
    return keys.get(id) ?? null;
  };

  const fail = (res: ServerResponse, type: string, message: string, status = 400): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/x-amz-json-1.1');
    res.setHeader('x-amzn-errortype', type);
    // Comme AWS : le message nomme la clé. L'adaptateur ne doit jamais le recopier.
    res.end(JSON.stringify({ __type: type, message }));
  };
  const ok = (res: ServerResponse, body: object): void => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-amz-json-1.1');
    res.end(JSON.stringify(body));
  };
  const b64 = (value: unknown): Buffer => Buffer.from(String(value ?? ''), 'base64');

  const handler = (req: RecordedRequest, res: ServerResponse): void => {
    const target = String(req.headers['x-amz-target'] ?? '');
    const operation = target.replace('TrentService.', '');
    const body = (req.body.length > 0 ? JSON.parse(req.body.toString('utf8')) : {}) as Record<
      string,
      unknown
    >;
    calls.push({ operation, body });
    if (req.method !== 'POST' || req.path !== '/' || !target.startsWith('TrentService.'))
      return fail(res, 'UnknownOperationException', 'opération inconnue');
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKIAFAKE'))
      return fail(res, 'IncompleteSignatureException', 'signature absente', 403);
    const force = forced.get(operation);
    if (force !== undefined) {
      forced.delete(operation);
      if (force.type !== undefined)
        return fail(res, force.type, `Key '${String(body.KeyId)}' : erreur forcée`, force.status);
      return ok(res, force.body ?? {});
    }

    if (operation === 'CreateKey') {
      const spec = body.KeySpec as FakeKmsKey['spec'];
      if (!(spec in USAGES) || body.KeyUsage !== USAGES[spec])
        return fail(res, 'ValidationException', 'KeySpec et KeyUsage incompatibles');
      const key = addKey(spec);
      return ok(res, {
        KeyMetadata: { KeyId: key.id, Arn: key.arn, KeySpec: spec, KeyUsage: key.usage },
      });
    }

    const key = lookup(body.KeyId);
    if (key === null)
      return fail(res, 'NotFoundException', `Key '${String(body.KeyId)}' does not exist`);
    if (operation === 'DisableKey') {
      key.enabled = false;
      return ok(res, {});
    }
    if (!key.enabled) return fail(res, 'DisabledException', `${key.arn} is disabled`);
    const need = (spec: FakeKmsKey['spec']): boolean => {
      if (key.spec === spec) return true;
      fail(res, 'InvalidKeyUsageException', `${key.arn} : mauvais type de clé`);
      return false;
    };

    switch (operation) {
      case 'GenerateMac': {
        if (!need('HMAC_256')) return;
        if (body.MacAlgorithm !== 'HMAC_SHA_256')
          return fail(res, 'ValidationException', 'MacAlgorithm inattendu');
        const message = b64(body.Message);
        if (message.length > 4096) return fail(res, 'ValidationException', 'message trop long');
        return ok(res, {
          KeyId: key.arn,
          MacAlgorithm: 'HMAC_SHA_256',
          Mac: createHmac('sha256', key.secret).update(message).digest('base64'),
        });
      }
      case 'GenerateDataKey': {
        if (!need('SYMMETRIC_DEFAULT')) return;
        if (body.KeySpec !== 'AES_256')
          return fail(res, 'ValidationException', 'KeySpec de clé de données inattendu');
        const plaintext = randomBytes(32);
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key.secret, nonce);
        const blob = Buffer.concat([
          nonce,
          cipher.update(plaintext),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
        return ok(res, {
          KeyId: key.arn,
          Plaintext: plaintext.toString('base64'),
          CiphertextBlob: blob.toString('base64'),
        });
      }
      case 'Decrypt': {
        if (!need('SYMMETRIC_DEFAULT')) return;
        const blob = b64(body.CiphertextBlob);
        try {
          const decipher = createDecipheriv('aes-256-gcm', key.secret, blob.subarray(0, 12));
          decipher.setAuthTag(blob.subarray(blob.length - 16));
          const plaintext = Buffer.concat([
            decipher.update(blob.subarray(12, blob.length - 16)),
            decipher.final(),
          ]);
          return ok(res, { KeyId: key.arn, Plaintext: plaintext.toString('base64') });
        } catch {
          return fail(res, 'InvalidCiphertextException', 'blob illisible');
        }
      }
      case 'Sign': {
        if (!need('ECC_NIST_P256')) return;
        const message = b64(body.Message);
        if (body.MessageType !== 'RAW' || body.SigningAlgorithm !== 'ECDSA_SHA_256')
          return fail(res, 'ValidationException', 'ce faux ne signe qu’en RAW / ECDSA_SHA_256');
        if (message.length > 4096) return fail(res, 'ValidationException', 'message trop long');
        const signature = cryptoSign('sha256', message, {
          key: key.privateKey as KeyObject,
          dsaEncoding: 'der',
        });
        return ok(res, {
          KeyId: key.arn,
          Signature: signature.toString('base64'),
          SigningAlgorithm: 'ECDSA_SHA_256',
        });
      }
      case 'GetPublicKey': {
        if (key.spec !== 'ECC_NIST_P256' && key.spec !== 'SYMMETRIC_DEFAULT')
          return fail(res, 'UnsupportedOperationException', 'pas de clé publique');
        const spki = key.publicKey?.export({ type: 'spki', format: 'der' }) ?? randomBytes(32); // clé symétrique : sans objet
        return ok(res, {
          KeyId: key.arn,
          KeySpec: key.spec,
          KeyUsage: key.usage,
          PublicKey: spki.toString('base64'),
        });
      }
      default:
        return fail(res, 'UnknownOperationException', 'opération non simulée');
    }
  };

  const server = await startFakeServer(handler);
  return {
    ...server,
    keys,
    calls,
    addKey,
    forceNext: (operation, response) => {
      forced.set(operation, response);
    },
  };
}

/** Client KMS du SDK pointé sur le faux : identifiants factices, un seul essai. */
export function kmsClientFor(server: FakeServer): KMSClient {
  return new KMSClient({
    region: 'eu-west-3',
    endpoint: server.url,
    credentials: FAKE_AWS_CREDENTIALS,
    maxAttempts: 1,
  });
}
