// Sous-clés de l'authentification des festivaliers : une seule clé de configuration (`CUSTOMER_AUTH_HMAC_KEY`), dont
// on tire par HMAC une clé par usage, avec une étiquette propre. Une empreinte de code, une référence d'adresse et
// une signature de jeton ne peuvent donc jamais se substituer l'une à l'autre.
import { createHmac } from 'node:crypto';

const LABELS = {
  /** Signature des jetons d'accès (HS256). */
  accessToken: 'cashless/customer-auth/access-token/v1',
  /** Empreinte des codes à usage unique. */
  otpCode: 'cashless/customer-auth/otp-code/v1',
  /** Référence de l'adresse appelante (jamais l'adresse en clair en base). */
  clientRef: 'cashless/customer-auth/client-ref/v1',
} as const;

export type CustomerKeyPurpose = keyof typeof LABELS;

export function deriveCustomerKey(master: Buffer, purpose: CustomerKeyPurpose): Buffer {
  return createHmac('sha256', master).update(LABELS[purpose], 'utf8').digest();
}
