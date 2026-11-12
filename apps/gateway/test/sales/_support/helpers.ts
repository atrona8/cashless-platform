// Aides des suites de vente (WP21) : un terminal de caisse catalogue, sa session de vendeur, des
// requêtes signées prêtes à l'emploi, et la lecture de l'état local (file, chaîne, soldes).
import type { Bench, Bracelet, Response, TestDevice } from './harness';

export interface Till {
  device: TestDevice;
  vendorId: string;
  sessionId: string;
  productId: string;
  seq: number;
}

export async function newTill(b: Bench, price = 500): Promise<Till> {
  const device = await b.newDevice();
  const { vendorId, sessionId } = await b.newVendorSession(device);
  const productId = await b.newProduct(device, price);
  return { device, vendorId, sessionId, productId, seq: 0 };
}

export const keyOf = (till: Till, seq: number): string =>
  `${till.device.serial}:${String(seq).padStart(4, '0')}`;

export function lineFor(till: Till, quantity = 1, price = 500): Record<string, unknown> {
  return { product_id: till.productId, quantity, unit_price: price };
}

export interface PayOptions {
  amount?: number;
  /** Corps complet (remplace tout). */
  body?: Record<string, unknown>;
  tapId?: number | null;
  tap?: Record<string, unknown>;
  lines?: Record<string, unknown>[] | null;
  extra?: Record<string, unknown>;
  seq?: number;
  key?: string;
  epoch?: number | null;
  headers?: Record<string, string>;
  vendorSession?: string | null;
  agent?: import('node:https').Agent;
}

export function paymentBody(till: Till, o: PayOptions): Record<string, unknown> {
  if (o.body) return o.body;
  const amount = o.amount ?? 500;
  const lines = o.lines === undefined ? [lineFor(till, 1, amount)] : o.lines;
  return {
    amount,
    currency: 'XOF',
    occurred_at: new Date().toISOString(),
    ...(o.vendorSession === null ? {} : { vendor_session_id: o.vendorSession ?? till.sessionId }),
    ...(o.tapId === null || o.tapId === undefined ? {} : { tap_id: o.tapId }),
    ...(o.tap ? { tap: o.tap } : {}),
    ...(lines ? { lines } : {}),
    ...o.extra,
  };
}

/** `POST /v1/payments`. Chaque appel prend le numéro suivant du terminal, sauf `seq` ou `key`. */
export async function pay(b: Bench, till: Till, o: PayOptions = {}): Promise<Response> {
  till.seq += 1;
  const key = o.key ?? keyOf(till, o.seq ?? till.seq);
  return b.request(till.device, {
    method: 'POST',
    path: '/v1/payments',
    body: paymentBody(till, o),
    idempotencyKey: key,
    agent: o.agent,
    headers: {
      ...(o.epoch === null ? {} : { 'x-authority-epoch': String(o.epoch ?? 3) }),
      ...o.headers,
    },
  });
}

/** `POST /v1/taps` puis `POST /v1/payments` avec le `tap_id` rendu. */
export async function tapAndPay(
  b: Bench,
  till: Till,
  bracelet: Bracelet,
  counter: number,
  o: PayOptions = {},
): Promise<Response> {
  const tap = await b.request(till.device, {
    method: 'POST',
    path: '/v1/taps',
    body: bracelet.tap(counter),
  });
  if (tap.status !== 200 || tap.json?.tap_id == null)
    throw new Error(`passage refusé : ${tap.status} ${tap.text}`);
  return pay(b, till, { ...o, tapId: tap.json.tap_id as number });
}

export async function reverse(
  b: Bench,
  till: Till,
  transactionId: string,
  o: {
    key?: string;
    epoch?: number | null;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    vendorSession?: string | null;
  } = {},
): Promise<Response> {
  till.seq += 1;
  return b.request(till.device, {
    method: 'POST',
    path: `/v1/payments/${transactionId}/reversal`,
    body: o.body ?? {
      reason: 'INPUT_ERROR',
      occurred_at: new Date().toISOString(),
      ...(o.vendorSession === null ? {} : { vendor_session_id: o.vendorSession ?? till.sessionId }),
    },
    idempotencyKey: o.key ?? keyOf(till, till.seq),
    headers: {
      ...(o.epoch === null ? {} : { 'x-authority-epoch': String(o.epoch ?? 3) }),
      ...o.headers,
    },
  });
}

export interface QueueState {
  head: { last_edge_seq: number; last_chain_hash: string };
  ops: number;
  voids: number;
  idempotency: number;
  nonces: number;
}

/** Ce que prouve « rien d'écrit, aucun numéro consommé » : tête de chaîne, file, registres. */
export async function queueState(b: Bench): Promise<QueueState> {
  const head = (
    await b.q<{ last_edge_seq: string; last_chain_hash: Buffer }>(
      'SELECT last_edge_seq, last_chain_hash FROM edge_chain_head',
    )
  )[0]!;
  const count = async (sql: string): Promise<number> =>
    Number((await b.q<{ n: string }>(sql))[0]!.n);
  return {
    head: {
      last_edge_seq: Number(head.last_edge_seq),
      last_chain_hash: head.last_chain_hash.toString('hex'),
    },
    ops: await count('SELECT count(*) AS n FROM edge_op'),
    voids: await count("SELECT count(*) AS n FROM edge_op WHERE type = 'VOID'"),
    idempotency: await count('SELECT count(*) AS n FROM edge_idempotency'),
    nonces: await count('SELECT count(*) AS n FROM edge_device_nonce'),
  };
}

/** Solde effectif du portefeuille (central + deltas locaux). */
export async function balanceOf(b: Bench, walletId: string): Promise<number> {
  const rows = await b.q<{ total: string }>(
    `SELECT (w.central_paid + w.central_promo
             + COALESCE((SELECT sum(paid_delta + promo_delta) FROM edge_op_delta d
                          WHERE d.wallet_id = w.wallet_id AND d.edge_seq > w.applied_edge_seq), 0)
            )::text AS total FROM edge_wallet w WHERE w.wallet_id = $1`,
    [walletId],
  );
  return Number(rows[0]!.total);
}
