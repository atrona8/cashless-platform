// Preuve du bracelet au rejeu (WP13, T060, A07, décision 13). Le central contrôle en SQL le compteur, l'UID et le
// `token_hash` (`edge_post_transaction`) ; il pose `tap.signature_verified` d'après CE port, jamais d'après la valeur
// reçue de la passerelle. Aucune clé de bracelet dans le processus `edge` : la vérification est la comparaison de
// l'empreinte de la signature à celle enregistrée à la personnalisation, faite par `edge_tap_proof` (SQL, SECURITY
// DEFINER, booléen seul). Un faux (`isFake = true`) est refusé en production par `assertProcessIsSafe`.
import type { EdgeGateway } from '../auth/edge-gateway';

export interface TapProofInput {
  /** `tap.token_hash`, 32 octets. */
  tokenHash: Buffer;
  /** `tap.nfc_uid`, 7 octets. */
  nfcUid: Buffer;
  /** `tap.originality_signature` décodée, ou `null` si absente. */
  originalitySignature: Buffer | null;
}

export interface TapProofVerifier {
  readonly isFake?: boolean;
  /**
   * Vrai seulement si la signature de passage est celle du bracelet désigné (dans le grand livre de
   * la passerelle).
   */
  verify(gateway: EdgeGateway, input: TapProofInput): Promise<boolean>;
}

export const TAP_PROOF_VERIFIER = Symbol('TAP_PROOF_VERIFIER');
