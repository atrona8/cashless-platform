// WP22 / T102 : une preuve par ligne du tableau « Opérations refusées pendant EDGE » qui concerne
// le guichet (`gateway-served-operations.md`) : `409 DEBIT_AUTHORITY_EDGE`, `retryable: false`, sans
// `edge_base_url`, rien d'écrit, aucun numéro consommé ; plus l'absence de garde de caisse
// exemptée (C-005) et le refus hors état `ACTIVE`.
import {
  counterRequest,
  opCount,
  readyBench,
  seedMedia,
  tapOf,
  type Bench,
  type TestDevice,
} from './_support/bench';
import type { Loose } from '../support/loose';

let bench: Bench;
let device: TestDevice;
let seq = 0;
const key = () => `${device.serial}:${(seq += 1)}`;

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

const maxSeq = async () =>
  Number(
    (await bench.q<{ n: string }>('SELECT coalesce(max(edge_seq),0) AS n FROM edge_op'))[0]!.n,
  );

async function expectEdgeRefusal(r: { status: number; json: Loose }, before: [number, number]) {
  expect(r.status).toBe(409);
  expect(r.json).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', retryable: false });
  expect(r.json.edge_base_url).toBeUndefined();
  expect([await opCount(bench), await maxSeq()]).toEqual(before);
}
const snapshot = async (): Promise<[number, number]> => [await opCount(bench), await maxSeq()];

describe('ligne « Caution prélevée sur le solde (FROM_BALANCE) »', () => {
  it('takeDeposit sans paiement', async () => {
    const media = await seedMedia(bench);
    const before = await snapshot();
    const r = await counterRequest(bench, device, {
      path: `/v1/media/${media.mediaId}/deposit`,
      key: key(),
      body: { tap: tapOf(media, bench) },
    });
    await expectEdgeRefusal(r, before);
  });

  it('activateMedia sans paiement en espèces de la caution', async () => {
    const media = await seedMedia(bench, { wallet: false });
    const before = await snapshot();
    const r = await counterRequest(bench, device, {
      path: '/v1/media/activations',
      key: key(),
      body: {
        channel: 'DESK',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    await expectEdgeRefusal(r, before);
  });
});

describe('ligne « Frais d’activation prélevés sur le solde »', () => {
  it('activateMedia : DEBIT_AUTHORITY_EDGE', async () => {
    (bench.terms.current as unknown) = {
      lookup: async () => ({
        depositAmount: 0n,
        depositStatus: 'NONE' as const,
        activationFeeFromBalance: 300n,
      }),
    };
    const media = await seedMedia(bench, { wallet: false });
    const before = await snapshot();
    const r = await counterRequest(bench, device, {
      path: '/v1/media/activations',
      key: key(),
      body: {
        channel: 'DESK',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    await expectEdgeRefusal(r, before);
  });
});

describe('ligne « Ouverture, relève, fermeture de session de caisse ou de vendeur »', () => {
  it('routes absentes de la passerelle : 404, aucune exemption de garde de caisse (C-005)', async () => {
    for (const path of [
      '/v1/cash-sessions',
      '/v1/cash-sessions/1/handover',
      '/v1/cash-sessions/1/close',
      '/v1/vendor-sessions',
    ]) {
      const r = await counterRequest(bench, device, { path, key: key(), body: {} });
      expect(r.status).toBe(404);
    }
  });

  it('la recharge ne s’exempte pas de la session de caisse : sans session répliquée, rien d’écrit', async () => {
    const lone = await bench.newDevice({ appMode: 'TOPUP_DESK' });
    const media = await seedMedia(bench);
    const before = await snapshot();
    const r = await counterRequest(bench, lone, {
      path: '/v1/topups/cash',
      key: `${lone.serial}:1`,
      epoch: 3,
      body: {
        amount: 100,
        currency: 'XOF',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    // Jeton valide (non expiré) mais aucune session : refus d'état, jamais exempté.
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await snapshot()).toEqual(before);
  });
});

describe('autorité hors ACTIVE : aucun guichet servi', () => {
  it('recharge refusée quand la passerelle n’est plus ACTIVE, rien d’écrit', async () => {
    const media = await seedMedia(bench);
    await bench.q(`UPDATE edge_authority SET state = 'STALE'`);
    const before = await snapshot();
    const r = await counterRequest(bench, device, {
      path: '/v1/topups/cash',
      key: key(),
      epoch: 3,
      body: {
        amount: 100,
        currency: 'XOF',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
    expect(r.status).toBe(409);
    expect((r.json as Loose).code).toMatch(/^DEBIT_AUTHORITY_|^STALE_AUTHORITY/);
    expect(await snapshot()).toEqual(before);
    await bench.q(`UPDATE edge_authority SET state = 'ACTIVE'`);
  });
});
