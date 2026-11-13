// Défauts de ce lot pour les ports fournis par d'autres lots : lecture seule de la base locale.
import { Inject, Injectable } from '@nestjs/common';
import { GatewayTx } from '../db/gateway-tx';
import type { QueueProbe } from './ports';

/**
 * File vide = tout numéro attribué est acquitté et aucun lot AVEC opération n'est en vol (un lot d'ordres seuls,
 * décision 50, ne porte aucune opération : il ne retient ni purge ni rendu).
 */
@Injectable()
export class DbQueueProbe implements QueueProbe {
  constructor(@Inject(GatewayTx) private readonly gatewayTx: GatewayTx) {}

  async isEmpty(): Promise<boolean> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ empty: boolean }>(
        `SELECT (h.acked_edge_seq = h.last_edge_seq)
                AND NOT EXISTS (SELECT 1 FROM edge_outgoing_batch
                                 WHERE status <> 'DONE' AND edge_seq_to >= edge_seq_from) AS empty
           FROM edge_chain_head h`,
      );
      return rows[0]?.empty ?? true;
    });
  }
}
