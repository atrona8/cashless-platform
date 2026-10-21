// Port du vérificateur d'attestation des terminaux (mission identite-enrolement-terminaux, plan IC-09, research R-05,
// R-06, R-08). Partagé par Android (WP10) et iOS (WP11) ; injecté sous le jeton ATTESTATION_VERIFIER
// (security/port-tokens.ts), que la garde de production lit (un faux y fait refuser le démarrage).

export type AttestationOs = 'ANDROID' | 'IOS';

/** Valeurs de `device.attestation_kind` (data-model). */
export type AttestationKind = 'ANDROID_KEY_ATTESTATION' | 'IOS_APP_ATTEST';

/** Valeurs de `device.attestation_security_level` (data-model) ; iOS : `null`. */
export type AttestationSecurityLevel = 'TRUSTED_ENVIRONMENT' | 'STRONGBOX';

/** Ce que l'enrôlement soumet au vérificateur, déjà décodé du base64 du contrat. */
export interface AttestationInput {
  os: AttestationOs;
  /**
   * Android : chaîne d'attestation de la clé de signature, feuille en premier (DER). iOS : `[objet App Attest]`.
   */
  keyAttestationChain: readonly Buffer[];
  /** Android : chaîne d'attestation de la clé d'accord, feuille en premier (DER), obligatoire. iOS : absente. */
  agreementAttestationChain: readonly Buffer[] | null;
  /** SubjectPublicKeyInfo DER de la clé de signature (`signing_public_key`). */
  signingPublicKey: Buffer;
  /** SubjectPublicKeyInfo DER de la clé d'accord (`agreement_public_key`). */
  agreementPublicKey: Buffer;
  /** Code d'enrôlement normalisé (sans tirets, en majuscules) : il fixe les défis (R-08). */
  enrollmentCode: string;
  serial: string;
}

export interface AttestationResult {
  kind: AttestationKind;
  securityLevel: AttestationSecurityLevel | null;
}

export interface AttestationVerifier {
  /** Faux : la garde de production refuse le démarrage (NFR-001). */
  readonly isFake?: boolean;
  /** Rend le résultat ou lève `AttestationError` (→ `422 ATTESTATION_FAILED`). */
  verify(input: AttestationInput): Promise<AttestationResult>;
}

/**
 * Attestation refusée. `reason` est interne (journal et audit `DEVICE_ENROLLMENT_REFUSED`) : elle n'est JAMAIS
 * renvoyée au client, qui reçoit seulement `422 ATTESTATION_FAILED`.
 */
export class AttestationError extends Error {
  constructor(readonly reason: string) {
    super(`Attestation refusée : ${reason}`);
    this.name = 'AttestationError';
  }
}
