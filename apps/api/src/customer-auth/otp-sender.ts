// Port d'envoi du code à usage unique (SMS, WhatsApp). Le vrai fournisseur arrive avec la mission 12b ; d'ici là,
// seul le FAUX existe : il n'envoie rien, n'écrit JAMAIS le code dans les journaux, et refuse le démarrage en
// production (règle du porteur du 13/10/2026). Hors production, la route rend le code dans l'en-tête
// `X-Test-Otp-Code` tant que l'envoyeur est un faux (ADR-180, OP-N120).
import { FakeInProductionError } from '../kms/production-guard';
import type { AppConfig } from '../config/config';

export type OtpChannel = 'AUTO' | 'SMS' | 'WHATSAPP';

/** Envoi d'usage « titulaire » (mission 9a, décision 14) : de quoi construire le lien de décision. */
export interface HolderLink {
  refundRequestId: string;
  otpRequestId: string;
}

export interface OtpSender {
  readonly isFake?: boolean;
  /** `link` n'est présent que pour le code d'un titulaire ; la connexion garde la signature à trois arguments. */
  send(phone: string, code: string, channel: OtpChannel, link?: HolderLink): Promise<void>;
}

export interface SentOtp {
  phone: string;
  code: string;
  channel: OtpChannel;
  link?: HolderLink;
}

export const OTP_SENDER = Symbol('OTP_SENDER');
export const TEST_OTP_CODE_HEADER = 'X-Test-Otp-Code';

export class FakeOtpSender implements OtpSender {
  readonly isFake = true;

  private last: SentOtp | null = null;

  send(phone: string, code: string, channel: OtpChannel, link?: HolderLink): Promise<void> {
    // Rien n'est envoyé ni journalisé. Le dernier envoi reste en mémoire, lisible par les tests seulement (injection
    // du fournisseur) ; le code d'un titulaire ne sort dans AUCUNE réponse, en-têtes de test compris.
    this.last = { phone, code, channel, ...(link ? { link } : {}) };
    return Promise.resolve();
  }

  /** Dernier envoi (tests). */
  lastSent(): SentOtp | null {
    return this.last;
  }
}

export function createOtpSender(config: Pick<AppConfig, 'production'>): OtpSender {
  if (config.production) throw new FakeInProductionError(['l’envoi des codes à usage unique']);
  return new FakeOtpSender();
}
