// Faux serveur Wave (checkout, recherche, expiration, transactions), formes publiées sur docs.wave.com.
// Local seulement (127.0.0.1) : jamais un hôte externe.
import { createHmac } from 'node:crypto';
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';

export type WaveSession = Record<string, unknown>;

export interface FakeWave {
  server: FakeServer;
  /** Sessions connues, par identifiant. */
  sessions: Map<string, WaveSession>;
  /** Pages du relevé, par date puis par rang de page. */
  transactions: Map<string, Array<Record<string, unknown>[]>>;
  /** `hang` : la création ne répond pas (délai) mais la session est enregistrée. */
  behaviour: {
    hangCreate: boolean;
    expireStatus: number;
    authOk: boolean;
    /** Statut d'échec de la création (500, 429) : la session est enregistrée sauf `createRecords` faux. */
    createStatus: number | null;
    createRecords: boolean;
    /** Recherche trop large : rend toute session dont la référence commence par celle demandée. */
    looseSearch: boolean;
    /** GET d'une session : rend un autre identifiant. */
    wrongId: boolean;
  };
  /** Secret de signature des requêtes : si posé, chaque requête doit porter une `Wave-Signature` valide. */
  signingSecret: string | null;
  badSignatures: number;
  creates(): RecordedRequest[];
  close(): Promise<void>;
}

export const WAVE_TEST_API_KEY = 'wave_sn_API_test_key_0001';

/** Session au format publié (champs de docs.wave.com/checkout). */
export function waveSession(over: WaveSession = {}): WaveSession {
  return {
    id: 'cos-18qq25rgr100a',
    amount: '1000',
    checkout_status: 'open',
    client_reference: 'topup-1',
    currency: 'XOF',
    error_url: 'https://example.com/error',
    last_payment_error: null,
    business_name: 'Test',
    payment_status: 'processing',
    transaction_id: null,
    aggregated_merchant_id: null,
    success_url: 'https://example.com/success',
    wave_launch_url: 'https://pay.wave.com/c/cos-18qq25rgr100a?a=1000&c=XOF&m=Test',
    when_completed: null,
    when_created: '2026-11-26T10:00:00Z',
    when_expires: '2026-11-27T10:00:00Z',
    ...over,
  };
}

export async function startFakeWave(): Promise<FakeWave> {
  let seq = 0;
  const fake: FakeWave = {
    server: undefined as unknown as FakeServer,
    sessions: new Map(),
    transactions: new Map(),
    behaviour: {
      hangCreate: false,
      expireStatus: 200,
      authOk: true,
      createStatus: null,
      createRecords: true,
      looseSearch: false,
      wrongId: false,
    },
    signingSecret: null,
    badSignatures: 0,
    creates: () =>
      fake.server.requests.filter((r) => r.method === 'POST' && r.path === '/v1/checkout/sessions'),
    close: () => fake.server.close(),
  };
  const signatureOk = (req: RecordedRequest): boolean => {
    if (fake.signingSecret === null) return true;
    const header = String(req.headers['wave-signature'] ?? '');
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
    if (m === null) return false;
    const expected = createHmac('sha256', fake.signingSecret)
      .update(m[1]!)
      .update(req.body)
      .digest('hex');
    return expected === m[2];
  };
  fake.server = await startFakeServer((req, res) => {
    const send = (status: number, body?: unknown): void => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (!fake.behaviour.authOk || req.headers.authorization !== `Bearer ${WAVE_TEST_API_KEY}`)
      return send(401, { code: 'invalid-auth', message: 'Invalid API key' });
    if (!signatureOk(req)) {
      fake.badSignatures += 1;
      return send(401, { code: 'invalid-signature', message: 'Bad signature' });
    }
    const url = new URL(req.path, 'http://x');
    const p = url.pathname;
    if (req.method === 'POST' && p === '/v1/checkout/sessions') {
      const body = JSON.parse(req.body.toString('utf8')) as Record<string, string>;
      seq += 1;
      const s = waveSession({
        id: `cos-fake${seq}`,
        amount: body.amount,
        currency: body.currency,
        client_reference: body.client_reference,
        success_url: body.success_url,
        error_url: body.error_url,
        wave_launch_url: `https://pay.wave.com/c/cos-fake${seq}`,
        when_created: new Date(Date.UTC(2026, 10, 26, 10, 0, seq)).toISOString(),
      });
      if (fake.behaviour.createRecords) fake.sessions.set(String(s.id), s);
      if (fake.behaviour.createStatus !== null)
        return send(fake.behaviour.createStatus, { code: 'server-error', message: 'x' });
      if (fake.behaviour.hangCreate) return; // aucune réponse : délai côté client
      return send(200, s);
    }
    if (req.method === 'GET' && p === '/v1/checkout/sessions/search') {
      const ref = url.searchParams.get('client_reference');
      return send(200, {
        result: [...fake.sessions.values()].filter((s) =>
          fake.behaviour.looseSearch
            ? String(s.client_reference).startsWith(String(ref))
            : s.client_reference === ref,
        ),
      });
    }
    const one = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(p);
    if (one !== null) {
      const s = fake.sessions.get(decodeURIComponent(one[1]!));
      if (s === undefined) return send(404, { code: 'not-found', message: 'Not found' });
      if (req.method === 'GET' && one[2] === undefined)
        return send(200, fake.behaviour.wrongId ? { ...s, id: 'cos-autre' } : s);
      if (req.method === 'POST' && one[2] !== undefined) {
        if (fake.behaviour.expireStatus === 200) s.checkout_status = 'expired';
        return send(
          fake.behaviour.expireStatus,
          fake.behaviour.expireStatus === 200
            ? undefined
            : {
                code: 'checkout-session-not-open',
                message: 'conflict',
              },
        );
      }
    }
    if (req.method === 'GET' && p === '/v1/transactions') {
      const pages = fake.transactions.get(url.searchParams.get('date') ?? '') ?? [[]];
      const after = url.searchParams.get('after');
      const index = after === null ? 0 : Number(after.replace('cursor-', ''));
      const last = index >= pages.length - 1;
      return send(200, {
        page_info: {
          start_cursor: null,
          end_cursor: last ? null : `cursor-${index + 1}`,
          has_next_page: !last,
        },
        date: url.searchParams.get('date'),
        items: pages[index] ?? [],
      });
    }
    return send(404, { code: 'not-found', message: 'Not found' });
  });
  return fake;
}
