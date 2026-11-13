// Horloge de la passerelle (A14, research R-14, data-model.md B.1 `edge_clock`).
//
// Heure servie : au démarrage, `t0 = max(heure système, time_floor)` ; ensuite `now() = t0 + temps
// monotone écoulé
// depuis le démarrage` (`process.hrtime`), recalée sur l'heure centrale à chaque `observeCentral`.
// JAMAIS une heure
// inférieure à `time_floor` (le plus grand instant jamais servi ou observé). La valeur monotone
// n'est pas persistée.
// `time_floor` est écrit dans toute transaction qui écrit une heure (`touchFloor`), au plus une
// fois par seconde.
//
// Écarts : plus de 120 s entre l'heure système et l'heure servie : `skewAlert() = true` et ligne
// d'audit
// `CLOCK_SKEW` (une fois par passage à l'alerte). Plus de 24 h entre l'heure servie et une mesure
// centrale :
// `refusesAck() = true` (WP17 refuse alors l'accusé de bascule, état local `ARMED`, alerte) jusqu'à
// une mesure cohérente.
//
// LIMITE CONSIGNÉE (OP-N103, B.1), NON « corrigée » : une horloge système reculée pendant un ARRÊT
// de la machine fait
// perdre la durée de l'arrêt (le plafond reprend à la dernière heure observée) ; les fenêtres de 12
// h se comptent alors
// en temps de fonctionnement tant qu'aucune mesure centrale ni horloge cohérente n'est disponible.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { GatewayTx, type TxClient } from '../db/gateway-tx';

export interface GatewayClock {
  now(): Date;
  observeCentral(date: Date): Promise<void>;
  skewAlert(): boolean;
  refusesAck(): boolean;
}

export const GATEWAY_CLOCK = Symbol('GATEWAY_CLOCK');
export const CLOCK_SOURCES = Symbol('CLOCK_SOURCES');

/** Sources de temps injectables : un test n'appuie jamais l'horloge de Node sur une date posée par la base. */
export interface ClockSources {
  /** Heure système, en millisecondes depuis l'époque. */
  systemNow(): number;
  /** Horloge monotone, en nanosecondes. */
  monotonicNow(): bigint;
}

const DEFAULT_SOURCES: ClockSources = {
  systemNow: () => Date.now(),
  monotonicNow: () => process.hrtime.bigint(),
};

export const SKEW_ALERT_MS = 120_000;
export const ACK_REFUSAL_MS = 24 * 3_600_000;
/**
 * Décision 20 du porteur (09/11/2026) : une heure du central en RETARD sur l'heure servie de plus de
 * 5 minutes n'est pas adoptée. Le plafond `time_floor` ne décroît jamais : adopter un central en
 * retard de 23 h figerait l'horloge (et les ordres signés de 10 minutes resteraient valables des
 * heures). L'avance (central en avance) garde la borne de 24 h.
 */
export const CENTRAL_BEHIND_MAX_MS = 5 * 60_000;
export const TOKEN_TOLERANCE_MS = 12 * 3_600_000;
export const FLOOR_WRITE_INTERVAL_MS = 1000;

@Injectable()
export class GatewayClockService implements GatewayClock {
  private readonly sources: ClockSources;
  private baseMs = 0;
  private monoBase = 0n;
  private floorMs = 0;
  private lastFloorWriteMs = -Infinity;
  private skew = false;
  private ackRefused = false;
  private started = false;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Optional() @Inject(CLOCK_SOURCES) sources?: ClockSources,
  ) {
    this.sources = sources ?? DEFAULT_SOURCES;
  }

  /** À appeler une fois, après les migrations et avant de servir : lit le plafond et fixe `t0`. */
  async start(): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{
        floor_ms: string;
        skew_alert: boolean;
        ack_refused: boolean;
      }>(
        `SELECT (extract(epoch FROM time_floor) * 1000)::bigint AS floor_ms, skew_alert, ack_refused
           FROM edge_clock FOR UPDATE`,
      );
      const row = rows[0];
      if (!row) throw new Error('edge_clock : ligne absente (migration edge-0001 non jouée)');
      this.floorMs = Number(row.floor_ms);
      this.skew = row.skew_alert;
      this.ackRefused = row.ack_refused;
      this.baseMs = Math.max(this.sources.systemNow(), this.floorMs);
      this.monoBase = this.sources.monotonicNow();
      this.started = true;
      this.lastFloorWriteMs = -Infinity;
      const system = this.sources.systemNow();
      const served = this.now().getTime();
      // Horloge système reculée par rapport au plafond (arrêt de la machine, A14) : l'écart est
      // signalé.
      const alert = Math.abs(system - served) > SKEW_ALERT_MS;
      const newlyAlerting = alert && !this.skew;
      this.skew = alert;
      await tx.query(
        `UPDATE edge_clock SET boot_id = gen_random_uuid(), boot_system_time = $1, skew_alert = $2,
                time_floor = greatest(time_floor, $3)`,
        [new Date(system), alert, new Date(served)],
      );
      if (newlyAlerting) {
        await tx.query(
          `INSERT INTO edge_audit (kind, actor, detail) VALUES ('CLOCK_SKEW', 'gateway', $1)`,
          [JSON.stringify({ system_ms: system, served_ms: served, at: 'boot' })],
        );
      }
    });
  }

  now(): Date {
    if (!this.started) throw new Error('horloge de la passerelle non démarrée');
    const elapsedMs = Number((this.sources.monotonicNow() - this.monoBase) / 1_000_000n);
    const served = Math.max(this.baseMs + elapsedMs, this.floorMs);
    // Le plafond suit l'heure servie : l'heure ne recule jamais, même après une correction centrale
    // vers le passé.
    this.floorMs = served;
    return new Date(served);
  }

  skewAlert(): boolean {
    return this.skew;
  }

  refusesAck(): boolean {
    return this.ackRefused;
  }

  /** Millisecondes écoulées, sur l'heure servie, depuis `since` (ex. fenêtre de tolérance des jetons : 12 h). */
  elapsedMs(since: Date): number {
    return this.now().getTime() - since.getTime();
  }

  /**
   * À appeler dans toute transaction qui écrit une heure : persiste `time_floor`, au plus une fois
   * par seconde
   * (pas une écriture de plus à chaque requête).
   */
  async touchFloor(tx: TxClient): Promise<void> {
    const served = this.now().getTime();
    if (served - this.lastFloorWriteMs < FLOOR_WRITE_INTERVAL_MS) return;
    this.lastFloorWriteMs = served;
    await tx.query('UPDATE edge_clock SET time_floor = greatest(time_floor, $1)', [
      new Date(served),
    ]);
  }

  async observeCentral(date: Date): Promise<void> {
    const central = date.getTime();
    if (Number.isNaN(central)) throw new Error('observeCentral : date invalide');
    const system = this.sources.systemNow();
    const before = this.now().getTime();
    const refused = central - before > ACK_REFUSAL_MS || before - central > CENTRAL_BEHIND_MAX_MS;
    if (refused) {
      // BORNE (WP17, resserrée par la décision 20 pour le retard) : une mesure à plus de 24 h
      // d'avance, ou à plus de 5 min de retard, sur l'heure servie n'est PAS adoptée. Sans cela,
      // une date centrale très lointaine relevait `time_floor` pour toujours (le plafond ne
      // décroît jamais) et figeait l'horloge de la passerelle. L'accusé de bascule est refusé tant
      // qu'une mesure cohérente n'est pas revenue ; ni le calage, ni le plafond ne bougent.
      const first = !this.ackRefused;
      this.ackRefused = true;
      await this.gatewayTx.run(async (tx) => {
        await tx.query('UPDATE edge_clock SET ack_refused = true');
        if (first) {
          await tx.query(
            `INSERT INTO edge_audit (kind, actor, detail) VALUES ('CLOCK_CENTRAL_OUT_OF_BOUNDS', 'gateway', $1)`,
            [JSON.stringify({ central_ms: central, served_ms: before })],
          );
        }
      });
      return;
    }
    this.baseMs = central;
    this.monoBase = this.sources.monotonicNow();
    const served = this.now().getTime();
    const alert = Math.abs(system - served) > SKEW_ALERT_MS;
    const newlyAlerting = alert && !this.skew;
    this.skew = alert;
    this.ackRefused = refused;
    await this.gatewayTx.run(async (tx) => {
      await tx.query(
        `UPDATE edge_clock SET central_offset_ms = $1, skew_alert = $2, ack_refused = $3,
                time_floor = greatest(time_floor, $4)`,
        [central - system, alert, refused, new Date(served)],
      );
      this.lastFloorWriteMs = served;
      if (newlyAlerting) {
        await tx.query(
          `INSERT INTO edge_audit (kind, actor, detail) VALUES ('CLOCK_SKEW', 'gateway', $1)`,
          [JSON.stringify({ system_ms: system, served_ms: served, central_ms: central })],
        );
      }
    });
  }
}
