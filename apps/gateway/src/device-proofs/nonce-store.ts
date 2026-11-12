// Rejeu des requêtes de terminal sur la passerelle (research R-21, A20) : registre local
// `edge_device_nonce` (clé `(device_id, nonce)`), PERSISTANT (un redémarrage de la passerelle ne
// rouvre pas le rejeu). Une seule source d'heure : `GatewayClock.now()`, jamais l'heure système.
//
// Écriture dans la transaction de l'appelant : une écriture (lots 20 à 23) consomme le nonce DANS
// la transaction de son opération (rejeu et effet réussissent ou échouent ensemble) ; une lecture
// le consomme dans sa propre transaction courte (`consumeAlone`).
import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { ProblemException } from './problem';

/** Tolérance d'horloge des requêtes signées (secondes), servie aussi par `getDeviceConfig`. */
export const CLOCK_TOLERANCE_SECONDS = 120;
/** Le nonce reste en table au moins 2 × tolérance + 300 s (bien au-delà de la fenêtre de `created`). */
const RETENTION_SECONDS = 2 * CLOCK_TOLERANCE_SECONDS + 300;
const PURGE_EVERY_MS = 60_000;

export type NonceOutcome = 'OK' | 'CLOCK_SKEW' | 'REPLAY';

@Injectable()
export class NonceStore {
  private lastPurgeMs = 0;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  /**
   * `created` hors de `± CLOCK_TOLERANCE_SECONDS` autour de l'heure de la passerelle : `CLOCK_SKEW`
   * (rien n'est écrit). Nonce déjà vu pour ce terminal : `REPLAY`. Sinon il est enregistré.
   */
  async consume(
    tx: TxClient,
    deviceId: string,
    nonce: Buffer | string,
    created: Date | null,
  ): Promise<NonceOutcome> {
    const now = this.clock.now();
    if (created !== null) {
      const skewMs = Math.abs(now.getTime() - created.getTime());
      if (skewMs > CLOCK_TOLERANCE_SECONDS * 1000) return 'CLOCK_SKEW';
    }
    const key = typeof nonce === 'string' ? nonce : nonce.toString('base64url');
    const expires = new Date(now.getTime() + RETENTION_SECONDS * 1000);
    const { rowCount } = await tx.query(
      `INSERT INTO edge_device_nonce (device_id, nonce, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (device_id, nonce) DO NOTHING`,
      [deviceId, key, expires],
    );
    if (rowCount === 0) return 'REPLAY';
    if (now.getTime() - this.lastPurgeMs >= PURGE_EVERY_MS) {
      this.lastPurgeMs = now.getTime();
      await tx.query('DELETE FROM edge_device_nonce WHERE expires_at < $1', [now]);
    }
    return 'OK';
  }

  /**
   * Pour une écriture (lots 20 à 23), dans SA transaction : `created` hors tolérance -> `400
   * CLOCK_SKEW_TOO_LARGE` avec l'heure de la passerelle en `Date` ; nonce déjà vu -> `401
   * DEVICE_SIGNATURE_INVALID`. Une seule consommation par requête.
   */
  async consumeOrThrow(
    tx: TxClient,
    deviceId: string,
    proof: { nonce: Buffer; created: Date; consumed: boolean },
  ): Promise<void> {
    if (proof.consumed) return;
    const outcome = await this.consume(tx, deviceId, proof.nonce, proof.created);
    if (outcome === 'CLOCK_SKEW')
      throw new ProblemException('CLOCK_SKEW_TOO_LARGE', {
        headers: { Date: this.clock.now().toUTCString() },
      });
    if (outcome === 'REPLAY') throw new ProblemException('DEVICE_SIGNATURE_INVALID');
    proof.consumed = true;
  }

  /** Lecture : le nonce est consommé dans sa propre transaction courte. */
  consumeAlone(deviceId: string, nonce: Buffer | string, created: Date | null): Promise<NonceOutcome> {
    return this.gatewayTx.run((tx) => this.consume(tx, deviceId, nonce, created));
  }
}
