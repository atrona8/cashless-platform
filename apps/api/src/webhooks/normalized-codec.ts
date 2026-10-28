// Notification normalisée <-> JSON de `psp_event.normalized` (mission 6, lot WP12, T061). Le corps brut n'est pas
// lisible par `cashless_app` : la reprise relit cette forme. Montants en texte (bigint). Aucun secret, aucune
// signature, aucun en-tête : seulement ce que le port normalise.
import type { NormalizedNotification } from '../psp/psp.types';

/** Borne de la base (`record_psp_event` : 8 192 octets) avec marge. */
export const NORMALIZED_MAX_BYTES = 7000;

export function encodeNormalized(notification: NormalizedNotification): Record<string, unknown> {
  const { payment, dispute } = notification;
  return {
    notificationId: notification.notificationId,
    kind: notification.kind,
    payment: {
      merchantReference: payment.merchantReference,
      providerPaymentRef: payment.providerPaymentRef,
      amount: payment.amount.toString(),
      currency: payment.currency,
      card: payment.card,
    },
    dispute:
      dispute === null
        ? null
        : { providerDisputeId: dispute.providerDisputeId, amount: dispute.amount.toString() },
  };
}

export function normalizedSize(notification: NormalizedNotification): number {
  return Buffer.byteLength(JSON.stringify(encodeNormalized(notification)), 'utf8');
}

const KINDS = ['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'DISPUTE', 'UNKNOWN'];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `null` si la forme n'est pas celle de `encodeNormalized` (ligne illisible : traitée comme une erreur). */
export function decodeNormalized(value: unknown): NormalizedNotification | null {
  if (!isObject(value) || !isObject(value.payment)) return null;
  const payment = value.payment;
  if (
    typeof value.notificationId !== 'string' ||
    typeof value.kind !== 'string' ||
    !KINDS.includes(value.kind) ||
    typeof payment.providerPaymentRef !== 'string' ||
    typeof payment.amount !== 'string' ||
    !/^[0-9]{1,18}$/.test(payment.amount) ||
    typeof payment.currency !== 'string' ||
    (payment.merchantReference !== null && typeof payment.merchantReference !== 'string')
  )
    return null;
  let card: NormalizedNotification['payment']['card'] = null;
  if (payment.card !== null && payment.card !== undefined) {
    const raw = payment.card;
    if (!isObject(raw)) return null;
    const threeDs = raw.threeDs;
    if (threeDs !== 'SUCCEEDED' && threeDs !== 'FAILED' && threeDs !== 'NOT_PERFORMED')
      return null;
    if (raw.fingerprint !== null && typeof raw.fingerprint !== 'string') return null;
    card = { fingerprint: raw.fingerprint, threeDs };
  }
  let dispute: NormalizedNotification['dispute'] = null;
  if (value.dispute !== null && value.dispute !== undefined) {
    const raw = value.dispute;
    if (
      !isObject(raw) ||
      typeof raw.providerDisputeId !== 'string' ||
      typeof raw.amount !== 'string' ||
      !/^[0-9]{1,18}$/.test(raw.amount)
    )
      return null;
    dispute = { providerDisputeId: raw.providerDisputeId, amount: BigInt(raw.amount) };
  }
  return {
    notificationId: value.notificationId,
    kind: value.kind as NormalizedNotification['kind'],
    payment: {
      merchantReference: payment.merchantReference as string | null,
      providerPaymentRef: payment.providerPaymentRef,
      amount: BigInt(payment.amount),
      currency: payment.currency,
      card,
    },
    dispute,
  };
}
