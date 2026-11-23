// Port d'envoi du code à usage unique (SMS, WhatsApp). Le vrai fournisseur arrive avec la mission 12b ; d'ici là,
// seuls des FAUX existent (otp-providers.ts, chaîne dans otp-chain.ts) : ils n'envoient rien, n'écrit JAMAIS le code dans les journaux, et refuse le démarrage en
// production (règle du porteur du 13/10/2026). Hors production, la route rend le code dans l'en-tête
// `X-Test-Otp-Code` tant que l'envoyeur est un faux (ADR-180, OP-N120).
export type OtpChannel = 'AUTO' | 'SMS' | 'WHATSAPP';

/** Envoi d'usage « titulaire » (mission 9a, décision 14) : de quoi construire le lien de décision. */
export interface HolderLink {
  refundRequestId: string;
  otpRequestId: string;
}

/** Défi auquel l'envoi se rattache : sert aux essais notés dans `otp_channel_attempt` (jamais au code). */
export interface OtpSendContext {
  challengeId: string;
  operatorId: string;
}

export interface OtpSender {
  readonly isFake?: boolean;
  /**
   * `link` n'est présent que pour le code d'un titulaire ; `context` (WP10) désigne le défi des essais notés.
   * La connexion et les envoyeurs de test à trois arguments restent valides.
   */
  send(
    phone: string,
    code: string,
    channel: OtpChannel,
    link?: HolderLink,
    context?: OtpSendContext,
  ): Promise<void>;
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
