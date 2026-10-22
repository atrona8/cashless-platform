// Purges des terminaux (mission 5a, lot WP12 ; relecture de WP04, M3 ; compte rendu de WP07) :
// nonces de requête expirés (`purge_device_request_nonces`, par lots, heure de la base) et essais
// d'enrôlement de plus de 24 h (`purge_device_enrollment_attempts`). Travailleur du registre de
// l'API publique (seul processus qui le charge, par DevicesModule) : `serve` le fait tourner à
// intervalle, et ce travailleur ne purge qu'une fois par `DEVICE_PURGE_INTERVAL_SECONDS` (300 s par
// défaut). Rôle de base qui exécute les purges : cashless_app (post-roles.sql, section 4a), le seul
// à qui elles sont accordées. Fonctions SECURITY DEFINER sans prestataire de session : transaction
// sans prestataire (`TenantTx.withoutTenant`).
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';

/** Lignes de nonces retirées par appel (borne de la fonction : 1 à 10 000). */
export const NONCE_PURGE_BATCH = 1000;
const INTERVAL = { min: 1, max: 86_400, fallback: 300 };

/** `DEVICE_PURGE_INTERVAL_SECONDS` : entier de 1 à 86 400, 300 par défaut. */
export function purgeIntervalSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === '') return INTERVAL.fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < INTERVAL.min || parsed > INTERVAL.max)
    throw new Error(
      `DEVICE_PURGE_INTERVAL_SECONDS : entier de ${INTERVAL.min} à ${INTERVAL.max} attendu ` +
        `(reçu « ${raw} »)`,
    );
  return parsed;
}

@Injectable()
export class DevicePurgeWorker implements ProcessWorker, OnModuleInit {
  readonly name = 'device-purge';
  readonly intervalSeconds = purgeIntervalSeconds(process.env.DEVICE_PURGE_INTERVAL_SECONDS);
  /** Prochain passage permis (ms) ; 0 : dès le premier passage du registre. */
  private nextRunAt = 0;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tx: TenantTx,
  ) {}

  /** Le registre est un fournisseur du module racine de l'API publique (app.module.ts). */
  onModuleInit(): void {
    this.moduleRef.get(WorkerRegistry, { strict: false }).register(this);
  }

  /**
   * Un lot de chaque purge si l'intervalle est écoulé ; rend le nombre de lignes retirées (le
   * registre repasse tant qu'il en reste). Rien à retirer : prochain passage dans l'intervalle.
   */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    const removed = await this.tx.withoutTenant(async (client) => {
      const nonces = await client.query<{ n: string }>(
        'SELECT purge_device_request_nonces($1)::text AS n',
        [NONCE_PURGE_BATCH],
      );
      const attempts = await client.query<{ n: string }>(
        'SELECT purge_device_enrollment_attempts()::text AS n',
      );
      return Number(nonces.rows[0]!.n) + Number(attempts.rows[0]!.n);
    });
    if (removed === 0) this.nextRunAt = now + this.intervalSeconds * 1000;
    return removed;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : nonces expirés et essais d’enrôlement de plus de 24 h, toutes les ` +
        `${this.intervalSeconds} s`,
    ]);
  }
}

@Module({ providers: [DevicePurgeWorker] })
export class DeviceMaintenanceModule {}
