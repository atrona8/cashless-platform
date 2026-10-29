// Outil de test : fabrique une notification signée au schéma du contrat. Hors production seulement.
import { computeSignature } from '../hmac-signature';
import type { PspProviderName } from '../psp.types';
import { Secret } from '../secret';
import { signatureHeaderName, type FakeCardInput } from './fake-psp-adapter';

export type FakeEvent = Record<string, unknown>;

interface Base {
  id: string;
  merchantReference: string | null;
  paymentId: string;
  amount: number;
  currency: string;
  card?: FakeCardInput;
}

function payment(type: string, input: Base): FakeEvent {
  return {
    id: input.id,
    type,
    merchant_reference: input.merchantReference,
    payment_id: input.paymentId,
    amount: input.amount,
    currency: input.currency,
    ...(input.card
      ? { card: { fingerprint: input.card.fingerprint, three_ds: input.card.threeDs } }
      : {}),
  };
}

export const fakeEvents = {
  succeeded: (input: Base): FakeEvent => payment('payment.succeeded', input),
  failed: (input: Base): FakeEvent => payment('payment.failed', input),
  cancelled: (input: Base): FakeEvent => payment('payment.cancelled', input),
  dispute: (input: Base & { disputeId: string; disputeAmount: number }): FakeEvent => ({
    ...payment('dispute.created', input),
    dispute: { id: input.disputeId, amount: input.disputeAmount },
  }),
};

export function signFakeNotification(input: {
  provider: PspProviderName;
  secret: string | Secret;
  event: FakeEvent;
  timestamp?: number;
  /** Corps altéré après signature (test d'un octet changé). */
  rawBody?: Buffer;
}): { rawBody: Buffer; headerName: string; headers: Record<string, string> } {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signedBody = Buffer.from(JSON.stringify(input.event), 'utf8');
  const secret = typeof input.secret === 'string' ? Secret.of(input.secret) : input.secret;
  const signature = computeSignature(secret, timestamp, signedBody);
  const headerName = signatureHeaderName(input.provider);
  return {
    rawBody: input.rawBody ?? signedBody,
    headerName,
    headers: { [headerName]: `t=${timestamp},v1=${signature}` },
  };
}
