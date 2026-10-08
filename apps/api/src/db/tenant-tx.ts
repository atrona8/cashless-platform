// Transaction cloisonnée par prestataire (research R-03, SPECIFICATION §2.2 règle 3) :
// BEGIN → set_config('app.operator_id', $1, true) → fn → COMMIT ; ROLLBACK puis relance sur erreur.
// `true` = portée transaction : la connexion rendue au pool ne garde aucun prestataire.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { ProblemException } from '../errors/problem';
import { PG_POOL } from './pool.token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client fourni à l'intérieur d'une transaction : sa durée de vie est celle de `run`. */
export type TxClient = Pick<PoolClient, 'query'>;

@Injectable()
export class TenantTx {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async run<T>(operatorId: string, fn: (client: TxClient) => Promise<T>): Promise<T> {
    if (!UUID.test(operatorId)) {
      throw new ProblemException('VALIDATION_FAILED', { status: 400, detail: 'Identifiant de prestataire invalide.' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
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

  /**
   * Contrôle de vie de la base (route de santé), sans prestataire : `SELECT 1` dans une transaction en lecture
   * seule. Seule exception documentée à la règle « aucune requête hors `run` » ; ne lit aucune table.
   */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SELECT 1');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
