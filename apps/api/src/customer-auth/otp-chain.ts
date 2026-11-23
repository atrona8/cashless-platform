// Chaîne d'envoi du code (mission serveur-app-festivalier, WP10 ; FR-011 à FR-013, NFR-001, NFR-002, ADR-66) :
// WhatsApp, puis SMS principal (sans accusé à `whatsappTimeoutMs`, ou numéro sans WhatsApp), puis SMS de repli (sans
// accusé à `smsPrimaryTimeoutMs`). Le MÊME code part à chaque étape.
//
// Le code n'existe qu'en MÉMOIRE DU PROCESSUS, par défi : effacé à la confirmation, dès le dernier envoi, au
// remplacement par une nouvelle demande, au plafond dur `OTP_CODE_HARD_CAP_MS` ou à `close()`. Jamais en base, dans un
// journal, un audit, une réponse ni un message d'erreur : une erreur de fournisseur est notée par le nom du
// fournisseur et une raison fermée, rien de plus. Redémarrage pendant la chaîne : la bascule est perdue.
import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import type { OtpProvider } from './otp-providers';
import type { HolderLink, OtpChannel, OtpSender, OtpSendContext, SentOtp } from './otp-sender';

/** Plafond dur de la vie d'un code en mémoire (somme des délais maximaux : 15 s + 20 s). */
export const OTP_CODE_HARD_CAP_MS = 35_000;
/** Nombre maximal de défis suivis en même temps ; le suivant efface le plus ancien. */
export const OTP_CHAIN_MAX_ENTRIES = 1_000;

export type AttemptChannel = 'WHATSAPP' | 'SMS_PRIMARY' | 'SMS_FALLBACK';
const CHANNELS: readonly AttemptChannel[] = ['WHATSAPP', 'SMS_PRIMARY', 'SMS_FALLBACK'];
const LAST_STEP = 2;

/** Journal des essais (`otp_channel_attempt`) : jamais le code, une empreinte ni un numéro. */
export interface AttemptRecorder {
  start(ctx: OtpSendContext, channel: AttemptChannel, provider: string): Promise<string | null>;
  confirm(id: string): Promise<void>;
  fail(id: string, reason: string): Promise<void>;
}

export interface ChainedOtpSenderOptions {
  whatsapp: OtpProvider;
  smsPrimary: OtpProvider;
  smsFallback: OtpProvider;
  whatsappTimeoutMs: number;
  smsPrimaryTimeoutMs: number;
  recorder: AttemptRecorder;
  now?: () => number;
}

interface Entry {
  key: string;
  code: string;
  phone: string;
  link: HolderLink | undefined;
  context: OtpSendContext | undefined;
  step: number;
  /** Heure à laquelle la minuterie de l'étape suivante doit partir, `null` si aucune n'est armée. */
  stageDueAt: number | null;
  timers: Set<NodeJS.Timeout>;
  /** Dernier essai noté : les essais d'un défi s'écrivent dans l'ordre des étapes. */
  lastStart: Promise<string | null>;
  closed: boolean;
}

interface TrackedAttempt {
  attempt: Promise<string | null>;
  entry: Entry;
  step: number;
}

class SendTimeout extends Error {}

@Injectable()
export class ChainedOtpSender implements OtpSender, OnModuleDestroy {
  readonly isFake: boolean;

  private readonly providers: readonly OtpProvider[];
  private readonly entries = new Map<string, Entry>();
  /** Envois acceptés en attente d'accusé (sans code) : `étape:référence` ; bornée comme `entries`. */
  private readonly attempts = new Map<string, TrackedAttempt>();
  /** Accusés arrivés avant que `send` ait rendu sa référence. */
  private readonly earlyAcks = new Set<string>();
  private readonly now: () => number;
  private last: SentOtp | null = null;
  private closed = false;

  constructor(private readonly options: ChainedOtpSenderOptions) {
    this.providers = [options.whatsapp, options.smsPrimary, options.smsFallback];
    this.isFake = this.providers.some((provider) => provider.isFake === true);
    this.now = options.now ?? Date.now;
    this.providers.forEach((provider, step) => provider.onDelivery((ref) => this.onAck(step, ref)));
  }

  async send(
    phone: string,
    code: string,
    channel: OtpChannel,
    link?: HolderLink,
    context?: OtpSendContext,
  ): Promise<void> {
    if (this.closed) throw new Error('chaîne d’envoi fermée');
    const key = context?.challengeId ?? phone;
    const previous = this.entries.get(key);
    if (previous) this.erase(previous);
    while (this.entries.size >= OTP_CHAIN_MAX_ENTRIES) {
      const oldest = this.entries.values().next().value as Entry;
      this.erase(oldest);
    }
    const entry: Entry = {
      key,
      code,
      phone,
      link,
      context,
      step: 0,
      stageDueAt: null,
      timers: new Set(),
      lastStart: Promise.resolve(null),
      closed: false,
    };
    this.entries.set(key, entry);
    this.arm(entry, OTP_CODE_HARD_CAP_MS, () => this.onHardCap(entry));
    // Faux seulement : le dernier envoi reste lisible par les tests (jamais en production : le faux la refuse).
    this.last = this.isFake ? { phone, code, channel, ...(link ? { link } : {}) } : null;
    // Retourne dès le premier envoi rendu : la suite se déroule par minuteries.
    await this.runFrom(entry, channel === 'SMS' ? 1 : 0);
  }

  /** Dernier envoi, seulement si l'un des fournisseurs est un faux (tests). */
  lastSent(): SentOtp | null {
    return this.isFake ? this.last : null;
  }

  /** Défis dont le code est encore en mémoire (tests). */
  inFlightCount(): number {
    return this.entries.size;
  }

  /** Arrêt : minuteries annulées, codes effacés, envois suivants refusés. */
  close(): void {
    this.closed = true;
    for (const entry of [...this.entries.values()]) this.erase(entry);
    this.attempts.clear();
    this.earlyAcks.clear();
    this.last = null;
  }

  onModuleDestroy(): void {
    this.close();
  }

  // ----- Déroulement -------------------------------------------------------------------------------------------

  private async runFrom(entry: Entry, from: number): Promise<void> {
    for (let step = from; step <= LAST_STEP; step++) {
      if (entry.closed) return;
      entry.step = step;
      const outcome = await this.attemptStep(entry, step);
      if (entry.closed || outcome === 'CONFIRMED') return;
      if (outcome === 'SENT') {
        if (step === LAST_STEP) this.erase(entry);
        else this.armStage(entry, step);
        return;
      }
    }
    this.erase(entry); // tous ont échoué : aucune erreur rendue, le défi reste valide
  }

  private async attemptStep(entry: Entry, step: number): Promise<'SENT' | 'CONFIRMED' | 'FAILED'> {
    const provider = this.providers[step]!;
    const code = entry.code;
    // Dernier envoi : le code n'est plus nécessaire en mémoire (35 s au plus de toute façon).
    if (step === LAST_STEP) entry.code = '';
    const attempt = this.startAttempt(entry, step, provider.name);
    const timeoutMs =
      step === 0 ? this.options.whatsappTimeoutMs : this.options.smsPrimaryTimeoutMs;
    let result;
    try {
      result = await this.withTimeout(
        entry,
        (async () => provider.send(entry.phone, code, entry.link))(),
        timeoutMs,
      );
    } catch (error) {
      this.failAttempt(attempt, error instanceof SendTimeout ? 'TIMEOUT' : 'ERROR');
      return 'FAILED';
    }
    if (!result.accepted) {
      this.failAttempt(attempt, result.noWhatsApp ? 'NO_WHATSAPP' : 'REFUSED');
      return 'FAILED';
    }
    if (result.deliveryRef !== undefined) {
      const ackKey = `${step}:${result.deliveryRef}`;
      this.track(ackKey, { attempt, entry, step });
      if (this.earlyAcks.delete(ackKey)) {
        this.acknowledge(ackKey);
        return 'CONFIRMED';
      }
    }
    return 'SENT';
  }

  private armStage(entry: Entry, step: number): void {
    const delay = step === 0 ? this.options.whatsappTimeoutMs : this.options.smsPrimaryTimeoutMs;
    entry.stageDueAt = this.now() + delay;
    this.arm(entry, delay, () => {
      entry.stageDueAt = null;
      if (entry.closed) return;
      this.runFrom(entry, step + 1).catch(() => this.erase(entry));
    });
  }

  /** Plafond dur : efface le code, sauf si le dernier envoi est dû à cet instant (il efface lui-même). */
  private onHardCap(entry: Entry): void {
    if (entry.closed) return;
    if (entry.stageDueAt !== null && entry.stageDueAt <= this.now()) return;
    this.erase(entry);
  }

  // ----- Accusés -----------------------------------------------------------------------------------------------

  private onAck(step: number, ref: string): void {
    if (this.closed) return;
    const ackKey = `${step}:${ref}`;
    if (this.attempts.has(ackKey)) this.acknowledge(ackKey);
    else {
      this.earlyAcks.add(ackKey);
      while (this.earlyAcks.size > OTP_CHAIN_MAX_ENTRIES)
        this.earlyAcks.delete(this.earlyAcks.values().next().value as string);
    }
  }

  /** Note la confirmation ; l'étape courante arrête la chaîne, une étape passée ne relance rien. */
  private acknowledge(ackKey: string): void {
    const tracked = this.attempts.get(ackKey);
    if (!tracked) return;
    this.attempts.delete(ackKey);
    this.confirmAttempt(tracked.attempt);
    if (!tracked.entry.closed && tracked.entry.step === tracked.step) this.erase(tracked.entry);
  }

  private track(ackKey: string, tracked: TrackedAttempt): void {
    this.attempts.set(ackKey, tracked);
    while (this.attempts.size > OTP_CHAIN_MAX_ENTRIES)
      this.attempts.delete(this.attempts.keys().next().value as string);
  }

  // ----- Mémoire et minuteries ---------------------------------------------------------------------------------

  /** Efface le code et annule les minuteries du défi. */
  private erase(entry: Entry): void {
    entry.code = '';
    entry.closed = true;
    for (const timer of entry.timers) clearTimeout(timer);
    entry.timers.clear();
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  private arm(entry: Entry, delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      entry.timers.delete(timer);
      fn();
    }, delayMs);
    timer.unref();
    entry.timers.add(timer);
  }

  private withTimeout<T>(entry: Entry, work: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.timers.delete(timer);
        reject(new SendTimeout());
      }, timeoutMs);
      timer.unref();
      entry.timers.add(timer);
      const done = () => {
        clearTimeout(timer);
        entry.timers.delete(timer);
      };
      work.then(
        (value) => {
          done();
          resolve(value);
        },
        (error: unknown) => {
          done();
          reject(error);
        },
      );
    });
  }

  // ----- Journal des essais (erreurs avalées, jamais de code) ----------------------------------------------------

  private startAttempt(entry: Entry, step: number, provider: string): Promise<string | null> {
    const context = entry.context;
    if (!context || this.closed) return Promise.resolve(null);
    const started = entry.lastStart
      .then(() => this.options.recorder.start(context, CHANNELS[step]!, provider))
      .catch(() => null);
    entry.lastStart = started;
    return started;
  }

  private confirmAttempt(attempt: Promise<string | null>): void {
    void attempt
      .then((id) => (id === null || this.closed ? undefined : this.options.recorder.confirm(id)))
      .catch(() => undefined);
  }

  private failAttempt(attempt: Promise<string | null>, reason: string): void {
    void attempt
      .then((id) =>
        id === null || this.closed ? undefined : this.options.recorder.fail(id, reason),
      )
      .catch(() => undefined);
  }
}

/** Journal des essais en base : `TenantTx.run(operatorId, …)`, seules colonnes modifiables confirmed_at/failed_reason. */
@Injectable()
export class TenantAttemptRecorder implements AttemptRecorder {
  /** Prestataire de chaque essai noté, pour la mise à jour qui suit (aucune donnée sensible). */
  private readonly operators = new Map<string, string>();

  constructor(private readonly tx: TenantTx) {}

  async start(ctx: OtpSendContext, channel: AttemptChannel, provider: string): Promise<string> {
    const id = randomUUID();
    await this.tx.run(ctx.operatorId, (client) =>
      client.query(
        `INSERT INTO otp_channel_attempt (id, operator_id, challenge_id, channel, provider, sent_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
        [id, ctx.operatorId, ctx.challengeId, channel, provider],
      ),
    );
    this.operators.set(id, ctx.operatorId);
    if (this.operators.size > OTP_CHAIN_MAX_ENTRIES * 3)
      this.operators.delete(this.operators.keys().next().value as string);
    return id;
  }

  async confirm(id: string): Promise<void> {
    await this.update(
      id,
      'UPDATE otp_channel_attempt SET confirmed_at = clock_timestamp() WHERE id = $1',
      [id],
    );
  }

  async fail(id: string, reason: string): Promise<void> {
    await this.update(id, 'UPDATE otp_channel_attempt SET failed_reason = $2 WHERE id = $1', [
      id,
      reason,
    ]);
  }

  private async update(id: string, sql: string, params: unknown[]): Promise<void> {
    const operatorId = this.operators.get(id);
    if (!operatorId) return;
    await this.tx.run(operatorId, (client) => client.query(sql, params));
  }
}
