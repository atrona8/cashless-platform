// WP19 / T087 : idempotence locale. Même clé et même empreinte : même réponse ; autre empreinte :
// IDEMPOTENCY_KEY_REUSED (statut du contrat : 409). Le registre s'écrit dans la transaction de
// l'opération et s'annule avec elle.
import { randomUUID } from 'node:crypto';
import { GatewayTx } from '../../src/db/gateway-tx';
import { ProblemException } from '../../src/device-proofs/problem';
import { IdempotencyService, requestFingerprint } from '../../src/device/idempotency.service';
import { makeBench, type Bench } from './_support/harness';

let b: Bench;
let tx: GatewayTx;
const service = new IdempotencyService();

beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  tx = new GatewayTx(b.db.pool);
});
afterAll(async () => b.close());

const fp = (body: unknown, device = 'dev', path = '/v1/payments') =>
  requestFingerprint('POST', path, device, body);

async function perform(deviceId: string, key: string, body: unknown, response: unknown) {
  return tx.run(async (client) => {
    const found = await service.lookup(client, deviceId, key, fp(body, deviceId));
    if (found.hit) return { replayed: true, response: found.response, status: found.statusCode };
    await service.record(client, {
      deviceId,
      key,
      fingerprint: fp(body, deviceId),
      statusCode: 200,
      response,
      at: b.clock.now(),
    });
    return { replayed: false, response, status: 200 };
  });
}

describe('empreinte de requête', () => {
  it('insensible à l’ordre des clés du corps, sensible au reste', () => {
    expect(fp({ a: 1, b: [2, 3] }).equals(fp({ b: [2, 3], a: 1 }))).toBe(true);
    expect(fp({ a: 1 }).equals(fp({ a: 2 }))).toBe(false);
    expect(fp({ a: 1 }, 'dev', '/v1/a').equals(fp({ a: 1 }, 'dev', '/v1/b'))).toBe(false);
    expect(fp({ a: 1 }, 'dev1').equals(fp({ a: 1 }, 'dev2'))).toBe(false);
    expect(fp(undefined).equals(fp(null))).toBe(true);
  });
});

describe('lookup / record', () => {
  it('même clé, même empreinte : même réponse rendue, sans nouvelle ligne', async () => {
    const device = randomUUID();
    const first = await perform(device, 'T-1:1', { amount: 100 }, { id: 'A' });
    expect(first.replayed).toBe(false);
    const again = await perform(device, 'T-1:1', { amount: 100 }, { id: 'AUTRE' });
    expect(again).toEqual({ replayed: true, response: { id: 'A' }, status: 200 });
    const rows = await b.q('SELECT 1 FROM edge_idempotency WHERE device_id = $1', [device]);
    expect(rows).toHaveLength(1);
  });

  it('même clé, autre empreinte : IDEMPOTENCY_KEY_REUSED (409 du contrat), réponse d’origine intacte', async () => {
    const device = randomUUID();
    await perform(device, 'T-2:1', { amount: 100 }, { id: 'A' });
    const failure = await perform(device, 'T-2:1', { amount: 999 }, { id: 'B' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProblemException);
    expect((failure as ProblemException).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((failure as ProblemException).status).toBe(409);
    expect((await perform(device, 'T-2:1', { amount: 100 }, null)).response).toEqual({ id: 'A' });
  });

  it('la clé est liée au terminal : une autre clé de terminal ne reçoit jamais la réponse d’un autre', async () => {
    const one = randomUUID();
    const two = randomUUID();
    await perform(one, 'T-3:1', { amount: 100 }, { id: 'A' });
    const other = await perform(two, 'T-3:1', { amount: 100 }, { id: 'B' });
    expect(other.replayed).toBe(false);
    expect(other.response).toEqual({ id: 'B' });
  });

  it('le registre s’annule avec l’opération (même transaction)', async () => {
    const device = randomUUID();
    await tx
      .run(async (client) => {
        await service.lookup(client, device, 'T-4:1', fp({ a: 1 }, device));
        await service.record(client, {
          deviceId: device,
          key: 'T-4:1',
          fingerprint: fp({ a: 1 }, device),
          statusCode: 200,
          response: { ok: true },
          at: b.clock.now(),
        });
        throw new Error('échec de l’effet');
      })
      .catch(() => undefined);
    expect(await b.q('SELECT 1 FROM edge_idempotency WHERE device_id = $1', [device])).toHaveLength(0);
  });

  it('deux requêtes simultanées de même clé : une seule exécution, l’autre rend la réponse', async () => {
    const device = randomUUID();
    let effects = 0;
    const run = () =>
      tx.run(async (client) => {
        const found = await service.lookup(client, device, 'T-5:1', fp({ n: 1 }, device));
        if (found.hit) return 'replayed';
        effects += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        await service.record(client, {
          deviceId: device,
          key: 'T-5:1',
          fingerprint: fp({ n: 1 }, device),
          statusCode: 200,
          response: { n: effects },
          at: b.clock.now(),
        });
        return 'executed';
      });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => r === 'executed')).toHaveLength(1);
    expect(effects).toBe(1);
  });

  it('un refus final (4xx) est rejoué tel quel', async () => {
    const device = randomUUID();
    await tx.run(async (client) => {
      await service.record(client, {
        deviceId: device,
        key: 'T-6:1',
        fingerprint: fp({ a: 1 }, device),
        statusCode: 422,
        response: { code: 'INSUFFICIENT_FUNDS' },
        edgeSeq: null,
        at: b.clock.now(),
      });
    });
    const found = await tx.run((client) => service.lookup(client, device, 'T-6:1', fp({ a: 1 }, device)));
    expect(found).toEqual({ hit: true, statusCode: 422, response: { code: 'INSUFFICIENT_FUNDS' }, edgeSeq: null });
  });
});
