// Port commun des PSP (mission 6, WP07 ; révisé mission 12b-1, WP02). Les adaptateurs réels l'implémentent.
//
// Ordre contractuel de `verifyNotification`, sans exception :
//   (1) preuve d'origine présente et bien formée (pour PayDunya, seul le champ `data[hash]` est lu avant) ;
//   (2) preuve vérifiée pour les DEUX secrets, sans sortie anticipée ;
//   (3) secret précédent refusé après son échéance ;
//   (4) horodatage `|t - now| <= tolérance du fournisseur` (300 s) quand la preuve en porte un ;
//   (5) seulement alors, lecture du corps et normalisation.
// Aucun champ du corps n'est lu avant (1) à (4). Le faux n'est jamais un modèle de sécurité.
//
// Règles de la révision (contracts/psp-port.md) :
//   1. preuve d'origine avant toute lecture du corps ;
//   2. `NOTIFICATION` : horodatage signé obligatoire, rejoué par `webhook-verifier.ts` ;
//   3. `SIGNAL` : aucun montant, aucune devise, aucune carte ; ne produit jamais d'écriture ; déclenche une relecture ;
//   4. `confirmationRequired: true` : la notification est conservée sans effet, le crédit vient de `getStatus` ;
//   5. `getStatus` rend le paiement complet : seule source d'un crédit après un signal ou une relecture ;
//   6. le faux garde `t.corps` et rend `NOTIFICATION` avec `confirmationRequired: false` ;
//   7. `readStatement` peut rendre `{ supported: false }` : rapprochement manuel.
import type { PspSecrets } from './psp-secret-store.port';
import type {
  NormalizedNotification,
  PspInitiateRequest,
  PspInitiateResult,
  PspProviderName,
  PspStatement,
  PspStatusQuery,
  PspStatusResult,
} from './psp.types';

export type PspRejectionReason =
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'TIMESTAMP_OUT_OF_TOLERANCE'
  | 'BODY_MALFORMED';

export type PspVerification =
  | {
      ok: true;
      kind: 'NOTIFICATION';
      notification: NormalizedNotification;
      signedAt: Date;
      secretUsed: 'current' | 'previous';
      confirmationRequired: boolean;
    }
  | {
      ok: true;
      kind: 'SIGNAL';
      notificationId: string;
      reference: { merchantReference: string | null; providerPaymentRef: string };
      secretUsed: 'current';
    }
  | { ok: false; reason: PspRejectionReason };

export interface VerifyNotificationInput {
  rawBody: Buffer;
  /** `form` : PayDunya seul. */
  contentType: 'json' | 'form';
  headers: Record<string, string | string[] | undefined>;
  secrets: PspSecrets;
  now: Date;
}

export interface PspAdapter {
  readonly provider: PspProviderName;
  readonly isFake?: boolean;
  initiate(request: PspInitiateRequest, secrets: PspSecrets): Promise<PspInitiateResult>;
  /** Synchrone, sans réseau. */
  verifyNotification(input: VerifyNotificationInput): PspVerification;
  getStatus(query: PspStatusQuery, secrets: PspSecrets): Promise<PspStatusResult>;
  /** Ajout au port (contracts/psp.md règle 9) : `PENDING -> CANCELLED` seulement si le PSP confirme. */
  cancel(query: PspStatusQuery, secrets: PspSecrets): Promise<{ cancelled: boolean }>;
  readStatement(period: { from: Date; to: Date }, secrets: PspSecrets): Promise<PspStatement>;
  /**
   * Facultatif (12b-1, WP07) : retrouve, chez le PSP, la recharge d'une référence qui n'est pas celle d'une
   * session (Stripe : `payment_intent` d'un litige). `null` si le PSP n'en connaît aucune. Le branchement côté
   * réception est fait par WP03.
   */
  resolvePaymentReference?(
    reference: string,
    secrets: PspSecrets,
  ): Promise<{ merchantReference: string; providerPaymentRef: string } | null>;
}
