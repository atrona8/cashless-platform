// Rejeu des requêtes de terminal (research R-04, contracts/device-authentication.md, étape 7) :
// `consume_device_nonce` (migration 0023) dans sa propre transaction, sous le prestataire du
// terminal et le rôle du processus. Une seule source d'heure : `now()` de la base, pour la fenêtre
// comme pour la purge. Appelé seulement APRÈS la vérification du certificat, du jeton et de la
// signature : une requête non authentifiée n'écrit rien.
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

export type NonceOutcome = 'OK' | 'CLOCK_SKEW' | 'REPLAY';

/** Bornes de la base (`consume_device_nonce`) : tolérance de 1 à 300 s. */
const TOLERANCE = { min: 1, max: 300 };

@Injectable()
export class NonceStore {
  private readonly toleranceSeconds: number;

  constructor(
    private readonly tx: TenantTx,
    @Inject(APP_CONFIG) config: Pick<AppConfig, 'clockToleranceSeconds'>,
  ) {
    // 0 (permis par la configuration) ferait refuser chaque requête par la base : refus au
    // démarrage plutôt qu'une tolérance élargie en silence.
    const tolerance = config.clockToleranceSeconds;
    if (tolerance < TOLERANCE.min || tolerance > TOLERANCE.max)
      throw new Error(
        `CLOCK_TOLERANCE_SECONDS : ${TOLERANCE.min} à ${TOLERANCE.max} s exigé par les terminaux`,
      );
    this.toleranceSeconds = tolerance;
  }

  /** Résultat brut de la base (tests). */
  async outcome(
    operatorId: string,
    deviceId: string,
    nonce: Buffer,
    created: Date,
  ): Promise<NonceOutcome> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ outcome: NonceOutcome }>(
        'SELECT consume_device_nonce($1, $2, $3, $4) AS outcome',
        [deviceId, nonce, created, this.toleranceSeconds],
      );
      return rows[0]!.outcome;
    });
  }

  /**
   * Consomme le nonce. Horloge hors tolérance : `400 CLOCK_SKEW_TOO_LARGE` avec l'heure du serveur
   * en `Date` (le terminal se recale) ; nonce déjà vu : `401 DEVICE_SIGNATURE_INVALID`.
   */
  async consume(operatorId: string, deviceId: string, nonce: Buffer, created: Date): Promise<void> {
    const outcome = await this.outcome(operatorId, deviceId, nonce, created);
    if (outcome === 'OK') return;
    if (outcome === 'CLOCK_SKEW')
      throw new ProblemException('CLOCK_SKEW_TOO_LARGE', {
        headers: { Date: new Date().toUTCString() },
      });
    throw new ProblemException('DEVICE_SIGNATURE_INVALID');
  }
}
