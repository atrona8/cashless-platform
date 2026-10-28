// Types normalisés des PSP (mission 6, WP07). Les montants sont des `bigint` (SPECIFICATION §5.5).

export const PSP_PROVIDERS = ['WAVE', 'ORANGE_MONEY', 'PAYDUNYA', 'STRIPE'] as const;
export type PspProviderName = (typeof PSP_PROVIDERS)[number];
export type PspMethod = 'WAVE' | 'ORANGE_MONEY' | 'CARD';

export const PROVIDER_METHOD: Readonly<Record<PspProviderName, PspMethod>> = {
  WAVE: 'WAVE',
  ORANGE_MONEY: 'ORANGE_MONEY',
  PAYDUNYA: 'CARD',
  STRIPE: 'CARD',
};

/** Segments de `receivePspWebhook`. */
export const PROVIDER_PATH_SEGMENT: Readonly<Record<PspProviderName, string>> = {
  WAVE: 'wave',
  ORANGE_MONEY: 'orange-money',
  PAYDUNYA: 'paydunya',
  STRIPE: 'stripe',
};

export function providerFromPathSegment(segment: string): PspProviderName | null {
  for (const provider of PSP_PROVIDERS)
    if (PROVIDER_PATH_SEGMENT[provider] === segment) return provider;
  return null;
}

export type PaymentAction =
  | { kind: 'REDIRECT'; url: string }
  | { kind: 'INSTRUCTION'; text: string };

export interface PspInitiateRequest {
  /** Référence marchande (R-20 A2). */
  pspTopupId: string;
  method: PspMethod;
  amount: bigint;
  currency: string;
  payerMsisdn: string | null;
  returnUrl: string | null;
  notificationUrl: string;
}

export interface PspInitiateResult {
  providerPaymentRef: string;
  action: PaymentAction;
  expiresAt: Date;
}

export interface NormalizedCard {
  fingerprint: string | null;
  threeDs: 'SUCCEEDED' | 'FAILED' | 'NOT_PERFORMED';
}

export interface NormalizedPayment {
  merchantReference: string | null;
  providerPaymentRef: string;
  amount: bigint;
  currency: string;
  card: NormalizedCard | null;
}

export interface NormalizedNotification {
  notificationId: string;
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED' | 'DISPUTE' | 'UNKNOWN';
  payment: NormalizedPayment;
  dispute: { providerDisputeId: string; amount: bigint } | null;
}

export interface PspStatusQuery {
  merchantReference: string;
  providerPaymentRef: string | null;
}

export interface PspStatusResult {
  state: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
  payment: NormalizedPayment | null;
}

/** Signature seulement : le relevé est livré avec les adaptateurs réels. */
export interface PspStatementLine {
  reference: string;
  amount: bigint;
  currency: string;
  date: Date;
}
