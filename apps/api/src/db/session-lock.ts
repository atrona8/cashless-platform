// Verrou consultatif de SESSION PostgreSQL, pris sans attente et tenu pendant un traitement qui
// ouvre lui-même ses transactions ailleurs (mission 5b, lot WP09 : un essai de PIN à la fois par
// terminal, vendors/pin-attempt-lock.ts). Placé dans db/ : seul ce dossier touche `pg`
// (test d'architecture, research R-03).
//
// La connexion du verrou vient d'un pool DÉDIÉ (rôle de l'API, `DATABASE_URL_APP`) : tenue pendant
// que le traitement prend ses connexions sur le pool principal, elle ne peut pas l'épuiser (une
// rafale d'essais tenant chacun une connexion du pool principal en attendant une seconde le
// bloquerait). Elle ne porte AUCUNE transaction ni aucun prestataire : seulement le verrou.
// Relâchement dans `finally` ; s'il échoue, la connexion est détruite, ce qui relâche le verrou
// (jamais rendue au pool avec un verrou tenu).
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** Verrou déjà tenu par une autre session : le traitement n'a pas été lancé. */
export const LOCK_BUSY = Symbol('LOCK_BUSY');

/** Verrou tenu ; `release` le relâche (idempotent, ne lève jamais). */
export interface HeldLock {
  release(): Promise<void>;
}

@Injectable()
export class SessionLock implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Aucune connexion avant le premier verrou.
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.poolSize,
      connectionTimeoutMillis: 10_000,
    });
  }

  /**
   * Prend le verrou de clé `hashtextextended(namespace || ':' || id, 0)` sans attente ; déjà tenu par
   * une autre session : `LOCK_BUSY`. Sinon rend la poignée à relâcher (une seule fois, jamais
   * d'erreur) : tant qu'elle n'est pas relâchée, la connexion du verrou reste prise.
   */
  async tryAcquire(namespace: string, id: string): Promise<HeldLock | typeof LOCK_BUSY> {
    const key = "hashtextextended($1::text || ':' || $2::text, 0)";
    const client = await this.pool.connect();
    let taken: boolean;
    try {
      const { rows } = await client.query<{ taken: boolean }>(
        `SELECT pg_try_advisory_lock(${key}) AS taken`,
        [namespace, id],
      );
      taken = rows[0]?.taken === true;
    } catch (error) {
      // État du verrou inconnu : la connexion n'est jamais rendue au pool.
      client.release(true);
      throw error;
    }
    if (!taken) {
      client.release();
      return LOCK_BUSY;
    }
    let done = false;
    return {
      release: async () => {
        if (done) return;
        done = true;
        const released = await client
          .query<{ released: boolean }>(`SELECT pg_advisory_unlock(${key}) AS released`, [
            namespace,
            id,
          ])
          .then((result) => result.rows[0]?.released === true)
          .catch(() => false);
        client.release(!released);
      },
    };
  }

  /** `fn` sous le verrou (voir `tryAcquire`) ; verrou déjà tenu : `LOCK_BUSY`, `fn` n'est pas appelé. */
  async tryRun<T>(
    namespace: string,
    id: string,
    fn: () => Promise<T>,
  ): Promise<T | typeof LOCK_BUSY> {
    const held = await this.tryAcquire(namespace, id);
    if (held === LOCK_BUSY) return LOCK_BUSY;
    try {
      return await fn();
    } finally {
      await held.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
