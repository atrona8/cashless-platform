// Fournisseurs d'envoi du code (WhatsApp, SMS principal, SMS de repli) : port `OtpProvider`, trois FAUX réglables et
// leurs fabriques. Le vrai fournisseur arrive avec la mission 12b ; chaque faux refuse le démarrage en production
// (règle du porteur du 13/10/2026, CLAUDE.md règle 2) sous son propre libellé, lu par la garde de `bootstrap.ts`.
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import type { HolderLink } from './otp-sender';

export const OTP_WHATSAPP_PROVIDER = Symbol('OTP_WHATSAPP_PROVIDER');
export const OTP_SMS_PRIMARY_PROVIDER = Symbol('OTP_SMS_PRIMARY_PROVIDER');
export const OTP_SMS_FALLBACK_PROVIDER = Symbol('OTP_SMS_FALLBACK_PROVIDER');

/** Libellés de refus : apostrophe typographique (la garde de `production-refusals.spec.ts` lit `'([^']+)'`). */
export const WHATSAPP_FAKE_LABEL = 'l’envoi des codes par WhatsApp';
export const SMS_PRIMARY_FAKE_LABEL = 'l’envoi des codes par SMS (principal)';
export const SMS_FALLBACK_FAKE_LABEL = 'l’envoi des codes par SMS (repli)';

export interface OtpSendResult {
  accepted: boolean;
  /** Le numéro n'a pas WhatsApp : la chaîne passe aussitôt au SMS principal. */
  noWhatsApp?: boolean;
  /** Référence rendue au fournisseur pour corréler l'accusé de réception. */
  deliveryRef?: string;
}

export interface OtpProvider {
  readonly name: string;
  readonly isFake?: boolean;
  send(phone: string, code: string, link?: HolderLink): Promise<OtpSendResult>;
  /** Un seul abonné attendu (la chaîne) ; l'écouteur reçoit la référence d'envoi accusée. */
  onDelivery(listener: (deliveryRef: string) => void): void;
}

export type FakeBehavior = 'CONFIRMS' | 'SILENT' | 'REFUSES' | 'THROWS' | 'NO_WHATSAPP';

export interface FakeReceived {
  phone: string;
  code: string;
  link?: HolderLink;
}

/** Faux réglable. Défaut `CONFIRMS` : en développement, aucune minuterie ne court. */
abstract class FakeProvider implements OtpProvider {
  readonly isFake = true;
  abstract readonly name: string;
  behavior: FakeBehavior = 'CONFIRMS';

  private readonly listeners: Array<(deliveryRef: string) => void> = [];
  private readonly received: FakeReceived[] = [];

  send(phone: string, code: string, link?: HolderLink): Promise<OtpSendResult> {
    // Les envois reçus ne servent qu'aux tests ; rien n'est journalisé.
    this.received.push({ phone, code, ...(link ? { link } : {}) });
    if (this.behavior === 'THROWS') return Promise.reject(new Error('fournisseur en panne'));
    if (this.behavior === 'REFUSES') return Promise.resolve({ accepted: false });
    if (this.behavior === 'NO_WHATSAPP')
      return Promise.resolve({ accepted: false, noWhatsApp: true });
    const deliveryRef = randomUUID();
    // L'accusé peut arriver avant que `send` soit exploitée par l'appelant : la chaîne le tolère.
    if (this.behavior === 'CONFIRMS') void Promise.resolve().then(() => this.confirm(deliveryRef));
    return Promise.resolve({ accepted: true, deliveryRef });
  }

  onDelivery(listener: (deliveryRef: string) => void): void {
    this.listeners.push(listener);
  }

  /** Accusé (éventuellement tardif) d'un envoi précédent. */
  confirm(deliveryRef: string): void {
    for (const listener of this.listeners) listener(deliveryRef);
  }

  /** Envois reçus (tests seulement). */
  sent(): FakeReceived[] {
    return this.received;
  }
}

export class FakeWhatsAppProvider extends FakeProvider {
  readonly name = 'whatsapp-fake';
}
export class FakeSmsPrimaryProvider extends FakeProvider {
  readonly name = 'sms-primary-fake';
}
export class FakeSmsFallbackProvider extends FakeProvider {
  readonly name = 'sms-fallback-fake';
}

type ProductionFlag = Pick<AppConfig, 'production'>;

export function createWhatsAppProvider(config: ProductionFlag): OtpProvider {
  if (config.production) throw new FakeInProductionError([WHATSAPP_FAKE_LABEL]);
  return new FakeWhatsAppProvider();
}

export function createSmsPrimaryProvider(config: ProductionFlag): OtpProvider {
  if (config.production) throw new FakeInProductionError([SMS_PRIMARY_FAKE_LABEL]);
  return new FakeSmsPrimaryProvider();
}

export function createSmsFallbackProvider(config: ProductionFlag): OtpProvider {
  if (config.production) throw new FakeInProductionError([SMS_FALLBACK_FAKE_LABEL]);
  return new FakeSmsFallbackProvider();
}
