// WP21 / T097 : réponses de createTap, createPayment, getPayment, reversePayment valides contre
// `openapi.yaml` (200, 201, 4xx, 409), mêmes codes et mêmes statuts que le central.
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../device/_support/contract-schema';
import { makeBench, type Bench } from './_support/harness';
import { newTill, pay, reverse, tapAndPay, type Till } from './_support/helpers';

let b: Bench;
let till: Till;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  till = await newTill(b);
});
afterAll(async () => b.close());

// Le central ajoute `available_balance` et `currency` à `INSUFFICIENT_FUNDS` (apps/api/src/payments,
// l.324) et la passerelle fait de même ; le schéma `Problem` ne les déclare pas (seul un exemple de
// `openapi.yaml` les montre) : écart du contrat, signalé, pas inventé ici.
const KNOWN_EXTENSIONS = ['available_balance', 'currency'];
const problem = (res: {
  json: Record<string, unknown> | null;
  headers: Record<string, unknown>;
}) => {
  expect(String(res.headers['content-type'])).toContain('application/problem+json');
  const violations = contractViolations('Problem', res.json).filter(
    (v) => !KNOWN_EXTENSIONS.some((name) => v === `Problem.${name} : hors contrat`),
  );
  expect(violations).toEqual([]);
};

it('createTap 200 : TapResponse', async () => {
  const bracelet = await b.newBracelet();
  const res = await b.request(till.device, {
    method: 'POST',
    path: '/v1/taps',
    body: bracelet.tap(1),
  });
  expect(res.status).toBe(200);
  expect(contractViolations('TapResponse', res.json)).toEqual([]);
});

it('createTap 400 : Problem', async () => {
  const res = await b.request(till.device, { method: 'POST', path: '/v1/taps', body: { x: 1 } });
  expect(res.status).toBe(400);
  problem(res);
});

it('createPayment 201 et getPayment 200 : PaymentResult', async () => {
  const bracelet = await b.newBracelet();
  const res = await tapAndPay(b, till, bracelet, 1, { amount: 500 });
  expect(res.status).toBe(201);
  expect(contractViolations('PaymentResult', res.json)).toEqual([]);
  const got = await b.request(till.device, { path: `/v1/payments/${res.json!.transaction_id}` });
  expect(got.status).toBe(200);
  expect(contractViolations('PaymentResult', got.json)).toEqual([]);
});

it('createPayment 400, 409, 422 : Problem', async () => {
  const bad = await pay(b, till, { body: { amount: 'x' } });
  expect(bad.status).toBe(400);
  problem(bad);
  const bracelet = await b.newBracelet();
  const stale = await pay(b, till, { tap: bracelet.tap(1), epoch: 2 });
  expect(stale.status).toBe(409);
  problem(stale);
  const qr = await pay(b, till, { extra: { customer_qr_token: 'a'.repeat(24) } });
  expect(qr.status).toBe(409);
  problem(qr);
  const poor = await b.newBracelet({ paid: 100 });
  const refused = await pay(b, till, { tap: poor.tap(1), amount: 500 });
  expect(refused.status).toBe(422);
  problem(refused);
});

it('getPayment 404 : Problem', async () => {
  const res = await b.request(till.device, { path: `/v1/payments/${randomUUID()}` });
  expect(res.status).toBe(404);
  problem(res);
});

it('reversePayment 201, 403, 404, 409 : PaymentResult ou Problem', async () => {
  const bracelet = await b.newBracelet();
  const sale = await tapAndPay(b, till, bracelet, 1, { amount: 500 });
  const id = sale.json!.transaction_id as string;
  const denied = await reverse(b, till, id, { headers: { 'x-approval-token': 'x.y.z' } });
  expect(denied.status).toBe(403);
  problem(denied);
  const ok = await reverse(b, till, id);
  expect(ok.status).toBe(201);
  expect(contractViolations('PaymentResult', ok.json)).toEqual([]);
  const again = await reverse(b, till, id);
  expect(again.status).toBe(409);
  problem(again);
  const missing = await reverse(b, till, randomUUID());
  expect(missing.status).toBe(404);
  problem(missing);
});
