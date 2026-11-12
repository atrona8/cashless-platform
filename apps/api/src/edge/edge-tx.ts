// Transaction d'une requête de passerelle : `app.operator_id` (celui de la ligne lue par la garde) et `app.gateway_id`
// (que chaque enveloppe SQL compare à son paramètre `p_gateway`, 42501 sinon), tous deux `set_config(…, true)`.
// Courte : une attente longue n'en tient jamais ouverte (`idle_in_transaction_session_timeout`).
import { Injectable } from '@nestjs/common';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import type { EdgeGateway } from './auth/edge-gateway';

@Injectable()
export class EdgeTx {
  constructor(private readonly tx: TenantTx) {}

  run<T>(gateway: EdgeGateway, fn: (client: TxClient) => Promise<T>): Promise<T> {
    return this.tx.run(gateway.operatorId, async (client) => {
      await client.query("SELECT set_config('app.gateway_id', $1, true)", [gateway.gatewayId]);
      return fn(client);
    });
  }
}
