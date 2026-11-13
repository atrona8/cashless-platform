// Borne d'OP-N122 / ADR-188 : le central croit `tap.pack_verified` pour une vente relayée par la
// passerelle (seule détentrice de la clé des colis) sans pouvoir le vérifier. Cette confiance est
// bornée : (a) elle ne vaut que pour la valeur booléenne `true` d'une opération reçue sur la voie
// `/edge/*` par une passerelle authentifiée ; (b) une vente ainsi crue reste sous les plafonds de
// rejeu d'ADR-159 (OP-N104). Si l'une de ces limites s'élargit, ce test devient rouge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import type { Client } from 'pg';
import { edgeTls, seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
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

jest.setTimeout(300_000);

describe('OP-N122 : borne de la confiance en pack_verified relayé par la passerelle', () => {
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

  const balance = async (site: Site): Promise<bigint> =>
    BigInt(
      (
        await owner.query(
          `SELECT coalesce(-(SELECT ab.balance FROM account_balance ab JOIN account a ON a.id = ab.account_id
                              WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'), 0) AS v`,
          [site.wallets.get(1)!.walletId],
        )
      ).rows[0].v,
    );

  it('pack_verified n’est cru que s’il vaut le booléen true : toute autre valeur est refusée', async () => {
    const site = await seedSite(owner, world, [[1, 100_000]]);
    const forged: unknown[] = ['true', 1, 'yes', {}, [true], null, false, undefined];
    for (const value of forged) {
      const reply = await edgePost(
        edge.port,
        site.cert,
        makeBatch(site, [makeOp(site, { amount: 1000, tapPatch: { pack_verified: value } })]),
      );
      expect(reply.status).toBe(200);
      expect(reply.json?.results[0]).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'MALFORMED_OPERATION',
        detail: 'TAP_PACK_NOT_VERIFIED',
        effect: 'NONE',
      });
    }
    expect(await balance(site)).toBe(100_000n);
    const ok = await edgePost(
      edge.port,
      site.cert,
      makeBatch(site, [makeOp(site, { amount: 1000 })]),
    );
    expect(ok.json?.results[0].status).toBe('ACCEPTED');
    expect(await balance(site)).toBe(99_000n);
  });

  it('le code du central ne reprend pack_verified que par une égalité stricte à true', () => {
    const src = readFileSync(
      join(__dirname, '../../../../src/edge/sync/edge-sync.writer.ts'),
      'utf8',
    );
    expect(src).toMatch(/pack_verified:\s*t\.pack_verified === true\s*,/);
    expect(src).not.toMatch(/pack_verified:\s*(Boolean\(|!!|t\.pack_verified\s*[,?}])/);
  });

  it('une opération venue d’ailleurs que d’une passerelle authentifiée n’est pas reçue', async () => {
    const site = await seedSite(owner, world, [[1, 100_000]]);
    const body = Buffer.from(JSON.stringify(makeBatch(site, [makeOp(site, { amount: 1000 })])));
    const { tls } = await edgeTls();
    // Sans certificat client : la poignée de main mTLS ou la route refuse, rien n’est écrit.
    const outcome = await new Promise<string>((resolve) => {
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port: edge.port,
          path: '/v1/edge/sync-batches',
          method: 'POST',
          ca: tls.serverCaPem,
          servername: 'localhost',
          headers: { 'content-type': 'application/json', 'content-length': body.length },
          timeout: 30_000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(`HTTP ${res.statusCode}`));
        },
      );
      req.on('error', () => resolve('REFUSED'));
      req.end(body);
    });
    expect(outcome === 'REFUSED' || /^HTTP (401|403)$/.test(outcome)).toBe(true);
    expect(await balance(site)).toBe(100_000n);
  });

  it('une vente à pack_verified true reste sous le plafond horaire et le plafond par vente', async () => {
    const site = await seedSite(owner, world, [[1, 5_000_000]]);
    const ops = Array.from({ length: 12 }, () => makeOp(site, { amount: 50_000 }));
    expect(ops.every((o) => (o.tap as { pack_verified: unknown }).pack_verified === true)).toBe(
      true,
    );
    const reply = await edgePost(edge.port, site.cert, makeBatch(site, ops));
    expect(reply.status).toBe(200);
    expect(5_000_000n - (await balance(site))).toBeLessThanOrEqual(500_000n);
    expect(
      (reply.json?.results as Array<{ status: string }>).some(
        (r) => r.status === 'ACCEPTED_WITH_SHORTFALL',
      ),
    ).toBe(true);
  });

  it('2 000 ventes à pack_verified true d’une passerelle hostile : perte sous le plafond', async () => {
    const site = await seedSite(owner, world, [[1, 200_000_000]]);
    const start = await balance(site);
    for (let batch = 0; batch < 4; batch += 1) {
      const ops = Array.from({ length: 500 }, () => makeOp(site, { amount: 50_000 }));
      expect((await edgePost(edge.port, site.cert, makeBatch(site, ops))).status).toBe(200);
    }
    expect(start - (await balance(site))).toBeLessThanOrEqual(500_000n);
  });
});
