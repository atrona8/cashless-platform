// Transaction locale unique de la passerelle (interfaces.md § 4) : `READ COMMITTED`, un seul pool
// (`pool.ts`).
// Aucune requête hors transaction pour une opération de terminal : tout passe par `run`.
import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_POOL, type GatewayPool, type TxClient } from './pool';

export type { TxClient };

@Injectable()
export class GatewayTx {
  constructor(@Inject(GATEWAY_POOL) private readonly pool: GatewayPool) {}

  async run<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
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
