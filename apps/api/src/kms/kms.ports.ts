// Service de clés des bracelets (SPECIFICATION §3.2, §7.3, §7.4 ; mission bracelets-nfc, research R-03).
// Un port PAR DROIT : chaque processus ne reçoit que les ports de ses droits, et aucun type ne les réunit. Une faille
// de l'API publique ne peut donc appeler aucune opération de clé : elle n'en a aucun port.
//   API publique              aucun
//   clés de bracelet          DecryptPort
//   personnalisation          MacPort, DataKeyPort
//   contrôle quotidien        MacPort, DecryptPort
//   commande d'administration KeyAdminPort
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

export type KmsKeyKind = 'HMAC_256' | 'SYMMETRIC_DEFAULT';

/** Création et désactivation d'une clé : commande d'administration seulement (décision du porteur n° 6). */
export interface KeyAdminPort {
  createKey(kind: KmsKeyKind): Promise<string>;
  disableKey(kmsKeyRef: string): Promise<void>;
}

export const MAC_PORT = Symbol('MAC_PORT');
export const DATA_KEY_PORT = Symbol('DATA_KEY_PORT');
export const DECRYPT_PORT = Symbol('DECRYPT_PORT');
export const KEY_ADMIN_PORT = Symbol('KEY_ADMIN_PORT');

export type KmsCapability = 'mac' | 'dataKey' | 'decrypt' | 'keyAdmin';

export const KMS_PORT_TOKENS: Record<KmsCapability, symbol> = {
  mac: MAC_PORT,
  dataKey: DATA_KEY_PORT,
  decrypt: DECRYPT_PORT,
  keyAdmin: KEY_ADMIN_PORT,
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
