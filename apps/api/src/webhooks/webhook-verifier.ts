// Vérification d'une notification entrante (mission 6, lot WP12, T060 point 3 ; R-10, A23). Fonction pure.
// Le schéma propre au fournisseur (en-tête, format, HMAC sur `t.corps_brut`, comparaison à temps constant sur les
// DEUX secrets) est délégué à `PspAdapter.verifyNotification` (WP07). Ce fichier REJOUE ici, sans confiance dans
// l'adaptateur, les garanties qui ouvrent la route : tolérance d'horodatage, échéance du secret précédent, identifiant
// de notification borné. Un adaptateur qui lève une exception est un refus (jamais un `500`, jamais un message).
import { WEBHOOK_TOLERANCE_SECONDS } from '../psp/hmac-signature';
import type { PspAdapter } from '../psp/psp-adapter.port';
import type { PspSecrets } from '../psp/psp-secret-store.port';
import type { NormalizedNotification } from '../psp/psp.types';
import type { WebhookRejectionReason } from './webhook-rejections';

/** Longueur permise de l'identifiant de notification chez le PSP (`record_psp_event`). */
export const NOTIFICATION_ID_MAX = 200;

export type WebhookVerification =
  | {
      ok: true;
      kind: 'NOTIFICATION';
      notification: NormalizedNotification;
      signedAt: Date;
      secretUsed: 'current' | 'previous';
      /** Le statut du corps n'est pas cru : la recharge n'est créditée que par une relecture authentifiée. */
      confirmationRequired: boolean;
    }
  | {
      ok: true;
      kind: 'SIGNAL';
      notificationId: string;
      reference: { merchantReference: string | null; providerPaymentRef: string };
      secretUsed: 'current';
    }
  | { ok: false; reason: WebhookRejectionReason };

export interface VerifyWebhookInput {
  adapter: Pick<PspAdapter, 'verifyNotification'>;
  rawBody: Buffer;
  contentType: 'json' | 'form';
  headers: Record<string, string | string[] | undefined>;
  secrets: PspSecrets;
  /** Horloge de Node : seule tolérance (±300 s), jamais comparée à celle de la base. */
  now: Date;
}

export function verifyWebhook(input: VerifyWebhookInput): WebhookVerification {
  let verdict: ReturnType<PspAdapter['verifyNotification']>;
  try {
    verdict = input.adapter.verifyNotification({
      rawBody: input.rawBody,
      contentType: input.contentType,
      headers: input.headers,
      secrets: input.secrets,
      now: input.now,
    });
  } catch {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  if (verdict.kind === 'SIGNAL') {
    // Un signal n'a ni horodatage ni montant : seuls l'identifiant borné et le secret COURANT comptent. Un secret
    // précédent ne suffit jamais à lui seul pour provoquer une relecture (défense en profondeur).
    if ((verdict.secretUsed as string) !== 'current')
      return { ok: false, reason: 'SIGNATURE_INVALID' };
    const signalId = verdict.notificationId;
    if (
      typeof signalId !== 'string' ||
      signalId.length < 1 ||
      signalId.length > NOTIFICATION_ID_MAX
    )
      return { ok: false, reason: 'BODY_MALFORMED' };
    return {
      ok: true,
      kind: 'SIGNAL',
      notificationId: signalId,
      reference: verdict.reference,
      secretUsed: 'current',
    };
  }

  // Défense en profondeur : horodatage signé dans la tolérance.
  const skew = Math.abs(verdict.signedAt.getTime() - input.now.getTime());
  if (!(skew <= WEBHOOK_TOLERANCE_SECONDS * 1000))
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };

  // Défense en profondeur : le secret précédent n'est valable que jusqu'à son échéance (A23).
  if (verdict.secretUsed === 'previous') {
    const { previous, previousValidUntil } = input.secrets.notification;
    if (
      previous === null ||
      previousValidUntil === null ||
      input.now.getTime() > previousValidUntil.getTime()
    )
      return { ok: false, reason: 'SIGNATURE_INVALID' };
  }

  const id = verdict.notification.notificationId;
  if (typeof id !== 'string' || id.length < 1 || id.length > NOTIFICATION_ID_MAX)
    return { ok: false, reason: 'BODY_MALFORMED' };
  return {
    ok: true,
    kind: 'NOTIFICATION',
    notification: verdict.notification,
    signedAt: verdict.signedAt,
    secretUsed: verdict.secretUsed,
    confirmationRequired: verdict.confirmationRequired,
  };
}
