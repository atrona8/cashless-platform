// Port commun des PSP (mission 6, WP07). Les adaptateurs réels (mission suivante) l'implémentent.
//
// Ordre contractuel de `verifyNotification`, sans exception :
//   (1) en-tête de signature présent et bien formé ;
//   (2) signature sur `t.corps_brut` pour les DEUX secrets, sans sortie anticipée ;
//   (3) secret précédent refusé après son échéance ;
//   (4) horodatage `|t - now| <= 300 s` ;
//   (5) seulement alors, lecture du JSON et normalisation.
// Aucun champ du corps n'est lu avant (1) à (4). Le faux n'est jamais un modèle de sécurité.
import type { PspSecrets } from './psp-secret-store.port';
import type {
  NormalizedNotification,
  PspInitiateRequest,
  PspInitiateResult,
  PspProviderName,
  PspStatementLine,
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
      notification: NormalizedNotification;
      signedAt: Date;
      secretUsed: 'current' | 'previous';
    }
  | { ok: false; reason: PspRejectionReason };

export interface VerifyNotificationInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  secrets: PspSecrets;
  now: Date;
}

export interface PspAdapter {
  readonly provider: PspProviderName;
  readonly isFake?: boolean;
  initiate(request: PspInitiateRequest, secrets: PspSecrets): Promise<PspInitiateResult>;
  verifyNotification(input: VerifyNotificationInput): PspVerification;
  getStatus(query: PspStatusQuery, secrets: PspSecrets): Promise<PspStatusResult>;
  /** Ajout au port (contracts/psp.md règle 9) : `PENDING -> CANCELLED` seulement si le PSP confirme. */
  cancel(query: PspStatusQuery, secrets: PspSecrets): Promise<{ cancelled: boolean }>;
  readStatement(period: { from: Date; to: Date }, secrets: PspSecrets): Promise<PspStatementLine[]>;
}
