// Jeu d'essai des notifications de PSP (mission 6, lot WP12, T064) : s'appuie sur le monde des recharges PSP de
// WP11 (importé, jamais copié) et ajoute l'envoi HTTPS réel d'une notification signée par le faux signeur de WP07.
import { randomUUID } from 'node:crypto';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WorkerRegistry } from '../../../src/processes/worker';
import { PspPollerProcessModule } from '../../../src/processes/psp-poller.module';
import type { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../../src/psp/psp.tokens';
import { PspEventPurgeWorker } from '../../../src/topups/poller/psp-event-purge.worker';
import { PspEventRetryWorker } from '../../../src/topups/poller/psp-event-retry.worker';
import { PspTopupPollerWorker } from '../../../src/topups/poller/psp-topup-poller.worker';
import { APP_URL } from '../../support/db';
import {
  fakeEvents,
  signFakeNotification,
  type FakeEvent,
} from '../../../src/psp/fake/fake-notification-signer';
import type { NormalizedNotification, PspProviderName } from '../../../src/psp/psp.types';
import { encodeNormalized } from '../../../src/webhooks/normalized-codec';
import { withOwner } from '../../support/db';
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
      merchantReference:
        over.merchantReference === undefined ? topup.topupId : over.merchantReference,
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

// ----- Processus `psp-poller` (vrai module racine, vrai rôle de base, faux PSP et faux coffre du monde) -----

export interface PollerProcess {
  app: INestApplicationContext;
  workers: WorkerRegistry;
  poller: PspTopupPollerWorker;
  retry: PspEventRetryWorker;
  purge: PspEventPurgeWorker;
  close(): Promise<void>;
}

/**
 * Démarre `PspPollerProcessModule` comme `runWorkers` (contexte sans route). Les faux sont ceux du monde de test :
 * l'état de paiement posé sur le faux adaptateur est celui que le travailleur interroge.
 */
export async function startPoller(
  w: WebhookWorld,
  options: { registry?: PspAdapterRegistry; store?: unknown } = {},
): Promise<PollerProcess> {
  process.env.DATABASE_URL_APP = APP_URL;
  const builder = Test.createTestingModule({ imports: [PspPollerProcessModule] })
    .overrideProvider(PSP_ADAPTERS)
    .useValue(options.registry ?? w.p.registry)
    .overrideProvider(PSP_SECRET_STORE)
    .useValue(options.store ?? w.p.store);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return {
    app,
    workers: app.get(WorkerRegistry, { strict: false }),
    poller: app.get(PspTopupPollerWorker, { strict: false }),
    retry: app.get(PspEventRetryWorker, { strict: false }),
    purge: app.get(PspEventPurgeWorker, { strict: false }),
    close: () => app.close(),
  };
}

// ----- Amorçage, journaux -----

/** Recharge `PENDING` d'identifiant CHOISI (notification reçue avant la recharge : A2). */
export async function topupWithId(
  w: WebhookWorld,
  topupId: string,
  method: Method = 'WAVE',
  amount = 10000,
): Promise<PspTopupRow> {
  const wallet = await w.p.wallet();
  await w.p.tx.run(w.p.op, (client) =>
    client.query('SELECT * FROM create_psp_topup($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      topupId,
      wallet.walletId,
      method,
      String(amount),
      'CUSTOMER',
      null,
      null,
      wallet.customer.customerId,
      new Date(Date.now() + 3_600_000),
    ]),
  );
  return (await w.p.read(topupId))!;
}

/**
 * Événement inséré par le propriétaire (amorçage : âge, essais et état que la réception ne produit pas seule). La
 * notification est celle que `normalized` porte ; le corps brut est absent ou fourni.
 */
export async function insertEvent(input: {
  configId: string;
  operatorId: string;
  notification: NormalizedNotification;
  status?: 'RECEIVED' | 'UNMATCHED' | 'RETRY';
  attempts?: number;
  ageHours?: number;
  ageDays?: number;
  body?: Buffer | null;
}): Promise<string> {
  const rows = await ownerRows<{ id: string }>(
    `INSERT INTO psp_event (operator_id, psp_configuration_id, provider_event_id, received_at, body,
                            kind, status, attempts, normalized)
     VALUES ($1, $2, $3, clock_timestamp() - make_interval(hours => $4::int, days => $5::int), $6,
             $7, $8, $9, $10::jsonb)
     RETURNING psp_event_id AS id`,
    [
      input.operatorId,
      input.configId,
      input.notification.notificationId,
      input.ageHours ?? 0,
      input.ageDays ?? 0,
      input.body ?? null,
      input.notification.kind,
      input.status ?? 'RECEIVED',
      input.attempts ?? 0,
      JSON.stringify(encodeNormalized(input.notification)),
    ],
  );
  return rows[0]!.id;
}

export interface CapturedLogs {
  lines: string[];
  text(): string;
  restore(): void;
}

/** Capte tout ce que les journaux (Logger de Nest, sortie standard, sortie d'erreur) écrivent. */
export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(((message: unknown) => {
      lines.push(typeof message === 'string' ? message : JSON.stringify(message));
    }) as never),
  );
  const record = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  spies.push(
    jest.spyOn(process.stdout, 'write').mockImplementation(record as never) as never,
    jest.spyOn(process.stderr, 'write').mockImplementation(record as never) as never,
  );
  return {
    lines,
    text: () => lines.join('\n'),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

/**
 * Vieillit une recharge (amorçage par le propriétaire : `created_at` est une colonne d'identité, que le déclencheur
 * de l'automate refuse de modifier ; seul `session_replication_role` le contourne, pour cette connexion).
 */
export function ageTopup(
  topupId: string,
  options: { minutes?: number; expired?: boolean } = {},
): Promise<void> {
  return withOwner(async (db) => {
    await db.query('SET session_replication_role = replica');
    await db.query(
      `UPDATE psp_topup
          SET created_at = clock_timestamp() - make_interval(mins => $2::int),
              expires_at = CASE WHEN $3::boolean THEN clock_timestamp() - interval '1 minute'
                                ELSE expires_at END
        WHERE psp_topup_id = $1`,
      [topupId, options.minutes ?? 5, options.expired ?? false],
    );
  });
}

/**
 * La base de test est partagée entre les passages : ferme les événements laissés par d'autres suites, pour que les
 * codes d'alerte et les reprises ne dépendent que de ce qu'une suite crée elle-même.
 */
export function closeBacklog(): Promise<unknown[]> {
  return ownerRows(
    `UPDATE psp_event SET status = 'PROCESSED', outcome = 'NO_EFFECT', processed_at = clock_timestamp()
      WHERE status <> 'PROCESSED'`,
  );
}

/** Annule les recharges encore `PENDING` (restes d'un test précédent) pour qu'aucune ne soit interrogée. */
export function closePending(): Promise<unknown[]> {
  return ownerRows(
    `UPDATE psp_topup SET status = 'CANCELLED', failure_reason = 'CANCELLED' WHERE status = 'PENDING'`,
  );
}
