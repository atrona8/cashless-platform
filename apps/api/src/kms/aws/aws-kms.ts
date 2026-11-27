// Adaptateur AWS KMS des cinq ports de clés (mission 12b-1, WP09 ; contracts/aws.md, research R-09). Même format que le
// faux : signature DER, clé publique SPKI de 91 octets, tampons en clair remis à l'appelant (qui les met à zéro).
// Identifiants AWS : chaîne par défaut du SDK, jamais de clé d'accès ici. Aucune erreur ne porte l'identifiant de clé
// ni le message du SDK : la classe et le code AWS seulement.
import {
  CreateKeyCommand,
  DecryptCommand,
  DisableKeyCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  GetPublicKeyCommand,
  SignCommand,
  type KeySpec,
  type KeyUsageType,
  type KMSClient,
} from '@aws-sdk/client-kms';
import {
  KmsKeyError,
  KmsUnavailableError,
  type DataKeyPort,
  type DecryptPort,
  type KeyAdminPort,
  type KmsCapability,
  type KmsKeyKind,
  type MacPort,
  type SignPort,
} from '../kms.ports';
import { zeroize } from '../zeroize';

/** Taille maximale d'un message en mode RAW (`Sign`) ; `GenerateMac` a la même borne. */
export const KMS_MAX_MESSAGE_BYTES = 4096;
const SPKI_P256_BYTES = 91;
const MAC_BYTES = 32;
const DATA_KEY_BYTES = 32;

const KEY_SPECS: Record<KmsKeyKind, { KeySpec: KeySpec; KeyUsage: KeyUsageType }> = {
  HMAC_256: { KeySpec: 'HMAC_256', KeyUsage: 'GENERATE_VERIFY_MAC' },
  SYMMETRIC_DEFAULT: { KeySpec: 'SYMMETRIC_DEFAULT', KeyUsage: 'ENCRYPT_DECRYPT' },
  ECC_NIST_P256: { KeySpec: 'ECC_NIST_P256', KeyUsage: 'SIGN_VERIFY' },
};

/** Codes AWS qui désignent la clé (inconnue, désactivée, mauvais usage) et non une panne du service. */
const KEY_ERROR_CODES = new Set([
  'NotFoundException',
  'DisabledException',
  'KeyUnavailableException',
  'InvalidKeyUsageException',
  'InvalidArnException',
  'KMSInvalidStateException',
  'IncorrectKeyException',
  'InvalidCiphertextException',
  'ValidationException',
]);

const CAPABILITY_METHODS: Record<KmsCapability, ReadonlyArray<keyof KmsPorts>> = {
  mac: ['generateMac'],
  dataKey: ['generateDataKey'],
  decrypt: ['decrypt'],
  sign: ['sign', 'publicKey'],
  keyAdmin: ['createKey', 'disableKey', 'publicKey'],
};

type KmsPorts = MacPort & DataKeyPort & DecryptPort & SignPort & KeyAdminPort;
interface CapabilityPorts {
  mac: MacPort;
  dataKey: DataKeyPort;
  decrypt: DecryptPort;
  sign: SignPort;
  keyAdmin: KeyAdminPort;
}
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;
/** Les seuls ports des droits demandés : une méthode d'un autre droit n'existe pas au typage. */
export type KmsPortsFor<C extends KmsCapability> = Readonly<
  UnionToIntersection<CapabilityPorts[C]>
>;

export class AwsKms implements MacPort, DataKeyPort, DecryptPort, SignPort, KeyAdminPort {
  readonly isFake = false;
  readonly service = 'kms' as const;

  constructor(private readonly client: KMSClient) {}

  /**
   * Objet gelé qui n'expose que les méthodes des droits demandés (un processus n'a que ses ports, C-005). C'est un
   * objet simple de fermetures : ni prototype de `AwsKms`, ni accès à l'adaptateur complet.
   */
  forCapabilities<const C extends KmsCapability>(caps: readonly C[]): KmsPortsFor<C> {
    const view: Record<string, unknown> = {};
    for (const cap of caps) {
      for (const method of CAPABILITY_METHODS[cap]) {
        const fn = this[method] as (...args: unknown[]) => unknown;
        view[method] = (...args: unknown[]) => fn.apply(this, args);
      }
    }
    return Object.freeze(view) as KmsPortsFor<C>;
  }

  async generateMac(kmsKeyRef: string, message: Uint8Array): Promise<Buffer> {
    assertMessageSize(message);
    const out = await this.call('generateMac', () =>
      this.client.send(
        new GenerateMacCommand({
          KeyId: kmsKeyRef,
          Message: message,
          MacAlgorithm: 'HMAC_SHA_256',
        }),
      ),
    );
    const sdkMac = out.Mac;
    try {
      if (sdkMac === undefined || sdkMac.length !== MAC_BYTES) throw unexpected('generateMac');
      return Buffer.from(sdkMac);
    } finally {
      zeroize(sdkMac);
    }
  }

  async generateDataKey(wrappingKeyRef: string): Promise<{ plaintext: Buffer; encrypted: Buffer }> {
    const out = await this.call('generateDataKey', () =>
      this.client.send(new GenerateDataKeyCommand({ KeyId: wrappingKeyRef, KeySpec: 'AES_256' })),
    );
    const sdkPlain = out.Plaintext;
    const sdkBlob = out.CiphertextBlob;
    try {
      if (sdkPlain === undefined || sdkPlain.length !== DATA_KEY_BYTES || !sdkBlob?.length)
        throw unexpected('generateDataKey');
      return { plaintext: Buffer.from(sdkPlain), encrypted: Buffer.from(sdkBlob) };
    } finally {
      zeroize(sdkPlain, sdkBlob);
    }
  }

  async decrypt(wrappingKeyRef: string, encrypted: Uint8Array): Promise<Buffer> {
    const out = await this.call('decrypt', () =>
      this.client.send(new DecryptCommand({ KeyId: wrappingKeyRef, CiphertextBlob: encrypted })),
    );
    const sdkPlain = out.Plaintext;
    try {
      if (sdkPlain === undefined || sdkPlain.length === 0) throw unexpected('decrypt');
      return Buffer.from(sdkPlain);
    } finally {
      zeroize(sdkPlain);
    }
  }

  async sign(kmsKeyRef: string, message: Uint8Array): Promise<Buffer> {
    assertMessageSize(message);
    const out = await this.call('sign', () =>
      this.client.send(
        new SignCommand({
          KeyId: kmsKeyRef,
          Message: message,
          MessageType: 'RAW',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
      ),
    );
    const sdkSignature = out.Signature;
    try {
      if (sdkSignature === undefined || !isDerEcdsaSignature(sdkSignature))
        throw unexpected('sign');
      return Buffer.from(sdkSignature);
    } finally {
      zeroize(sdkSignature);
    }
  }

  async publicKey(kmsKeyRef: string): Promise<Buffer> {
    const out = await this.call('publicKey', () =>
      this.client.send(new GetPublicKeyCommand({ KeyId: kmsKeyRef })),
    );
    const sdkKey = out.PublicKey;
    try {
      if (
        out.KeySpec !== 'ECC_NIST_P256' ||
        sdkKey === undefined ||
        sdkKey.length !== SPKI_P256_BYTES
      )
        throw new KmsKeyError('publicKey : clé qui n’est pas ECC_NIST_P256 (SPKI de 91 octets)');
      return Buffer.from(sdkKey);
    } finally {
      zeroize(sdkKey);
    }
  }

  async createKey(kind: KmsKeyKind): Promise<string> {
    const spec = KEY_SPECS[kind];
    const out = await this.call('createKey', () =>
      this.client.send(new CreateKeyCommand({ KeySpec: spec.KeySpec, KeyUsage: spec.KeyUsage })),
    );
    const arn = out.KeyMetadata?.Arn;
    if (typeof arn !== 'string' || arn === '') throw unexpected('createKey');
    return arn;
  }

  async disableKey(kmsKeyRef: string): Promise<void> {
    await this.call('disableKey', () =>
      this.client.send(new DisableKeyCommand({ KeyId: kmsKeyRef })),
    );
  }

  /** Appel au SDK : toute erreur devient une erreur du port, sans identifiant de clé ni message du SDK. */
  private async call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const code = awsCode(error);
      if (KEY_ERROR_CODES.has(code)) throw new KmsKeyError(`${operation} : ${code}`);
      throw new KmsUnavailableError(`${operation} : ${code}`);
    }
  }
}

function assertMessageSize(message: Uint8Array): void {
  if (message.length > KMS_MAX_MESSAGE_BYTES)
    throw new KmsKeyError(
      `message de ${KMS_MAX_MESSAGE_BYTES} octets au plus (refusé avant appel)`,
    );
}

function unexpected(operation: string): KmsUnavailableError {
  return new KmsUnavailableError(`${operation} : réponse inattendue`);
}

/** Code d'erreur AWS (`name` de l'exception du SDK), borné et sans autre contenu : jamais le message. */
function awsCode(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && /^[A-Za-z0-9_.]{1,64}$/.test(name) ? name : 'Unknown';
}

/** DER ECDSA : SEQUENCE (0x30) courte dont la longueur annoncée couvre tout le reste ; jamais r||s brut. */
function isDerEcdsaSignature(signature: Uint8Array): boolean {
  return (
    signature.length >= 8 &&
    signature.length <= 72 &&
    signature[0] === 0x30 &&
    signature[1] === signature.length - 2
  );
}
