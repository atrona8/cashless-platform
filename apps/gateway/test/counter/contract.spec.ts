// WP22 / T102 : les trois routes de guichet reprennent EXACTEMENT le contrat (`openapi.yaml`,
// opérations `x-edge-available`, preuves de terminal + `staffBearer`) ; corps de requête et de
// réponse valident leur schéma ; aucune route ajoutée.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SERVED_OPERATION_IDS } from '../../src/processes/served-operations';
import { contractViolations } from '../device/_support/contract-schema';
import {
  counterRequest,
  readyBench,
  seedMedia,
  tapOf,
  type Bench,
  type TestDevice,
} from './_support/bench';
import type { Loose } from '../support/loose';

interface Operation {
  operationId: string;
  'x-edge-available'?: boolean;
  security?: Array<Record<string, unknown>>;
}
const openapi = parse(
  readFileSync(join(__dirname, '../../../../packages/contracts/openapi.yaml'), 'utf8'),
) as { paths: Record<string, Record<string, Operation>> };

let bench: Bench;
let device: TestDevice;
let seq = 0;
beforeAll(async () => {
  ({ bench, device } = await readyBench({
    terms: {
      lookup: async () => ({
        depositAmount: 2000n,
        depositStatus: 'DUE' as const,
        activationFeeFromBalance: 0n,
      }),
    },
  }));
}, 120_000);
afterAll(async () => bench.close());

const OURS: Array<[string, string]> = [
  ['createCashTopup', '/topups/cash'],
  ['activateMedia', '/media/activations'],
  ['takeDeposit', '/media/{media_id}/deposit'],
];

describe('mêmes chemins, mêmes méthodes, mêmes preuves que le contrat', () => {
  it.each(OURS)('%s : POST %s est une opération x-edge-available du contrat', (id, path) => {
    const operation = openapi.paths[path]?.post;
    expect(operation?.operationId).toBe(id);
    expect(operation?.['x-edge-available']).toBe(true);
    expect(SERVED_OPERATION_IDS as readonly string[]).toContain(id);
    expect(Object.keys(operation!.security![0]!).sort()).toEqual([
      'deviceMtls',
      'deviceSignature',
      'deviceToken',
      'staffBearer',
    ]);
  });

  it('aucune route de session de caisse ou de vendeur : 404 (C-005)', async () => {
    for (const path of ['/v1/cash-sessions', '/v1/cash-sessions/x/close', '/v1/vendor-sessions']) {
      expect((await bench.request(device, { path })).status).toBe(404);
    }
  });
});

describe('corps et réponses conformes au schéma', () => {
  const key = () => `${device.serial}:${(seq += 1)}`;

  it('activation avec caution : requête, réponse 201 et DepositState', async () => {
    const media = await seedMedia(bench, { wallet: false });
    const body = {
      channel: 'DESK',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
      deposit_payment: { method: 'CASH', amount: 2000 },
    };
    expect(contractViolations('MediaActivationRequest', body)).toEqual([]);
    const r = await counterRequest(bench, device, {
      path: '/v1/media/activations',
      key: key(),
      body,
    });
    expect(r.status).toBe(201);
    expect(contractViolations('MediaActivationResponse', r.json)).toEqual([]);
    expect(contractViolations('DepositState', (r.json as Loose).deposit)).toEqual([]);
  });

  it('caution : requête, réponse 200 conforme à DepositState', async () => {
    const media = await seedMedia(bench);
    const body = { payment: { method: 'CASH' }, tap: tapOf(media, bench) };
    expect(contractViolations('DepositRequest', body)).toEqual([]);
    const r = await counterRequest(bench, device, {
      path: `/v1/media/${media.mediaId}/deposit`,
      key: key(),
      body,
    });
    expect(r.status).toBe(200);
    expect(contractViolations('DepositState', r.json)).toEqual([]);
  });

  it('recharge : requête, réponse 201 conforme à TopupResult', async () => {
    const media = await seedMedia(bench);
    const body = {
      amount: 1000,
      currency: 'XOF',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
    };
    expect(contractViolations('CashTopupRequest', body)).toEqual([]);
    const r = await counterRequest(bench, device, {
      path: '/v1/topups/cash',
      key: key(),
      epoch: 3,
      body,
    });
    expect(r.status).toBe(201);
    expect(contractViolations('TopupResult', r.json)).toEqual([]);
  });

  it('refus : 401, 403, 409, 422 conformes à Problem', async () => {
    const media = await seedMedia(bench);
    const base = {
      amount: 1000,
      currency: 'XOF',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
    };
    const post = (o: Record<string, unknown>) =>
      counterRequest(bench, device, { path: '/v1/topups/cash', key: key(), epoch: 3, ...o });
    const unauthenticated = await post({ staff: null, body: base });
    const stale = await post({ body: base, epoch: 99 });
    const over = await post({ body: { ...base, amount: 500_001 } });
    const fromBalance = await counterRequest(bench, device, {
      path: `/v1/media/${media.mediaId}/deposit`,
      key: key(),
      body: {},
    });
    expect([unauthenticated.status, stale.status, over.status, fromBalance.status]).toEqual([
      401, 409, 422, 409,
    ]);
    for (const r of [unauthenticated, stale, over, fromBalance]) {
      expect(contractViolations('Problem', r.json)).toEqual([]);
    }
  });
});
