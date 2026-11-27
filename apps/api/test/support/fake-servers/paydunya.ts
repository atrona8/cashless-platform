// Faux serveur PayDunya local, aux formes des SDK officiels (response_code, response_text, token, status,
// invoice.total_amount, custom_data). Aucun hôte externe.
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';

export interface FakePayDunyaOptions {
  /** `00` : création acceptée ; autre : refus. */
  createCode?: string;
  token?: string;
  checkoutUrl?: string;
  /** Réponse de confirmation programmable. */
  confirm?: Record<string, unknown>;
}

export interface FakePayDunya extends FakeServer {
  options: FakePayDunyaOptions;
  /** URL de base à placer dans `pspBases.paydunya`. */
  base: string;
}

export async function startFakePayDunya(options: FakePayDunyaOptions = {}): Promise<FakePayDunya> {
  const state: FakePayDunyaOptions = { ...options };
  const send = (res: import('node:http').ServerResponse, body: unknown) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const server = await startFakeServer((req: RecordedRequest, res) => {
    if (req.method === 'POST' && req.path === '/api/v1/checkout-invoice/create') {
      const code = state.createCode ?? '00';
      if (code !== '00') return send(res, { response_code: code, response_text: 'refus' });
      return send(res, {
        response_code: '00',
        response_text: state.checkoutUrl ?? 'https://paydunya.example/checkout/abc',
        token: state.token ?? 'tok_abc123',
      });
    }
    if (req.method === 'GET' && req.path.startsWith('/api/v1/checkout-invoice/confirm/'))
      return send(
        res,
        state.confirm ?? {
          response_code: '00',
          response_text: 'ok',
          status: 'pending',
          invoice: { total_amount: 5000 },
          custom_data: { psp_topup_id: 'topup-1' },
        },
      );
    res.statusCode = 404;
    res.end('{}');
  });
  return Object.assign(server, { options: state, base: `${server.url}/api/v1` });
}
