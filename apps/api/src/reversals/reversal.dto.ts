// Corps de `reversePayment` (mission 5b, lot WP12, T055 ; contrat `ReversalRequest` ; contracts/payments.md).
//
// Règles tenues ici, avant toute écriture :
// - `supervisor_pin_proof` présent (quelle que soit sa valeur) : `422 VALIDATION_FAILED` (A8) : une preuve dans le
//   corps rendrait l'empreinte de la requête (`act_hash`) circulaire ; la preuve du `SUPERVISOR` passe par
//   l'en-tête `X-Approval-Token` seulement ;
// - `reason` dans l'énumération du contrat, `comment` de 500 caractères au plus ;
// - `vendor_session_id` : un identifiant s'il est présent ; absent, la route le refuse par la garde de session
//   (`409 VENDOR_SESSION_INVALID`, comme `createPayment`) ;
// - le corps ne porte jamais le vendeur, le terminal, le montant, le portefeuille ni la contrepartie : l'annulation
//   est TOTALE et reprend les lignes de la vente ; tout champ de ce genre reçu est ignoré.
import type { components } from '@cashless/contracts';
import { ProblemException } from '../errors/problem';
import {
  dateTimeField,
  enumField,
  isUuid,
  objectBody,
  textField,
  unprocessable,
} from '../organization/platform/platform.dto';
import { contentSha256 } from '../payments/device-seq-registry';

export type ReversalReason = components['schemas']['ReversalRequest']['reason'];

export const REVERSAL_REASONS: readonly ReversalReason[] = [
  'INPUT_ERROR',
  'CUSTOMER_CANCELLED',
  'PRODUCT_UNAVAILABLE',
  'DUPLICATE',
  'OTHER',
];

export const COMMENT_MAX = 500;

export interface ReversalInput {
  reason: ReversalReason;
  comment: string | null;
  occurredAt: Date;
  /** `null` : absent du corps (refusé par la garde de session, `409 VENDOR_SESSION_INVALID`). */
  vendorSessionId: string | null;
}

/** Le contrat ne connaît que `422 VALIDATION_FAILED` pour un corps invalide : les aides génériques (400) y sont ramenées. */
function as422<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof ProblemException && error.code === 'VALIDATION_FAILED')
      throw unprocessable(error.detail ?? 'Corps invalide.');
    throw error;
  }
}

export function parseReversal(raw: unknown): ReversalInput {
  return as422(() => parseBody(raw));
}

function parseBody(raw: unknown): ReversalInput {
  const body = objectBody(raw);
  if (body.supervisor_pin_proof !== undefined)
    throw unprocessable(
      'supervisor_pin_proof : champ refusé ; la preuve du SUPERVISOR passe par X-Approval-Token.',
    );
  const reason = enumField(body, 'reason', REVERSAL_REASONS, 'required')!;
  const comment = textField(body, 'comment', COMMENT_MAX, 'optional') ?? null;
  const occurredAt = dateTimeField(body, 'occurred_at', 'required')!;
  let vendorSessionId: string | null = null;
  if (body.vendor_session_id !== undefined) {
    if (!isUuid(body.vendor_session_id))
      throw unprocessable('vendor_session_id : identifiant attendu.');
    vendorSessionId = body.vendor_session_id;
  }
  return { reason, comment, occurredAt, vendorSessionId };
}

/**
 * Contenu d'une annulation au registre des numéros (sync_protocol.md §3.3) : champs chaînés `seq`, `type`
 * (`REVERSAL`), `occurred_at` (tel que reçu) et `reverses_transaction_id` (le chemin). JAMAIS `vendor_session_id`,
 * `reason` ni `comment` (non chaînés), ni un champ d'état. Calculé sur le corps TEL QUE REÇU, de sorte que même un
 * corps mal formé a un contenu et que son refus se range au registre ; `null` si le corps n'est pas un objet.
 * La forme devra être celle des lots hors ligne (mission 7), comme `purchaseContent`.
 */
export function reversalContent(seq: bigint, transactionId: string, body: unknown): Buffer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  return contentSha256({
    seq: Number(seq),
    type: 'REVERSAL',
    occurred_at: raw.occurred_at,
    reverses_transaction_id: transactionId,
  });
}

/** Corps du chemin de la personne (demande `SALE_REVERSAL`) : motif et commentaire ; session et heure du terminal sans objet. */
export function parseReversalRequest(raw: unknown): {
  reason: ReversalReason;
  comment: string | null;
} {
  return as422(() => {
    const body = objectBody(raw);
    if (body.supervisor_pin_proof !== undefined)
      throw unprocessable('supervisor_pin_proof : champ refusé.');
    if (body.vendor_session_id !== undefined && !isUuid(body.vendor_session_id))
      throw unprocessable('vendor_session_id : identifiant attendu.');
    return {
      reason: enumField(body, 'reason', REVERSAL_REASONS, 'required')!,
      comment: textField(body, 'comment', COMMENT_MAX, 'optional') ?? null,
    };
  });
}
