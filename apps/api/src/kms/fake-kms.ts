// FAUX service de clés (mission bracelets-nfc, décision du porteur : ports et faux seulement, l'adaptateur AWS viendra
// quand la région et les comptes seront arrêtés). JAMAIS en production : `createKms` refuse de le construire, et
// `assertNoFakeInProduction` refuse de démarrer un processus qui le porte (NFR-010). Dette consignée dans
// docs/POINTS_OUVERTS.md.
//
// Sans état partagé : les quatre processus sont distincts, chacun a son instance. Les clés se dérivent donc de leur
// référence (HMAC d'une graine fixe), de sorte qu'une clé créée par la commande d'administration est utilisable par la
// personnalisation, et qu'une clé de données ouverte par l'une se rouvre dans l'autre. La graine est dans le code :
// c'est précisément ce qui en fait un faux.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  KmsKeyError,
  KmsUnavailableError,
  type DataKeyPort,
  type DecryptPort,
  type KeyAdminPort,
  type KmsKeyKind,
  type MacPort,
} from './kms.ports';

const SEED = Buffer.from('cashless-fake-kms-v1 : graine de test, sans valeur');
const PREFIX: Record<KmsKeyKind, string> = {
  HMAC_256: 'fake-kms:hmac:',
  SYMMETRIC_DEFAULT: 'fake-kms:wrap:',
};

/** Référence dont la clé de dérivation est celle du kit (`00 01 … 1f`) : rejoue `vecteurs_test_bracelet.py`. */
export const KIT_VECTOR_HMAC_KEY_REF = 'fake-kms:hmac:kit-vector';
/** Clé d'emballage de test par défaut des jeux d'essai. */
export const TEST_WRAPPING_KEY_REF = 'fake-kms:wrap:test';

export type KmsOperation =
  | 'generateMac'
  | 'generateDataKey'
  | 'decrypt'
  | 'createKey'
  | 'disableKey';

export class FakeKms implements MacPort, DataKeyPort, DecryptPort, KeyAdminPort {
  /** Marqueur lu par la garde de production. */
  readonly isFake = true;
  readonly calls: Record<KmsOperation, number> = {
    generateMac: 0,
    generateDataKey: 0,
    decrypt: 0,
    createKey: 0,
    disableKey: 0,
  };
  private readonly failures = new Map<KmsOperation, number>();
  private readonly disabled = new Set<string>();

  /** Fait échouer les `count` prochains appels de l'opération (panne du service de clés). */
  failNext(operation: KmsOperation, count = 1): void {
    this.failures.set(operation, count);
  }

  resetCalls(): void {
    for (const key of Object.keys(this.calls) as KmsOperation[]) this.calls[key] = 0;
  }

  isDisabled(kmsKeyRef: string): boolean {
    return this.disabled.has(kmsKeyRef);
  }

  async generateMac(kmsKeyRef: string, message: Uint8Array): Promise<Buffer> {
    this.enter('generateMac');
    const key = this.key(kmsKeyRef, 'HMAC_256');
    try {
      return createHmac('sha256', key).update(message).digest();
    } finally {
      key.fill(0);
    }
  }

  async generateDataKey(wrappingKeyRef: string): Promise<{ plaintext: Buffer; encrypted: Buffer }> {
    this.enter('generateDataKey');
    const wrapping = this.key(wrappingKeyRef, 'SYMMETRIC_DEFAULT');
    try {
      const plaintext = randomBytes(32);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', wrapping, nonce);
      cipher.setAAD(Buffer.from(wrappingKeyRef));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { plaintext, encrypted: Buffer.concat([nonce, body, cipher.getAuthTag()]) };
    } finally {
      wrapping.fill(0);
    }
  }

  async decrypt(wrappingKeyRef: string, encrypted: Uint8Array): Promise<Buffer> {
    this.enter('decrypt');
    const wrapping = this.key(wrappingKeyRef, 'SYMMETRIC_DEFAULT');
    try {
      if (encrypted.length !== 12 + 32 + 16)
        throw new KmsKeyError('Clé de données chiffrée illisible');
      const decipher = createDecipheriv('aes-256-gcm', wrapping, encrypted.subarray(0, 12));
      decipher.setAAD(Buffer.from(wrappingKeyRef));
      decipher.setAuthTag(encrypted.subarray(44));
      return Buffer.concat([decipher.update(encrypted.subarray(12, 44)), decipher.final()]);
    } catch (error) {
      if (error instanceof KmsKeyError) throw error;
      throw new KmsKeyError('Clé de données chiffrée illisible sous cette clé d’emballage');
    } finally {
      wrapping.fill(0);
    }
  }

  async createKey(kind: KmsKeyKind): Promise<string> {
    this.enter('createKey');
    return `${PREFIX[kind]}${randomUUID()}`;
  }

  async disableKey(kmsKeyRef: string): Promise<void> {
    this.enter('disableKey');
    if (!kmsKeyRef.startsWith('fake-kms:')) throw new KmsKeyError('Référence de clé inconnue');
    // Propre à cette instance : la trace durable de la désactivation est `tag_key.kms_disabled_at`.
    this.disabled.add(kmsKeyRef);
  }

  private enter(operation: KmsOperation): void {
    this.calls[operation] += 1;
    const remaining = this.failures.get(operation) ?? 0;
    if (remaining > 0) {
      this.failures.set(operation, remaining - 1);
      throw new KmsUnavailableError(operation);
    }
  }

  private key(ref: string, kind: KmsKeyKind): Buffer {
    if (!ref.startsWith(PREFIX[kind]))
      throw new KmsKeyError(`Référence de clé inconnue ou d’un autre type (${kind} attendu)`);
    if (this.disabled.has(ref)) throw new KmsKeyError('Clé désactivée');
    if (ref === KIT_VECTOR_HMAC_KEY_REF)
      return Buffer.from(Array.from({ length: 32 }, (_v, i) => i));
    return createHmac('sha256', SEED).update(ref).digest();
  }
}
