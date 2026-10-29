// Coffre des secrets PSP : lecture par référence opaque `psp/<holder_party_id>/<nom>`, liée au titulaire
// des fonds (A10). Un coffre ne journalise ni ne renvoie jamais un secret ailleurs que dans `Secret`.
import type { Secret } from './secret';

export interface PspSecretBinding {
  configurationId: string;
  holderPartyId: string;
  secretRef: string;
}

export interface PspSecrets {
  adapter: Secret | null;
  notification: {
    current: Secret;
    previous: Secret | null;
    /** Échéance du précédent ; le contrôle est fait par `verifyHmacSignature`. */
    previousValidUntil: Date | null;
  };
}

export type PspSecretErrorCode = 'NOT_FOUND' | 'HOLDER_MISMATCH' | 'REF_INVALID' | 'UNAVAILABLE';

const MESSAGES: Record<PspSecretErrorCode, string> = {
  NOT_FOUND: 'secret PSP introuvable',
  HOLDER_MISMATCH: 'référence de secret PSP refusée',
  REF_INVALID: 'référence de secret PSP invalide',
  UNAVAILABLE: 'coffre des secrets PSP indisponible',
};

/** Le message ne contient ni valeur, ni référence, ni titulaire attendu. */
export class PspSecretError extends Error {
  constructor(readonly code: PspSecretErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PspSecretError';
  }
}

export interface PspSecretStore {
  readonly isFake?: boolean;
  get(binding: PspSecretBinding): Promise<PspSecrets>;
}
