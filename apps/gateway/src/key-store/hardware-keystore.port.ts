// Port du stockage matériel des clés de la passerelle (interfaces.md § 4, research R-27). Aucune
// clé maître, AUCUNE
// méthode d'export d'une clé privée, ni ici ni dans le faux : le port signe et accorde, il ne rend
// jamais la clé.
// L'adaptateur réel (module de sécurité du mini-PC) n'existe pas dans cette mission (mission 12b) :
// sa valeur de
// production est refusée au démarrage (`processes/startup-guard.ts`,
// `hardware-keystore.factory.ts`).
//
// Formats : `publicKey` rend la clé publique en SPKI DER ; `sign` rend une signature ES256 brute (r
// ‖ s, 64 octets,
// IEEE P1363, celle des JWS) ; `agree` prend la clé publique du pair en SPKI DER et rend le secret
// ECDH P-256.
export type KeyUse = 'snapshot' | 'token' | 'batch' | 'agreement';
export const KEY_USES: readonly KeyUse[] = ['snapshot', 'token', 'batch', 'agreement'];

export interface HardwareKeystore {
  sign(use: KeyUse, data: Buffer): Promise<Buffer>;
  agree(peerPublic: Buffer): Promise<Buffer>;
  publicKey(use: KeyUse): Promise<Buffer>;
  destroy(use: KeyUse): Promise<void>;
}

/** Jeton d'injection. */
export const HARDWARE_KEYSTORE = Symbol('HARDWARE_KEYSTORE');

/** Un faux porte `isFake = true` : la garde de démarrage le refuse en production. */
export interface MaybeFakeKeystore extends HardwareKeystore {
  readonly isFake?: boolean;
}

export type KeystoreErrorCode =
  | 'KEY_DESTROYED'
  | 'KEY_USE_INVALID'
  | 'KEY_PEER_INVALID'
  | 'KEY_FILE_INVALID';

export class KeystoreError extends Error {
  constructor(
    readonly code: KeystoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KeystoreError';
  }
}
