// Faux serveur Stripe local (127.0.0.1) : sessions, PaymentIntent avec `latest_charge` développé, expiration,
// balance transactions paginées, erreurs `{ error: { type, code, message } }`. Refuse (400) tout POST sans
// `Idempotency-Key`. Aucun hôte externe.
import type { ServerResponse } from 'node:http';
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';

export type Json = Record<string, unknown>;

export interface FakeStripe extends FakeServer {
  sessions: Map<string, Json>;
  intents: Map<string, Json>;
  balanceTransactions: Json[];
  /** Les n prochaines réponses sont des 503 (nouvel essai). */
  /** Vrai : la liste des sessions ignore `payment_intent` (serveur défaillant). */
  ignoreFilters: boolean;
  failNext(n: number): void;
  /** La prochaine réponse est cette erreur Stripe. */
  rejectNext(status: number, type: string, code: string): void;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function stripeError(res: ServerResponse, status: number, type: string, code: string): void {
  reply(res, status, { error: { type, code, message: 'texte libre de Stripe' } });
}

export async function startFakeStripe(): Promise<FakeStripe> {
  const sessions = new Map<string, Json>();
  const intents = new Map<string, Json>();
  const balanceTransactions: Json[] = [];
  let failures = 0;
  let rejection: { status: number; type: string; code: string } | null = null;

  const handler = (req: RecordedRequest, res: ServerResponse): void => {
    if (rejection !== null) {
      const { status, type, code } = rejection;
      rejection = null;
      stripeError(res, status, type, code);
      return;
    }
    if (failures > 0) {
      failures -= 1;
      stripeError(res, 503, 'api_error', 'temporarily_unavailable');
      return;
    }
    if (req.method === 'POST' && !req.headers['idempotency-key']) {
      stripeError(res, 400, 'invalid_request_error', 'idempotency_key_missing');
      return;
    }
    const url = new URL(req.path, 'http://fake.invalid');
    const path = url.pathname;
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const form = new URLSearchParams(req.body.toString('utf8'));
      const id = `cs_test_${sessions.size + 1}`;
      const session: Json = {
        id,
        status: 'open',
        payment_status: 'unpaid',
        amount_total: Number(form.get('line_items[0][price_data][unit_amount]')),
        currency: 'xof',
        client_reference_id: form.get('client_reference_id'),
        payment_intent: null,
        url: `https://checkout.stripe.invalid/c/pay/${id}`,
        expires_at: Number(form.get('expires_at')),
      };
      sessions.set(id, session);
      reply(res, 200, session);
      return;
    }
    const expire = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(path);
    if (req.method === 'POST' && expire) {
      const session = sessions.get(expire[1]!);
      if (!session) return stripeError(res, 404, 'invalid_request_error', 'resource_missing');
      if (session.status !== 'open')
        return stripeError(res, 400, 'invalid_request_error', 'checkout_session_not_open');
      // `refuseToExpire` : réponse 200 dont la session n'est pas expirée (corps à ne pas croire sur parole).
      if (!session.refuseToExpire) session.status = 'expired';
      reply(res, 200, session);
      return;
    }
    if (req.method === 'GET' && path === '/v1/checkout/sessions') {
      const pi = url.searchParams.get('payment_intent');
      const limit = Number(url.searchParams.get('limit'));
      const data = [...sessions.values()]
        .filter((x) => server.ignoreFilters || x.payment_intent === pi)
        .slice(0, limit);
      reply(res, 200, { object: 'list', data, has_more: false });
      return;
    }
    const one = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const session = sessions.get(one[1]!);
      if (!session) return stripeError(res, 404, 'invalid_request_error', 'resource_missing');
      reply(res, 200, session);
      return;
    }
    const intent = /^\/v1\/payment_intents\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && intent) {
      const found = intents.get(intent[1]!);
      if (!found) return stripeError(res, 404, 'invalid_request_error', 'resource_missing');
      const expanded = url.searchParams.getAll('expand[]').includes('latest_charge');
      reply(res, 200, expanded ? found : { ...found, latest_charge: 'ch_test_1' });
      return;
    }
    if (req.method === 'GET' && path === '/v1/balance_transactions') {
      const gte = Number(url.searchParams.get('created[gte]'));
      const lte = Number(url.searchParams.get('created[lte]'));
      const limit = Number(url.searchParams.get('limit'));
      const after = url.searchParams.get('starting_after');
      const rows = balanceTransactions.filter(
        (r) => (r.created as number) >= gte && (r.created as number) <= lte,
      );
      const start = after === null ? 0 : rows.findIndex((r) => r.id === after) + 1;
      const data = rows.slice(start, start + limit);
      reply(res, 200, { object: 'list', data, has_more: start + limit < rows.length });
      return;
    }
    stripeError(res, 404, 'invalid_request_error', 'route_inconnue');
  };

  const server = (await startFakeServer(handler)) as FakeStripe;
  return Object.assign(server, {
    ignoreFilters: false,
    sessions,
    intents,
    balanceTransactions,
    failNext: (n: number) => {
      failures = n;
    },
    rejectNext: (status: number, type: string, code: string) => {
      rejection = { status, type, code };
    },
  });
}
