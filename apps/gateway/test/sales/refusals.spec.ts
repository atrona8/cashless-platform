// WP21 / T096 : un test par ligne du tableau des refus. Chaque refus : rien d'écrit, aucun numéro
// consommé (tête de chaîne, file, registres et nonces inchangés).
import { randomUUID } from 'node:crypto';
import {
  UNAVAILABLE_OPERATIONS,
  unavailableDuringEdge,
} from '../../src/operations/sales/unavailable-operations';
import { makeBench, type Bench } from './_support/harness';
import { newTill, pay, queueState, type Till } from './_support/helpers';
import type { Loose } from '../support/loose';

let b: Bench;
let till: Till;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  till = await newTill(b);
});
afterAll(async () => b.close());
afterEach(async () => b.setAuthority({ state: 'ACTIVE', epoch: 3, highest_epoch_seen: 3 }));

async function nothingWritten(run: () => Promise<{ status: number; json: Loose }>) {
  const before = await queueState(b);
  const res = await run();
  const after = await queueState(b);
  expect(after.head).toEqual(before.head);
  expect(after.ops).toBe(before.ops);
  expect(after.idempotency).toBe(before.idempotency);
  return res;
}

describe('refus pendant EDGE (QR client, restitution)', () => {
  it('paiement par QR client : 409 DEBIT_AUTHORITY_EDGE, non réessayable, sans edge_base_url', async () => {
    const res = await nothingWritten(() =>
      pay(b, till, { extra: { customer_qr_token: 'a'.repeat(24) } }),
    );
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      code: 'DEBIT_AUTHORITY_EDGE',
      retryable: false,
      authority_epoch: 3,
    });
    expect(res.json).not.toHaveProperty('edge_base_url');
  });

  it('releaseMedia : 409 DEBIT_AUTHORITY_EDGE, non réessayable, sans edge_base_url, époque présente', async () => {
    const res = await nothingWritten(() =>
      b.request(till.device, {
        method: 'POST',
        path: `/v1/media/${randomUUID()}/release`,
        body: {},
        idempotencyKey: `${till.device.serial}:0900`,
      }),
    );
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', retryable: false });
    expect(res.json!.authority_epoch).toBe(3);
    expect(res.json).not.toHaveProperty('edge_base_url');
  });

  it('FROM_BALANCE (caution et frais d’activation) : table unique, mêmes codes pour WP22', () => {
    for (const kind of ['DEPOSIT_FROM_BALANCE', 'ACTIVATION_FEE_FROM_BALANCE'] as const) {
      const problem = unavailableDuringEdge(kind, 3);
      expect(problem.code).toBe('DEBIT_AUTHORITY_EDGE');
      expect(problem.status).toBe(409);
      expect(problem.extensions).toEqual({ authority_epoch: 3, retryable: false });
      expect(problem.extensions).not.toHaveProperty('edge_base_url');
    }
    expect(UNAVAILABLE_OPERATIONS.DEPOSIT_FROM_BALANCE.where).toEqual([
      'activateMedia',
      'takeDeposit',
    ]);
    expect(UNAVAILABLE_OPERATIONS.ACTIVATION_FEE_FROM_BALANCE.where).toEqual(['activateMedia']);
  });
});

describe('refus selon l’état d’autorité : jamais un edge_op', () => {
  const cases: [string, string, string | undefined][] = [
    ['ARMED', 'CONFLICT_STATE', 'GATEWAY_NOT_AUTHORITY'],
    ['STANDBY', 'CONFLICT_STATE', 'GATEWAY_NOT_AUTHORITY'],
    ['RELEASING', 'DEBIT_AUTHORITY_MOVING', undefined],
    ['GRANTED_PENDING', 'DEBIT_AUTHORITY_MOVING', undefined],
    ['STALE', 'STALE_AUTHORITY_EPOCH', undefined],
    ['REVOKED', 'STALE_AUTHORITY_EPOCH', undefined],
  ];
  it.each(cases)('paiement en %s : %s, rien d’écrit, aucun numéro', async (state, code, detail) => {
    await b.setAuthority({ state });
    const bracelet = await b.newBracelet();
    const res = await nothingWritten(() => pay(b, till, { tap: bracelet.tap(1) }));
    expect(res.status).toBe(409);
    expect(res.json!.code).toBe(code);
    if (detail) expect(res.json!.detail).toBe(detail);
    expect(res.json!.authority_epoch).toBeDefined();
    const taps = await b.q('SELECT 1 FROM edge_tap WHERE token_hash = $1', [
      Buffer.from(bracelet.tokenHash, 'hex'),
    ]);
    expect(taps).toHaveLength(0);
  });

  it.each(['ARMED', 'RELEASING', 'STALE'])('annulation en %s : rien d’écrit', async (state) => {
    await b.setAuthority({ state });
    const res = await nothingWritten(() =>
      b.request(till.device, {
        method: 'POST',
        path: `/v1/payments/${randomUUID()}/reversal`,
        body: {
          reason: 'OTHER',
          occurred_at: new Date().toISOString(),
          vendor_session_id: till.sessionId,
        },
        idempotencyKey: `${till.device.serial}:0800`,
        headers: { 'x-authority-epoch': '3' },
      }),
    );
    expect(res.status).toBe(409);
  });

  it('époque de la requête différente de celle de la passerelle : STALE_AUTHORITY_EPOCH, rien d’écrit', async () => {
    const bracelet = await b.newBracelet();
    const res = await nothingWritten(() => pay(b, till, { tap: bracelet.tap(1), epoch: 2 }));
    expect(res.json!.code).toBe('STALE_AUTHORITY_EPOCH');
  });

  it('en-tête X-Authority-Epoch absent : refus nommé, rien d’écrit', async () => {
    const bracelet = await b.newBracelet();
    const res = await nothingWritten(() => pay(b, till, { tap: bracelet.tap(1), epoch: null }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('routes qui restent absentes', () => {
  it.each([
    ['POST', '/v1/cash-sessions'],
    ['POST', '/v1/vendor-sessions'],
    ['POST', '/v1/vendors/login'],
    ['DELETE', '/v1/payments/x'],
  ])('%s %s : 404, rien d’écrit', async (method, path) => {
    const res = await nothingWritten(() =>
      b.request(till.device, {
        method,
        path,
        body: {},
        idempotencyKey: `${till.device.serial}:0700`,
      }),
    );
    expect(res.status).toBe(404);
  });

  it('les lectures restent servies hors ACTIVE (sauf REVOKED) : getPayment répond', async () => {
    await b.setAuthority({ state: 'RELEASING' });
    const res = await b.request(till.device, { path: `/v1/payments/${randomUUID()}` });
    expect(res.status).toBe(404);
    expect(res.json!.code).toBe('NOT_FOUND');
  });
});
