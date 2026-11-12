// Ordre de dépense au rejeu central (WP25 partie A1, décision 45, ADR-185). Mêmes montants que la passerelle
// (apps/gateway/test/sales/spend-order.spec.ts : paiement de 1 500 sur 4 000 payé et 1 000 offert) : le central
// règle la répartition par `edge_spend_promo_first` de l'événement ; la page de réplication porte le même ordre
// dans `edge_terms.spend_order`, c'est ce que la passerelle applique.
import type { Client } from 'pg';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  openOwner,
  seedSite,
  startSyncEdge,
  type Site,
  type SyncEdge,
} from './sync-support';

jest.setTimeout(120_000);

describe('ordre de dépense : rejeu central et page de réplication', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(undefined, undefined, owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  async function site(order: 'PAID_FIRST' | 'PROMO_FIRST' | null): Promise<Site> {
    const s = await seedSite(owner, world, [[1, 4_000]]);
    await owner.query(
      `SELECT post_transaction($1, 'TOPUP', $2, now(), 'BATCH', jsonb_build_array(
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'L-WAL-1-X'), 'amount', -1000::bigint),
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'), 'amount', 1000::bigint)))`,
      [s.ledgerId, `promo-${s.gatewayId}`],
    );
    if (order)
      await owner.query(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, 'EVENT', $2, 1, now() - interval '1 day', $3)`,
        [s.operatorId, s.eventId, JSON.stringify({ spend_order: order })],
      );
    return s;
  }
  const split = async (s: Site) =>
    Object.fromEntries(
      (
        await owner.query<{ purpose: string; amount: string }>(
          `SELECT a.purpose, sum(abs(po.amount))::text AS amount FROM posting po
             JOIN account a ON a.id = po.account_id JOIN journal_transaction t ON t.id = po.transaction_id
            WHERE t.ledger_id = $1 AND t.idempotency_key = $2 AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
            GROUP BY a.purpose`,
          [s.ledgerId, `${s.deviceSerial}:0001`],
        )
      ).rows.map((r) => [r.purpose, Number(r.amount)]),
    );
  const replay = async (s: Site) => {
    const reply = await edgePost(edge.port, s.cert, makeBatch(s, [makeOp(s, { amount: 1_500 })]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
  };
  const terms = async (s: Site) =>
    (await owner.query(`SELECT edge_replication_terms($1) AS t`, [s.gatewayId])).rows[0]
      .t as Record<string, unknown>;

  it('PAID_FIRST : le central débite le payé d’abord ; la page porte PAID_FIRST', async () => {
    const s = await site('PAID_FIRST');
    await replay(s);
    expect(await split(s)).toEqual({ WALLET_PAID: 1_500 });
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [s.operatorId]);
    expect((await terms(s)).spend_order).toBe('PAID_FIRST');
  });

  it('PROMO_FIRST : l’offert d’abord ; la page porte PROMO_FIRST', async () => {
    const s = await site('PROMO_FIRST');
    await replay(s);
    expect(await split(s)).toEqual({ WALLET_PROMO: 1_000, WALLET_PAID: 500 });
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [s.operatorId]);
    expect((await terms(s)).spend_order).toBe('PROMO_FIRST');
  });

  it('aucun réglage : défaut du central PROMO_FIRST, annoncé tel quel à la passerelle', async () => {
    const s = await site(null);
    await replay(s);
    expect(await split(s)).toEqual({ WALLET_PROMO: 1_000, WALLET_PAID: 500 });
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [s.operatorId]);
    expect((await terms(s)).spend_order).toBe('PROMO_FIRST');
  });
});
