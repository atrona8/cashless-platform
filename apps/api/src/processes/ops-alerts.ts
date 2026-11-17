// Alertes d'exploitation du processus `maintenance` (mission 9b, WP12 ; FR-020, FR-021, C-010 ; research R-12).
// Une alerte = une ligne d'audit `OPS_ALERT` de la plateforme + `pg_notify('ops_alert', …)` (fonction `ops_raise_alert`,
// WP05) + un journal structuré `{ "level": "ALERT", "code": … }`. DÉCISION DU PORTEUR (C-010) : aucun envoi à une
// personne tant que la mission 12b n'a pas câblé un notificateur réel ; l'écart est consigné par WP14 (OP, ADR). Le
// journal est écrit AVANT l'appel à la base : une panne de la base ne fait jamais taire l'alerte, et `raise` ne lève
// jamais (le code d'alarme du travailleur reste posé par l'appelant).
// Le détail ne porte ni secret, ni numéro, ni IBAN, ni texte de requête : seulement des identifiants, des compteurs,
// des durées. `scrubDetail` retire en plus toute clé interdite (la fonction SQL refuserait sinon l'alerte entière).
import { Injectable, Logger, Module } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';

/** Codes d'alarme du processus `maintenance` (interfaces.md ; 5 et 6 sont pris par d'autres travailleurs). */
export const ALARM_SEAL_FAILED = 7;
export const ALARM_INTEGRITY = 8;
export const ALARM_LEDGER_CONTROLS = 9;
export const ALARM_OPS_CONTROLS = 10;
export const ALARM_LONG_TRANSACTION = 11;

/** Clés refusées par `ops_raise_alert` (à toute profondeur, casse ignorée). */
const FORBIDDEN_KEYS = new Set(['query', 'iban', 'msisdn', 'phone', 'token', 'secret']);
/** Taille maximale du détail, comme la fonction SQL (4 ko). */
const MAX_DETAIL_BYTES = 4096;
/** Une alerte qui dure est répétée au plus toutes les heures (journal et audit ne sont pas inondés). */
export const ALERT_REMINDER_MS = 3_600_000;
/** Alertes par passage et par contrôle ; au-delà, une alerte de synthèse. */
export const MAX_ALERTS_PER_RUN = 20;

export type AlertDetail = Record<string, unknown>;

export interface AlertItem {
  /** Clé stable de l'écart : le même écart n'est pas relevé à chaque passage. */
  key: string;
  detail: AlertDetail;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === 'object') {
    const out: AlertDetail = {};
    for (const [key, inner] of Object.entries(value))
      if (!FORBIDDEN_KEYS.has(key.toLowerCase())) out[key] = scrub(inner);
    return out;
  }
  return value;
}

/** Détail sans clé interdite et de 4 ko au plus (sinon, un résumé qui garde seulement le fait de la troncature). */
export function scrubDetail(detail: AlertDetail): AlertDetail {
  const clean = scrub(detail) as AlertDetail;
  return Buffer.byteLength(JSON.stringify(clean)) > MAX_DETAIL_BYTES
    ? { truncated: true, worker: clean.worker ?? null }
    : clean;
}

/** Code d'erreur sans texte : jamais le message d'une erreur (il peut citer une valeur ou une requête). */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'UNKNOWN';
}

@Injectable()
export class OpsAlerts {
  private readonly log = new Logger(OpsAlerts.name);
  private readonly seen = new Map<string, Map<string, number>>();

  constructor(private readonly tx: TenantTx) {}

  /** Lève une alerte : journal `ALERT`, puis audit et notification. Ne lève jamais. */
  async raise(code: number, detail: AlertDetail): Promise<void> {
    const safe = scrubDetail(detail);
    this.log.error(JSON.stringify({ level: 'ALERT', code, ...safe }));
    try {
      await this.tx.withoutTenant(async (client) => {
        await client.query('SELECT ops_raise_alert($1::int, $2::jsonb)', [
          code,
          JSON.stringify(safe),
        ]);
      });
    } catch (error) {
      this.log.error(
        JSON.stringify({
          level: 'ALERT',
          event: 'OPS_ALERT_WRITE_FAILED',
          code,
          error: errorCode(error),
        }),
      );
    }
  }

  /**
   * Alerte par écart, sans répétition : un écart déjà relevé n'est relevé de nouveau qu'après `ALERT_REMINDER_MS` ; un
   * écart disparu est oublié (s'il revient, il est relevé). Au plus `MAX_ALERTS_PER_RUN` alertes, puis une synthèse.
   * `scope` : nom du contrôle. Rend le nombre d'alertes levées.
   */
  async sync(
    scope: string,
    code: number,
    items: AlertItem[],
    now: number = Date.now(),
  ): Promise<number> {
    const known = this.seen.get(scope) ?? new Map<string, number>();
    const next = new Map<string, number>();
    const due: AlertItem[] = [];
    for (const item of items) {
      const last = known.get(item.key);
      if (last === undefined || now - last >= ALERT_REMINDER_MS) {
        due.push(item);
        next.set(item.key, now);
      } else next.set(item.key, last);
    }
    this.seen.set(scope, next);
    for (const item of due.slice(0, MAX_ALERTS_PER_RUN)) await this.raise(code, item.detail);
    if (due.length > MAX_ALERTS_PER_RUN)
      await this.raise(code, {
        worker: scope,
        overflow: due.length - MAX_ALERTS_PER_RUN,
        total: items.length,
      });
    return due.length;
  }
}

@Module({ providers: [OpsAlerts], exports: [OpsAlerts] })
export class OpsAlertsModule {}
