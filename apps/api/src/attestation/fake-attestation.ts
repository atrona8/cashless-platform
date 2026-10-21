// FAUX vérificateur d'attestation, hors production seulement (NFR-001) : il ne vérifie AUCUNE cryptographie. Il sert
// aux processus de test et au poste local sans racines d'attestation configurées. `isFake` : la garde de production
// (`assertProcessIsSafe`) refuse le démarrage, et la fabrique du module refuse de le construire en production.
import {
  AttestationError,
  type AttestationInput,
  type AttestationResult,
  type AttestationVerifier,
} from './attestation.port';

export class FakeAttestation implements AttestationVerifier {
  readonly isFake = true;

  /** `refusal` : raison de refus imposée (tests du chemin `ATTESTATION_FAILED`). */
  constructor(private readonly refusal: string | null = null) {}

  async verify(input: AttestationInput): Promise<AttestationResult> {
    if (this.refusal !== null) throw new AttestationError(`faux : ${this.refusal}`);
    if (input.keyAttestationChain.length === 0) throw new AttestationError('faux : chaîne absente');
    if (input.os === 'ANDROID') {
      if (!input.agreementAttestationChain || input.agreementAttestationChain.length === 0)
        throw new AttestationError('faux : chaîne de la clé d’accord absente');
      return { kind: 'ANDROID_KEY_ATTESTATION', securityLevel: 'TRUSTED_ENVIRONMENT' };
    }
    return { kind: 'IOS_APP_ATTEST', securityLevel: null };
  }
}
