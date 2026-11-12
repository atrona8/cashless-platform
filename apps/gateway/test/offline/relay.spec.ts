// Relais des lots de terminal vers le central (WP23, T104/T107). Le central est simulé : il déduplique par
// jeton d'idempotence (`idempotency_key` de chaque opération), comme le fait le vrai (NFR-003) ; la preuve
// avec le vrai central est dans WP25.
import { chainStep, edgeContentSha256, edgeChainGenesis } from '@cashless/shared-rules';
import { GatewayTx } from '../../src/db/gateway-tx';
import { buildBatch } from '../../src/queue/batch-builder';
import { buildDeviceBatch, makeBench, readySnapshot, submit, type Bench } from './_support/bench';
import type { OfflineDevice, SeedMediaResult } from './_support/bench';

let b: Bench;
let dev: OfflineDevice;
let media: SeedMediaResult;
let version: number;

beforeEach(async () => {
  b = await makeBench();
  dev = await b.newDevice();
  media = await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
  version = await readySnapshot(b);
});
afterEach(async () => {
  await b.close();
});

const relayBody = async (): Promise<any> =>
  new GatewayTx(b.db.pool).run((tx) =>
    buildBatch(
      tx,
      {
        batchId: '00000000-0000-4000-8000-000000000001',
        gatewayId: b.gatewayId,
        ledgerId: b.ids.ledger,
        epoch: 3,
        from: 1,
      },
      edgeChainGenesis(b.gatewayId),
    ),
  );

/** Central simulé : un seul effet par jeton d'idempotence, quel que soit le chemin d'arrivée. */
class FakeCentral {
  readonly effects = new Map<string, number>();
  apply(ops: Array<Record<string, any>>): void {
    for (const op of ops) {
      const key = String(op.idempotency_key ?? op.origin_key ?? `${op.device_serial}:${op.seq}`);
      if (!this.effects.has(key)) this.effects.set(key, Number(op.amount ?? 0));
    }
  }
}

describe('relais en file', () => {
  it('opérations relayées dans l’ordre, avec l’en-tête et la signature d’origine du terminal', async () => {
    const built = buildDeviceBatch(
      b,
      dev,
      [
        { media, amount: 100 },
        { media, amount: 200 },
        { media, amount: 300 },
      ],
      {
        snapshotVersion: version,
      },
    );
    expect((await submit(b, dev, built)).status).toBe(200);
    const body = await relayBody();
    expect(body.edge_seq_from).toBe(1);
    expect(body.edge_seq_to).toBe(3);
    expect(body.device_batches).toHaveLength(1);
    expect(body.device_batches[0].header).toEqual(built.header);
    expect(body.device_batches[0].signature).toBe(built.body.signature);
    const rows = await b.q('SELECT edge_seq, operation FROM edge_op ORDER BY edge_seq');
    expect(rows.map((r) => Number(r.edge_seq))).toEqual([1, 2, 3]);
    expect(body.operations).toEqual(rows.map((r) => r.operation));
  });

  it('chaîne de la passerelle continue autour des opérations relayées', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }, { media }], { snapshotVersion: version });
    await submit(b, dev, built);
    const body = await relayBody();
    let chain = edgeChainGenesis(b.gatewayId);
    for (const op of body.operations) chain = chainStep(chain, edgeContentSha256(op));
    expect(chain.toString('hex')).toBe(body.last_chain_hash);
    expect(body.prev_chain_hash).toBe(edgeChainGenesis(b.gatewayId).toString('hex'));
  });

  it('TOPUP_CASH rejeté est relayé comme les autres (consigné), sans delta', async () => {
    const built = buildDeviceBatch(b, dev, [{ type: 'TOPUP_CASH', amount: 1000 }, { media }], {
      snapshotVersion: version,
    });
    await submit(b, dev, built);
    const body = await relayBody();
    expect(body.operations).toHaveLength(2);
    expect(Number((await b.q('SELECT count(*) AS n FROM edge_op_delta'))[0]!.n)).toBe(1);
  });
});

describe('rejeu direct du même lot au central après la passerelle', () => {
  it('un seul effet par opération (NFR-003)', async () => {
    const built = buildDeviceBatch(
      b,
      dev,
      [
        { media, amount: 100 },
        { media, amount: 200 },
      ],
      {
        snapshotVersion: version,
      },
    );
    await submit(b, dev, built);
    const central = new FakeCentral();
    const body = await relayBody();
    central.apply(body.operations);
    // Le terminal rejoue ensuite son lot directement : mêmes jetons d'idempotence.
    central.apply(
      (built.body.operations as Array<Record<string, any>>).map((o) => ({
        ...o,
        idempotency_key: `${dev.serial}:${o.seq}`,
      })),
    );
    expect(central.effects.size).toBe(2);
  });

  it('les jetons relayés sont ceux que le terminal utiliserait (série:numéro)', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }, { media }], { snapshotVersion: version });
    await submit(b, dev, built);
    const rows = await b.q('SELECT origin_key FROM edge_op ORDER BY edge_seq');
    expect(rows.map((r) => r.origin_key)).toEqual([`${dev.serial}:0001`, `${dev.serial}:0002`]);
  });
});
