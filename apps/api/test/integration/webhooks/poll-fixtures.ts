// Jeu d'essai de l'interrogation (mission 6, lot WP12, T064) : apprend au faux PSP une recharge et son état.
import { Secret } from '../../../src/psp/secret';
import type { PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import type { WebhookWorld } from './webhook-fixtures';

/**
 * Apprend au faux PSP une recharge (comme `initiate` l'aurait fait) puis fixe l'état de son paiement ; rend la
 * référence du paiement chez le PSP. Les secrets passés au faux sont factices : il ne les lit pas.
 */
export async function registerPayment(
  w: WebhookWorld,
  topup: PspTopupRow,
  state: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED',
  options: { card?: { fingerprint?: string | null; threeDs?: string | null } } = {},
): Promise<string> {
  const adapter = w.p.adapter(topup.method);
  const result = await adapter.initiate(
    {
      pspTopupId: topup.topupId,
      method: topup.method,
      amount: topup.amount,
      currency: topup.currency,
      payerMsisdn: null,
      returnUrl: null,
      notificationUrl: 'https://notifications.invalid/psp',
    },
    {
      adapter: null,
      notification: { current: Secret.of('x'), previous: null, previousValidUntil: null },
    },
  );
  adapter.setStatus(topup.topupId, state, options.card ? { card: options.card } : {});
  return result.providerPaymentRef;
}
