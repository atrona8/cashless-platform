// Transaction de niveau plateforme (contrat platform-access, SPECIFICATION §2.2) :
// BEGIN → set_config('app.scope', 'platform', true) → fn → COMMIT ; ROLLBACK puis relance sur erreur.
// Règles :
// 1. Elle passe par le second pool, connecté en rôle `cashless_platform` : ce rôle n'a aucun droit sur le grand
//    livre, les événements et leurs objets, et ne voit d'un prestataire que sa fiche, son contrat avec la plateforme
//    et ses redevances (politiques nominatives de post-roles.sql).
// 2. Elle ne pose JAMAIS `app.operator_id` : aucune ligne d'un prestataire ne devient visible. `app.scope` ne sert
//    qu'à la lisibilité des journaux de la base.
// 3. Seuls les services de plateforme l'utilisent (test d'architecture) ; toute route qui s'en sert exige
//    `PLATFORM_ADMIN` sur la portée `PLATFORM`.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_PLATFORM_POOL } from './pool.token';
import type { TxClient } from './tenant-tx';

@Injectable()
export class PlatformTx {
  constructor(@Inject(PG_PLATFORM_POOL) private readonly pool: Pool) {}

  async run<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.scope', 'platform', true)");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
