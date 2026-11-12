// Écrivain des lots EDGE_SYNC (WP13, T059) : une enveloppe par type, décision reprise telle quelle,
// frais recalculés
// par le central seul (décision 26), `CL007` / `40001` / `23505` sans blocage du vidage, doublons,
// annulation d'une
// vente rognée (A08).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { deviceKey } from '../../../../src/idempotency/device-key';
import { EdgeSyncWriter } from '../../../../src/edge/sync/edge-sync.writer';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  openOwner,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';
import type { Loose } from '../../../support/loose';

jest.setTimeout(120_000);

describe('réception des lots EDGE_SYNC : écrivain', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;
  let central: TestCentral;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    central = new TestCentral(owner);
    edge = await startSyncEdge(central, new TestTapProof(owner), owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    central.feeProvider = null;
  });

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const available = async (site: Site, n: number, purpose = 'WALLET_PAID'): Promise<bigint> => {
    const { rows } = await owner.query(
      `SELECT coalesce(-(SELECT ab.balance FROM account_balance ab JOIN account a ON a.id = ab.account_id
                          WHERE a.wallet_id = $1 AND a.purpose = $2), 0) AS v`,
      [site.wallets.get(n)!.walletId, purpose],
    );
    return BigInt(rows[0].v);
  };
  const lines = async (txId: string) =>
    (
      await owner.query(
        `SELECT a.purpose, po.amount, po.fee_rule_id FROM posting po JOIN account a ON a.id = po.account_id
          WHERE po.transaction_id = $1 ORDER BY po.line_no`,
        [txId],
      )
    ).rows as Array<{ purpose: string; amount: bigint; fee_rule_id: string | null }>;
  const txOf = async (site: Site, seq: number): Promise<string> =>
    (
      await owner.query(
        `SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2`,
        [site.ledgerId, deviceKey(site.deviceSerial, BigInt(seq))],
      )
    ).rows[0].id;
  const cursor = async (site: Site): Promise<bigint> =>
    (
      await owner.query(`SELECT contiguous_edge_seq FROM edge_gateway WHERE id = $1`, [
        site.gatewayId,
      ])
    ).rows[0].contiguous_edge_seq;

  it('PURCHASE : la décision de la passerelle est reprise telle quelle (manque en attente)', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await post(
      site,
      makeBatch(site, [makeOp(site, { amount: 4000, shortfall: 1500 })]),
    );
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('ACCEPTED_WITH_SHORTFALL');
    const rows = await lines(await txOf(site, 1));
    expect(rows.find((r) => r.purpose === 'WALLET_PAID')?.amount).toBe(2500n);
    expect(rows.find((r) => r.purpose === 'SUSPENSE')?.amount).toBe(1500n);
    expect(await available(site, 1)).toBe(7500n);
  });

  it('modifier la décision change l’écriture (preuve que la décision est bien lue)', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await post(
      site,
      makeBatch(site, [makeOp(site, { amount: 4000, shortfall: 4000 })]),
    );
    expect(reply.json?.results[0].status).toBe('ACCEPTED_WITH_SHORTFALL');
    expect(await available(site, 1)).toBe(10_000n);
  });

  it('chaque type a son enveloppe : VOID sans écriture, ONLINE_REF rejeté, numéros consommés', async () => {
    const site = await seedSite(owner, world);
    const ops = [
      makeOp(site, { type: 'VOID' }),
      makeOp(site, { type: 'ONLINE_REF', noTap: true }),
      makeOp(site, {
        type: 'ACTIVATION',
        noTap: true,
        patch: { edge_guichet: { media_id: randomUUID() } },
      }),
      makeOp(site, {
        type: 'DEPOSIT_CASH',
        noTap: true,
        patch: { edge_guichet: { media_id: randomUUID() } },
      }),
      makeOp(site, { type: 'ADJUSTMENT', noTap: true, amount: 5 }),
      makeOp(site, { amount: 500 }),
    ];
    const reply = await post(site, makeBatch(site, ops));
    expect(reply.status).toBe(200);
    const results = reply.json?.results as Array<Record<string, Loose>>;
    expect(results[0]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE', transaction_id: null });
    expect(results[1]).toMatchObject({ status: 'REJECTED', reject_reason: 'MALFORMED_OPERATION' });
    for (const r of results.slice(2, 5)) expect(r.status).toBe('REJECTED');
    expect(results[5]).toMatchObject({ status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    expect(await cursor(site)).toBe(6n);
  });

  it('TOPUP_CASH de la file de la passerelle va à son enveloppe (rejet sans session de caisse), le vidage continue', async () => {
    const site = await seedSite(owner, world);
    const ops = [
      makeOp(site, {
        type: 'TOPUP_CASH',
        noTap: true,
        amount: 1000,
        patch: { edge_guichet: { media_id: randomUUID() } },
      }),
      makeOp(site, { amount: 100 }),
    ];
    const reply = await post(site, makeBatch(site, ops));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('REJECTED');
    expect(reply.json?.results[1].status).toBe('ACCEPTED');
  });

  it('décision absente ou incohérente : REJECTED / MALFORMED_OPERATION, jamais devinée', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const noDecision = makeOp(site, { patch: { edge_decision: undefined } });
    const inconsistent = makeOp(site, {
      patch: { edge_decision: { status: 'ACCEPTED', charged_to_wallet: 900, shortfall_amount: 0 } },
    });
    const negative = makeOp(site, {
      patch: {
        edge_decision: { status: 'ACCEPTED', charged_to_wallet: -5, shortfall_amount: 1005 },
      },
    });
    const reply = await post(site, makeBatch(site, [noDecision, inconsistent, negative]));
    expect(reply.status).toBe(200);
    for (const r of reply.json?.results ?? [])
      expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'MALFORMED_OPERATION' });
    expect(await available(site, 1)).toBe(10_000n);
  });

  it('clé d’origine déjà connue en ligne : DUPLICATE avec la transaction d’origine, rien de plus écrit', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const wallet = site.wallets.get(1)!;
    await owner.query(
      `SELECT post_transaction($1, 'TOPUP', $2, now(), 'ONLINE', jsonb_build_array(
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'L-WAL-1-P'), 'amount', -1::bigint),
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'), 'amount', 1::bigint)))`,
      [site.ledgerId, `${site.deviceSerial}:0001`],
    );
    void wallet;
    const reply = await post(site, makeBatch(site, [makeOp(site, { patch: { seq: 1 } })]));
    expect(reply.json?.results[0]).toMatchObject({ status: 'DUPLICATE', effect: 'LEDGER_WRITTEN' });
    expect(reply.json?.results[0].transaction_id).toBe(await txOf(site, 1));
    expect(await available(site, 1)).toBe(10_001n);
  });

  it('relayé puis renvoyé sous un autre numéro : un seul effet, le numéro est consommé sans blocage', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    expect((await post(site, makeBatch(site, [makeOp(site, { amount: 1000 })]))).status).toBe(200);
    const reply = await post(
      site,
      makeBatch(site, [makeOp(site, { amount: 1000, patch: { seq: 1 } })]),
    );
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].effect).toBe('NONE');
    expect(await available(site, 1)).toBe(9000n);
    expect(await cursor(site)).toBe(2n);
  });

  it('REVERSAL d’une vente rognée (A08) : le crédit n’excède pas ce qui a été écrit', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const sale = makeOp(site, { amount: 4000, shortfall: 1500 });
    expect((await post(site, makeBatch(site, [sale]))).status).toBe(200);
    expect(await available(site, 1)).toBe(7500n);
    const reversal = makeOp(site, {
      type: 'REVERSAL',
      amount: 4000,
      patch: { reverses_seq: 1 },
    });
    // La passerelle prétend rendre les 4 000 au portefeuille.
    const reply = await post(site, makeBatch(site, [reversal]));
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    expect(await available(site, 1)).toBe(10_000n);
  });

  describe('CL007, 40001 et 23505 : le vidage ne se bloque jamais', () => {
    const fail = (code: string) => Object.assign(new Error(code), { code });

    it('CL007 une fois : l’opération est rejouée et écrite', async () => {
      const site = await seedSite(owner, world);
      const writer = edge.app.get(EdgeSyncWriter);
      const real = writer.callEnvelope.bind(writer);
      let calls = 0;
      jest.spyOn(writer, 'callEnvelope').mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 1) throw fail('CL007');
        return real(...args);
      });
      const reply = await post(site, makeBatch(site, [makeOp(site)]));
      expect(reply.status).toBe(200);
      expect(reply.json?.results[0].status).toBe('ACCEPTED');
      expect(calls).toBe(2);
    });

    it('CL007 deux fois : REJECTED / INSUFFICIENT_FUNDS_RETRY réessayable, numéro consommé, suite traitée', async () => {
      const site = await seedSite(owner, world);
      const writer = edge.app.get(EdgeSyncWriter);
      const real = writer.callEnvelope.bind(writer);
      jest.spyOn(writer, 'callEnvelope').mockImplementation(async (client, g, b, op, c, p) => {
        if (op.edgeSeq === 1n) throw fail('CL007');
        return real(client, g, b, op, c, p);
      });
      const reply = await post(site, makeBatch(site, [makeOp(site), makeOp(site)]));
      expect(reply.status).toBe(200);
      expect(reply.json?.results[0]).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'INSUFFICIENT_FUNDS_RETRY',
        retryable: true,
        effect: 'NONE',
      });
      expect(reply.json?.results[1].status).toBe('ACCEPTED');
      expect(await cursor(site)).toBe(2n);
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
        [site.ledgerId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('40001 une fois : rejouée', async () => {
      const site = await seedSite(owner, world);
      const writer = edge.app.get(EdgeSyncWriter);
      const real = writer.callEnvelope.bind(writer);
      let calls = 0;
      jest.spyOn(writer, 'callEnvelope').mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 1) throw fail('40001');
        return real(...args);
      });
      const reply = await post(site, makeBatch(site, [makeOp(site)]));
      expect(reply.json?.results[0].status).toBe('ACCEPTED');
    });

    it('23505 persistant (clé d’origine déjà au registre ailleurs) : la passerelle n’est pas bloquée sur ce numéro', async () => {
      const site = await seedSite(owner, world);
      const writer = edge.app.get(EdgeSyncWriter);
      const real = writer.callEnvelope.bind(writer);
      jest.spyOn(writer, 'callEnvelope').mockImplementation(async (client, g, b, op, c, p) => {
        if (op.edgeSeq === 1n) throw fail('23505');
        return real(client, g, b, op, c, p);
      });
      const reply = await post(site, makeBatch(site, [makeOp(site), makeOp(site)]));
      expect(reply.status).toBe(200);
      expect(reply.json?.results[0]).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'EDGE_REPLAY_FAILED',
      });
      expect(reply.json?.results[1].status).toBe('ACCEPTED');
      expect(await cursor(site)).toBe(2n);
    });
  });
});
