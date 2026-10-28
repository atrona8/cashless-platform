// Reprise des notifications conservées (mission 6, lot WP12, T062 point 4 ; A2, A4, A22) : `RECEIVED` de plus d'une
// minute, `RETRY`, et `UNMATCHED` (24 h de fenêtre, puis écart `PSP_MISMATCH`, jamais avant). Même code de
// traitement que la réception (EventDispatcher). Un événement `RETRY` à plus de 5 essais n'est plus repris
// automatiquement : code d'alerte 3. Le grand âge se juge à l'horloge de la base (jamais celle de Node).
import { Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { EventDispatcher } from '../../webhooks/event-dispatcher';
import { decodeNormalized } from '../../webhooks/normalized-codec';
import { logPspAlert } from '../../webhooks/psp-alert-log';
import { ALARM_EVENT_RETRY_EXHAUSTED } from './poller-alarms';

/** Événements lus par passage (borne de `psp_events_to_retry` : 500). */
export const EVENT_RETRY_BATCH = 200;

interface RetryRow {
  psp_event_id: string;
  operator_id: string;
  psp_configuration_id: string;
  kind: string;
  status: string;
  attempts: number;
  received_at: Date;
  normalized: unknown;
  exhausted: boolean;
  past_window: boolean;
}

@Injectable()
export class PspEventRetryWorker implements ProcessWorker {
  readonly name = 'psp-event-retry';
  private readonly log = new Logger(PspEventRetryWorker.name);
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly dispatcher: EventDispatcher,
  ) {
    registry.register(this);
  }

  private rows(): Promise<RetryRow[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<RetryRow>(
        `SELECT e.*, (e.received_at < clock_timestamp() - interval '24 hours') AS past_window
           FROM psp_events_to_retry($1) e`,
        [EVENT_RETRY_BATCH],
      );
      return rows;
    });
  }

  /** Rend le nombre d'événements menés à `PROCESSED` (les autres ne comptent pas : le drain s'arrête). */
  async runOnce(): Promise<number> {
    let done = 0;
    for (const row of await this.rows()) {
      if (row.exhausted) {
        this.alarmCode = ALARM_EVENT_RETRY_EXHAUSTED;
        logPspAlert(this.log, {
          event: 'psp.event.retry_exhausted',
          severity: 'ERROR',
          reason: 'RETRY_EXHAUSTED',
          psp_event_id: row.psp_event_id,
          psp_config_id: row.psp_configuration_id,
          attempts: row.attempts,
        });
        continue;
      }
      const event = {
        pspEventId: row.psp_event_id,
        operatorId: row.operator_id,
        configurationId: row.psp_configuration_id,
        receivedAt: row.received_at,
      };
      const notification = decodeNormalized(row.normalized);
      if (notification === null) {
        await this.dispatcher.markRetry(event, new Error('notification normalisée illisible'));
        continue;
      }
      const result = await this.dispatcher.apply(event, notification, {
        expireUnmatched: row.status === 'UNMATCHED' && row.past_window,
      });
      if (result === 'PROCESSED') done += 1;
    }
    return done;
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    return (await this.rows()).map(
      (row) =>
        `${this.name} : événement ${row.psp_event_id} (${row.kind}, ${row.status}, ` +
        `${row.attempts} essai(s)${row.exhausted ? ', abandonné' : ''})`,
    );
  }
}
