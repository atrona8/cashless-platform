// `getEdgeReplicationFeed` (WP12, T054 ; FR-021, NFR-010, A18). Une seule enveloppe : `edge_replication_page`, qui rend
// la page (`jsonb`) conforme à `replication-page-additions.yaml`. L'API valide la forme et la ré-émet telle quelle : elle
// ne fabrique, ne complète ni ne cache rien (l'horizon `to_posting_id` n'est jamais relâché ici).
//
// Transaction REPEATABLE READ posée AVANT toute requête (la fonction la refuse sinon, `CL001`) : `EdgeTx` ne convient
// pas, son `set_config` d'ouverture précède le moment où le niveau peut encore être fixé. Rejeu sur `40001` (conflit de sérialisation) et `23505`
// (écriture concurrente de l'horizon), au plus `MAX_ATTEMPTS` fois, la même requête rendant la même page absolue.
// Journal : curseurs et compteurs seulement, jamais le corps de la page (NFR-010).
import { Injectable, Logger } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import { TenantTx } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { EdgeGateway } from '../auth/edge-gateway';

export type ReplicationPage = components['schemas']['ReplicationPage'];

export interface FeedQuery {
  afterPostingId: number;
  limit: number;
  afterChangeSeq: number | null;
}

export const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(['40001', '23505']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Forme minimale du schéma `ReplicationPage` (champs requis et leur type) ; sinon la page n'est pas servie. */
export function isReplicationPage(page: unknown): page is ReplicationPage {
  if (!isObject(page)) return false;
  return (
    typeof page.ledger_id === 'string' &&
    isCount(page.epoch) &&
    isCount(page.from_posting_id) &&
    isCount(page.to_posting_id) &&
    Array.isArray(page.wallets) &&
    page.wallets.every(
      (wallet) =>
        isObject(wallet) &&
        typeof wallet.wallet_id === 'string' &&
        typeof wallet.status === 'string' &&
        isCount(wallet.paid) &&
        isCount(wallet.promo),
    ) &&
    Array.isArray(page.media) &&
    typeof page.has_more === 'boolean' &&
    (page.edge_terms === undefined || isObject(page.edge_terms))
  );
}

@Injectable()
export class ReplicationFeedService {
  private readonly logger = new Logger('EdgeReplicationFeed');

  constructor(private readonly tx: TenantTx) {}

  async page(gateway: EdgeGateway, query: FeedQuery): Promise<ReplicationPage> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.once(gateway, query);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code && RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) continue;
        // Passerelle retirée ou révoquée entre la garde et l'appel : même 401 que la garde.
        if (code === '42501') throw new ProblemException('UNAUTHENTICATED');
        throw error;
      }
    }
  }

  private once(gateway: EdgeGateway, query: FeedQuery): Promise<ReplicationPage> {
    // `withoutTenant` n'émet que BEGIN avant la fonction : le niveau d'isolement se fixe donc en premier, puis le
    // prestataire et la passerelle (portée transaction), comme `EdgeTx`.
    return this.tx.withoutTenant(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [gateway.operatorId]);
      await client.query("SELECT set_config('app.gateway_id', $1, true)", [gateway.gatewayId]);
      const { rows } = await client.query<{ page: unknown }>(
        'SELECT edge_replication_page($1, $2, $3, $4) AS page',
        [
          gateway.gatewayId,
          String(query.afterPostingId),
          query.afterChangeSeq === null ? null : String(query.afterChangeSeq),
          query.limit,
        ],
      );
      const page = rows[0]?.page;
      if (!isReplicationPage(page)) {
        // Défaut du producteur : rien n'est renvoyé, et le journal ne porte aucun contenu de page.
        this.logger.error(
          JSON.stringify({
            event: 'edge.replication.invalid_page',
            gateway_id: gateway.gatewayId,
            after_posting_id: query.afterPostingId,
          }),
        );
        throw new Error('Page de réplication non conforme au schéma ReplicationPage');
      }
      this.logger.log(
        JSON.stringify({
          event: 'edge.replication.page',
          gateway_id: gateway.gatewayId,
          after_posting_id: query.afterPostingId,
          to_posting_id: page.to_posting_id,
          wallets: page.wallets.length,
          media: page.media.length,
          has_more: page.has_more,
        }),
      );
      return page;
    });
  }
}
