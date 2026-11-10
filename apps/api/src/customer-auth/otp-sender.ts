// Port d'envoi du code à usage unique (SMS, WhatsApp). Le vrai fournisseur arrive avec la mission 12b ; d'ici là,
// seul le FAUX existe : il n'envoie rien, n'écrit JAMAIS le code dans les journaux, et refuse le démarrage en
// production (règle du porteur du 13/10/2026). Hors production, la route rend le code dans l'en-tête
// `X-Test-Otp-Code` tant que l'envoyeur est un faux (ADR-180, OP-N120).
import { FakeInProductionError } from '../kms/production-guard';
import type { AppConfig } from '../config/config';

export type OtpChannel = 'AUTO' | 'SMS' | 'WHATSAPP';

export interface OtpSender {
  readonly isFake?: boolean;
  send(phone: string, code: string, channel: OtpChannel): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');
export const TEST_OTP_CODE_HEADER = 'X-Test-Otp-Code';

export class FakeOtpSender implements OtpSender {
  readonly isFake = true;

  async send(): Promise<void> {
    // Rien n'est envoyé ni journalisé : le code ne sort que par l'en-tête de test de la réponse.
  }
}

export function createOtpSender(config: Pick<AppConfig, 'production'>): OtpSender {
  if (config.production) throw new FakeInProductionError(['l’envoi des codes à usage unique']);
  return new FakeOtpSender();
}
