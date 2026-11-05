// Service de clés des bracelets (SPECIFICATION §3.2, §7.3, §7.4 ; mission bracelets-nfc, research R-03).
// Un port PAR DROIT : chaque processus ne reçoit que les ports de ses droits, et aucun type ne les réunit. Une faille
// de l'API publique ne peut donc appeler aucune opération de clé : elle n'en a aucun port.
//   API publique              aucun
//   clés de bracelet          DecryptPort
//   personnalisation          MacPort, DataKeyPort
//   contrôle quotidien        MacPort, DecryptPort
//   commande d'administration KeyAdminPort
//   signature des snapshots   SignPort
// Toute valeur en clair rendue par un port est un tampon que l'appelant met à zéro (voir zeroize.ts).

/** `kms:GenerateMac` sur une clé de dérivation (HMAC_256) : calcule le mot de passe d'un bracelet. */
export interface MacPort {
  generateMac(kmsKeyRef: string, message: Uint8Array): Promise<Buffer>;
}

/** `kms:GenerateDataKey` sur la clé d'emballage : ouvre une clé de données (clair + forme chiffrée à stocker). */
export interface DataKeyPort {
  generateDataKey(wrappingKeyRef: string): Promise<{ plaintext: Buffer; encrypted: Buffer }>;
}

/** `kms:Decrypt` sur la clé d'emballage : rouvre une clé de données stockée. */
export interface DecryptPort {
  decrypt(wrappingKeyRef: string, encrypted: Uint8Array): Promise<Buffer>;
}

/**
 * `kms:Sign` (ECDSA_SHA_256, MessageType RAW) sur une clé `ECC_NIST_P256` : signe les octets de `message` (le
 * port calcule lui-même le SHA-256, l'appelant passe `JCS(header)` tel quel). Signature au format DER (pas de
 * format brut r||s). `publicKey` rend la clé publique SPKI DER (91 octets) : une clé publique n'est pas un secret.
 */
export interface SignPort {
  sign(kmsKeyRef: string, message: Uint8Array): Promise<Buffer>;
  publicKey(kmsKeyRef: string): Promise<Buffer>;
}

export type KmsKeyKind = 'HMAC_256' | 'SYMMETRIC_DEFAULT' | 'ECC_NIST_P256';

/** Création et désactivation d'une clé : commande d'administration seulement (décision du porteur n° 6). */
export interface KeyAdminPort {
  createKey(kind: KmsKeyKind): Promise<string>;
  disableKey(kmsKeyRef: string): Promise<void>;
  /** Lecture seule : clé publique SPKI DER d'une clé `ECC_NIST_P256` (décision du porteur, 30/10/2026). */
  publicKey(kmsKeyRef: string): Promise<Buffer>;
}

export const MAC_PORT = Symbol('MAC_PORT');
export const DATA_KEY_PORT = Symbol('DATA_KEY_PORT');
export const DECRYPT_PORT = Symbol('DECRYPT_PORT');
export const KEY_ADMIN_PORT = Symbol('KEY_ADMIN_PORT');
export const SIGN_PORT = Symbol('SIGN_PORT');

export type KmsCapability = 'mac' | 'dataKey' | 'decrypt' | 'keyAdmin' | 'sign';

export const KMS_PORT_TOKENS: Record<KmsCapability, symbol> = {
  mac: MAC_PORT,
  dataKey: DATA_KEY_PORT,
  decrypt: DECRYPT_PORT,
  keyAdmin: KEY_ADMIN_PORT,
  sign: SIGN_PORT,
};

/** Le service de clés ne répond pas : refus temporaire, rien n'est enregistré à moitié. */
export class KmsUnavailableError extends Error {
  constructor(operation: string) {
    super(`Service de clés indisponible (${operation})`);
    this.name = 'KmsUnavailableError';
  }
}

/** Référence de clé inconnue, désactivée, ou d'un autre type que celui de l'opération. */
export class KmsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmsKeyError';
  }
}
