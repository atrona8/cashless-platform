// Preuve du bracelet au rejeu (WP13, T060 ; A07, décision 13) : sans objet `tap` valide, la vente
// est rejetée
// (MALFORMED_OPERATION, détail précis, anomalie) ET le numéro reste consommé ; plafonds par vente
// et par terminal et
// par heure ; scénario hostile de 2 000 ventes fictives.
import type { Client } from 'pg';
import { assertNoFakeInProduction } from '../../../../src/kms/production-guard';
import {
  PgEdgeSyncCentral,
  PgTapProofVerifier,
} from '../../../../src/edge/sync/pg-edge-sync-central';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  addWallet,
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

jest.setTimeout(300_000);

describe('preuve du bracelet au rejeu', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(new TestCentral(owner), new TestTapProof(owner), owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const cursor = async (site: Site): Promise<bigint> =>
    (
      await owner.query(`SELECT contiguous_edge_seq FROM edge_gateway WHERE id = $1`, [
        site.gatewayId,
      ])
    ).rows[0].contiguous_edge_seq;
  const anomalies = async (site: Site, kind: string): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM anomaly WHERE ledger_id = $1 AND kind = $2`,
        [site.ledgerId, kind],
      )
    ).rows[0].n;
  const balance = async (site: Site, n: number): Promise<bigint> =>
    BigInt(
      (
        await owner.query(
          `SELECT coalesce(-(SELECT ab.balance FROM account_balance ab JOIN account a ON a.id = ab.account_id
                              WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'), 0) AS v`,
          [site.wallets.get(n)!.walletId],
        )
      ).rows[0].v,
    );
  const suspense = async (site: Site): Promise<bigint> =>
    BigInt(
      (
        await owner.query(
          `SELECT coalesce(sum(po.amount), 0) AS v FROM posting po JOIN account a ON a.id = po.account_id
            WHERE po.ledger_id = $1 AND a.purpose = 'SUSPENSE'`,
          [site.ledgerId],
        )
      ).rows[0].v,
    );

  const rejected = async (site: Site, options: Parameters<typeof makeOp>[1], detail: string) => {
    const before = await cursor(site);
    const reply = await post(site, makeBatch(site, [makeOp(site, options)]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0]).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'MALFORMED_OPERATION',
      detail,
      effect: 'NONE',
    });
    // Le numéro est consommé : le vidage ne se bloque pas.
    expect(await cursor(site)).toBe(before + 1n);
  };

  it('vente sans tap : rejet, numéro consommé, anomalie NON_COMPLIANT_OPERATION', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    await rejected(site, { noTap: true }, 'TAP_MISSING');
    expect(await balance(site, 1)).toBe(10_000n);
  });

  it('compteur non croissant, UID différent, signature fausse, passage inconnu : tous rejetés', async () => {
    const site = await seedSite(owner, world, [
      [1, 10_000],
      [2, 10_000],
    ]);
    // Un passage valide d'abord (compteur 1).
    expect((await post(site, makeBatch(site, [makeOp(site)]))).json?.results[0].status).toBe(
      'ACCEPTED',
    );
    const w1 = site.wallets.get(1)!;
    const w2 = site.wallets.get(2)!;
    await rejected(site, { tapPatch: { counter: 1 } }, 'TAP_COUNTER_NOT_INCREASING');
    await rejected(site, { tapPatch: { counter: 0 } }, 'TAP_COUNTER_NOT_INCREASING');
    // `token_hash` du portefeuille 2 avec l'UID du bracelet 1 : l'UID ne correspond pas.
    await rejected(
      site,
      { tapPatch: { token_hash: w2.tokenHash, counter: 50 } },
      'TAP_UID_MISMATCH',
    );
    // Signature d'un autre bracelet.
    await rejected(
      site,
      {
        tapPatch: {
          originality_signature: Buffer.from(w2.signature).toString('base64'),
          counter: 51,
        },
      },
      'TAP_SIGNATURE_NOT_VERIFIED',
    );
    await rejected(
      site,
      { tapPatch: { originality_signature: undefined, counter: 52 } },
      'TAP_SIGNATURE_NOT_VERIFIED',
    );
    // Bracelet inconnu.
    await rejected(
      site,
      { tapPatch: { token_hash: 'aa'.repeat(32), counter: 53 } },
      'UNKNOWN_MEDIA',
    );
    // Une valeur reçue de la passerelle n'est jamais crue : `signature_verified: true` envoyé est
    // écrasé.
    await rejected(
      site,
      {
        tapPatch: {
          signature_verified: true,
          originality_signature: Buffer.from('forgée').toString('base64'),
          counter: 54,
        },
      },
      'TAP_SIGNATURE_NOT_VERIFIED',
    );
    expect(await balance(site, 1)).toBe(9000n);
    expect(await balance(site, 2)).toBe(10_000n);
    expect(await anomalies(site, 'NON_COMPLIANT_OPERATION')).toBeGreaterThanOrEqual(7);
    void w1;
  });

  it('vente avec preuve valide : acceptée, compteur du bracelet avancé', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await post(site, makeBatch(site, [makeOp(site, { amount: 2500 })]));
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    const { rows } = await owner.query(`SELECT last_counter FROM media WHERE token_hash = $1`, [
      Buffer.from(site.wallets.get(1)!.tokenHash, 'hex'),
    ]);
    expect(rows[0].last_counter).toBe(1n);
    // Rejouer le même passage (compteur 1) sous un autre numéro est refusé.
    const again = makeOp(site, { amount: 100, tapPatch: { counter: 1 } });
    expect((await post(site, makeBatch(site, [again]))).json?.results[0].detail).toBe(
      'TAP_COUNTER_NOT_INCREASING',
    );
  });

  it('plafond horaire par terminal : la part au-delà va en S-ATTENTE, rien n’est perdu pour le commerçant', async () => {
    const site = await seedSite(owner, world, [[1, 5_000_000]]);
    const ops = Array.from({ length: 12 }, () => makeOp(site, { amount: 50_000 }));
    const reply = await post(site, makeBatch(site, ops));
    expect(reply.status).toBe(200);
    const debited = 5_000_000n - (await balance(site, 1));
    expect(debited).toBeLessThanOrEqual(500_000n);
    expect(await suspense(site)).toBeGreaterThanOrEqual(100_000n);
    expect(
      (reply.json?.results as Array<{ status: string }>).some(
        (r) => r.status === 'ACCEPTED_WITH_SHORTFALL',
      ),
    ).toBe(true);
  });

  it('scénario hostile : 2 000 ventes fictives, perte mesurée sous le plafond', async () => {
    const site = await seedSite(owner, world, [[1, 200_000_000]]);
    const start = await balance(site, 1);
    for (let batch = 0; batch < 4; batch += 1) {
      const ops = Array.from({ length: 500 }, () => makeOp(site, { amount: 50_000 }));
      const reply = await post(site, makeBatch(site, ops));
      expect(reply.status).toBe(200);
    }
    const loss = start - (await balance(site, 1));
    // P_max = plafond par terminal et par heure (un terminal, une heure) : 500 000.
    expect(loss).toBeLessThanOrEqual(500_000n);
    expect(await cursor(site)).toBe(2000n);
  });

  it('un second portefeuille et un second terminal ne partagent pas le plafond d’un autre événement', async () => {
    const a = await seedSite(owner, world, [[1, 2_000_000]]);
    const b = await seedSite(owner, world, [[1, 2_000_000]]);
    await post(
      a,
      makeBatch(
        a,
        Array.from({ length: 12 }, () => makeOp(a, { amount: 50_000 })),
      ),
    );
    const reply = await post(b, makeBatch(b, [makeOp(b, { amount: 50_000 })]));
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    void addWallet;
  });
});

describe('aucun faux en production', () => {
  it('un accès central ou une preuve de passage factice refuse le démarrage en production', async () => {
    const owner = await openOwner();
    try {
      expect(() =>
        assertNoFakeInProduction(true, {
          'l’accès central des lots de passerelle': new TestCentral(owner),
        }),
      ).toThrow(/accès central/);
      expect(() =>
        assertNoFakeInProduction(true, {
          'la preuve de passage des lots de passerelle': new TestTapProof(owner),
        }),
      ).toThrow(/preuve de passage/);
      // Les adaptateurs de production (fonctions SQL étroites) ne sont pas des faux.
      expect(() =>
        assertNoFakeInProduction(true, {
          a: new PgEdgeSyncCentral({} as never),
          b: new PgTapProofVerifier({} as never),
        }),
      ).not.toThrow();
    } finally {
      await owner.end();
    }
  });
});
