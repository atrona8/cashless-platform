// Transaction cloisonnée par prestataire (research R-03, SPECIFICATION §2.2 règle 3) :
// BEGIN → set_config('app.operator_id', $1, true) → fn → COMMIT ; ROLLBACK puis relance sur erreur.
// `true` = portée transaction : la connexion rendue au pool ne garde aucun prestataire.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { ProblemException } from '../errors/problem';
import { PG_POOL } from './pool.token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Personne d'un jeton, rendue par `identify_person` (migration 0003). */
export interface IdentifiedPerson {
  user_id: string;
  operator_id: string | null;
  status: 'ACTIVE' | 'DISABLED';
  assignments: Array<{ role: string; scope_type: string; scope_id: string | null }>;
}

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
    await this.readOnly((client) => client.query('SELECT 1'));
  }

  /**
   * Personne d'un jeton (mission identite-roles, research R-04), avant que le prestataire soit connu : seconde
   * exception documentée, en lecture seule et sans prestataire. Ne lit que par `identify_person` (SECURITY DEFINER),
   * qui ne rend que la personne demandée ; aucune table n'est lue directement hors `run`.
   */
  async identify(issuer: string, subject: string): Promise<IdentifiedPerson | null> {
    return this.readOnly(async (client) => {
      const { rows } = await client.query<IdentifiedPerson>(
        'SELECT user_id, operator_id, status, assignments FROM identify_person($1, $2)',
        [issuer, subject],
      );
      return rows[0] ?? null;
    });
  }

  private async readOnly<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
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
