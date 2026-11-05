// Verrous de lot (mission 7, lot WP18 ; research R-30.7). Un verrou consultatif de session par lot en cours de
// traitement, pris sur un pool DÉDIÉ (`OFFLINE_BATCH_POOL_SIZE`, 20) : une rafale de lots ne peut pas épuiser le pool
// principal. `db/session-lock.ts` reste le seul code qui touche `pg` pour cela (test d'architecture).
//
// L'attente d'une connexion est bornée à 1 s ; pool plein au-delà, le lot n'est PAS ouvert (`503` + `Retry-After: 5`
// côté appelant). Une poignée obtenue APRÈS l'abandon de l'attente est relâchée aussitôt : aucun verrou orphelin.
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { LOCK_BUSY, SessionLock, type HeldLock } from '../../db/session-lock';

export const LOCK_NAMESPACE = 'offline-batch';
export const POOL_WAIT_MS = 1_000;
/** Pool plein : aucune connexion de verrou disponible dans le délai. */
export const POOL_FULL = Symbol('POOL_FULL');

@Injectable()
export class BatchLockPool implements OnApplicationShutdown {
  private readonly locks: SessionLock;

  constructor(
    config: AppConfig,
    private readonly waitMs: number = POOL_WAIT_MS,
  ) {
    this.locks = new SessionLock({ ...config, poolSize: config.offlineBatchPoolSize });
  }

  async acquire(batchId: string): Promise<HeldLock | typeof LOCK_BUSY | typeof POOL_FULL> {
    const attempt = this.locks.tryAcquire(LOCK_NAMESPACE, batchId);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof POOL_FULL>((resolve) => {
      timer = setTimeout(() => resolve(POOL_FULL), this.waitMs);
    });
    try {
      const outcome = await Promise.race([attempt, timeout]);
      if (outcome === POOL_FULL) {
        // Obtenue plus tard : relâchée tout de suite ; une erreur tardive est sans objet.
        void attempt.then(
          (late) => (late === LOCK_BUSY ? undefined : late.release()),
          () => undefined,
        );
      }
      return outcome;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.locks.onApplicationShutdown();
  }
}
