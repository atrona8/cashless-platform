// Jeu d'essai des notifications de PSP (mission 6, lot WP12, T064) : s'appuie sur le monde des recharges PSP de
// WP11 (importé, jamais copié) et ajoute l'envoi HTTPS réel d'une notification signée par le faux signeur de WP07.
import { randomUUID } from 'node:crypto';
import { fakeEvents, signFakeNotification, type FakeEvent } from '../../../src/psp/fake/fake-notification-signer';
import type { PspProviderName } from '../../../src/psp/psp.types';
import { send, type TerminalResponse } from '../../support/test-terminal';
import { ownerRows } from '../../support/media-fixtures';
import type { PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import { PspWorld, type Method } from '../topups/psp-fixtures';

export const SEGMENT: Record<Method, string> = {
  WAVE: 'wave',
  ORANGE_MONEY: 'orange-money',
  CARD: 'stripe',
};
export const PROVIDER: Record<Method, PspProviderName> = {
  WAVE: 'WAVE',
  ORANGE_MONEY: 'ORANGE_MONEY',
  CARD: 'STRIPE',
};

export interface PostOptions {
  method?: Method;
  configId?: string;
  segment?: string;
  secret?: string;
  timestamp?: number;
  /** Corps réellement envoyé (différent du corps signé : test d'un octet changé). */
  sentBody?: string;
  /** En-têtes remplacés (ex. aucun en-tête de signature). */
  headers?: Record<string, string>;
  /** Sans signature du tout. */
  unsigned?: boolean;
}

export class WebhookWorld {
  constructor(readonly p: PspWorld) {}

  static async create(): Promise<WebhookWorld> {
    return new WebhookWorld(await PspWorld.create());
  }

  /** Secret courant de la configuration d'un moyen (lu dans le faux coffre par la référence). */
  async secretOf(method: Method): Promise<string> {
    const configId = this.p.configs[method];
    const [row] = await ownerRows<{ secret_ref: string }>(
      'SELECT secret_ref FROM psp_configuration WHERE psp_configuration_id = $1',
      [configId],
    );
    const secrets = await this.p.store.get({
      configurationId: configId,
      holderPartyId: this.p.holderId,
      secretRef: row!.secret_ref,
    });
    return secrets.notification.current.reveal();
  }

  event(
    topup: PspTopupRow,
    over: {
      type?: 'succeeded' | 'failed' | 'cancelled';
      id?: string;
      paymentId?: string;
      merchantReference?: string | null;
      amount?: number;
      currency?: string;
      card?: { fingerprint?: string | null; threeDs?: string | null };
    } = {},
  ): FakeEvent {
    const card =
      over.card ??
      (topup.method === 'CARD'
        ? { fingerprint: `fp-${topup.walletId.slice(0, 8)}`, threeDs: 'SUCCEEDED' }
        : undefined);
    return fakeEvents[over.type ?? 'succeeded']({
      id: over.id ?? `evt-${randomUUID()}`,
      merchantReference: over.merchantReference === undefined ? topup.topupId : over.merchantReference,
      paymentId: over.paymentId ?? `pay-${topup.topupId.slice(0, 8)}`,
      amount: over.amount ?? Number(topup.amount),
      currency: over.currency ?? topup.currency,
      ...(card ? { card } : {}),
    });
  }

  /** Signe puis POSTE une notification sur la route publique (HTTPS réel). */
  async post(event: FakeEvent, options: PostOptions = {}): Promise<TerminalResponse> {
    const method = options.method ?? 'WAVE';
    const secret = options.secret ?? (await this.secretOf(method));
    const signed = signFakeNotification({
      provider: PROVIDER[method],
      secret,
      event,
      ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    });
    const body = options.sentBody ?? signed.rawBody.toString('utf8');
    return this.raw(
      body,
      options.unsigned === true ? {} : (options.headers ?? signed.headers),
      options,
    );
  }

  raw(
    body: string,
    headers: Record<string, string>,
    options: Pick<PostOptions, 'method' | 'configId' | 'segment'> = {},
  ): Promise<TerminalResponse> {
    const method = options.method ?? 'WAVE';
    const configId = options.configId ?? this.p.configs[method];
    const segment = options.segment ?? SEGMENT[method];
    return send(
      {
        url: new URL(`${this.p.sw.api.baseUrl}/webhooks/${segment}/${configId}`),
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        cert: null,
        key: null,
      },
      this.p.sw.api.tls.serverCaPem,
    );
  }

  events(configId: string) {
    return ownerRows<{
      psp_event_id: string;
      provider_event_id: string;
      status: string;
      outcome: string | null;
      attempts: number;
      kind: string;
      psp_topup_id: string | null;
    }>(
      `SELECT psp_event_id, provider_event_id, status, outcome, attempts, kind, psp_topup_id
         FROM psp_event WHERE psp_configuration_id = $1 ORDER BY received_at, psp_event_id`,
      [configId],
    );
  }

  /** Photographie des tables qu'un refus ne doit jamais toucher. */
  async footprint(): Promise<Record<string, number>> {
    const [row] = await ownerRows<Record<string, number>>(
      `SELECT (SELECT count(*) FROM psp_event)::int AS psp_event,
              (SELECT count(*) FROM journal_transaction)::int AS journal_transaction,
              (SELECT count(*) FROM posting)::int AS posting,
              (SELECT count(*) FROM anomaly)::int AS anomaly,
              (SELECT count(*) FROM psp_topup WHERE status <> 'PENDING')::int AS topup_settled`,
    );
    return row!;
  }

  close(): Promise<void> {
    return this.p.close();
  }
}
