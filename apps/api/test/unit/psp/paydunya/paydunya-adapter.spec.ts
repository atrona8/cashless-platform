// Adaptateur PayDunya (WP06) : création, signal (D2), confirmation, borne OP PayDunya, aucun secret dans les erreurs.
import { createHash, timingSafeEqual } from 'node:crypto';
import { PayDunyaPspAdapter } from '../../../../src/psp/paydunya/paydunya-adapter';
import { PspHttpClient } from '../../../../src/psp/http/psp-http';
import { PspProviderError } from '../../../../src/psp/psp-errors';
import type { PspSecrets } from '../../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../../src/psp/secret';
import type { PspInitiateRequest } from '../../../../src/psp/psp.types';
import { startFakeServer } from '../../../support/fake-servers/http-fake';
import { startFakePayDunya, type FakePayDunya } from '../../../support/fake-servers/paydunya';

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const MASTER = 'master-key-secret-value';
const PRIVATE = 'private-key-secret-value';
const TOKEN_KEY = 'api-token-secret-value';
const sha512 = (value: string): string => createHash('sha512').update(value, 'utf8').digest('hex');

const secrets: PspSecrets = {
  credentials: {
    provider: 'PAYDUNYA',
    masterKey: Secret.of(MASTER),
    privateKey: Secret.of(PRIVATE),
    token: Secret.of(TOKEN_KEY),
  },
  notification: { current: Secret.of(MASTER), previous: null, previousValidUntil: null },
};

const request: PspInitiateRequest = {
  pspTopupId: 'topup-1',
  method: 'CARD',
  amount: 5000n,
  currency: 'XOF',
  payerMsisdn: null,
  returnUrl: 'https://app.example/retour',
  notificationUrl: 'https://api.example/webhooks/paydunya',
};

function form(fields: Record<string, string>): Buffer {
  return Buffer.from(new URLSearchParams(fields).toString(), 'utf8');
}
const NOW = new Date('2026-11-26T12:00:00Z');
function ipn(over: Record<string, string> = {}, hash = sha512(MASTER)): Buffer {
  return form({
    'data[hash]': hash,
    'data[status]': 'completed',
    'data[invoice][token]': 'tok_abc123',
    'data[invoice][total_amount]': '999999',
    'data[custom_data][psp_topup_id]': 'topup-1',
    ...over,
  });
}

describe('PayDunyaPspAdapter', () => {
  let server: FakePayDunya;
  let adapter: PayDunyaPspAdapter;

  beforeEach(async () => {
    server = await startFakePayDunya();
    adapter = new PayDunyaPspAdapter(new PspHttpClient({ pspHttpTimeoutMs: 2000 }), {
      pspBases: { wave: 'x', paydunya: server.base, stripe: 'x' },
    });
  });
  afterEach(async () => {
    await server.close();
  });

  const verify = (rawBody: Buffer, contentType: 'json' | 'form' = 'form', s = secrets) =>
    adapter.verifyNotification({ rawBody, contentType, headers: {}, secrets: s, now: NOW });

  describe('initiate', () => {
    it('en-têtes et corps exacts, REDIRECT, token, échéance +30 min', async () => {
      const before = Date.now();
      const result = await adapter.initiate(request, secrets);
      expect(result.providerPaymentRef).toBe('tok_abc123');
      expect(result.action).toEqual({
        kind: 'REDIRECT',
        url: 'https://paydunya.example/checkout/abc',
      });
      expect(result.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60 * 1000);
      expect(server.requests).toHaveLength(1);
      const sent = server.requests[0]!;
      expect(sent.method).toBe('POST');
      expect(sent.path).toBe('/api/v1/checkout-invoice/create');
      expect(sent.headers['paydunya-master-key']).toBe(MASTER);
      expect(sent.headers['paydunya-private-key']).toBe(PRIVATE);
      expect(sent.headers['paydunya-token']).toBe(TOKEN_KEY);
      expect(sent.headers['content-type']).toContain('application/json');
      expect(JSON.parse(sent.body.toString())).toEqual({
        invoice: { total_amount: 5000, description: 'Recharge' },
        store: { name: 'Cashless' },
        actions: {
          callback_url: request.notificationUrl,
          return_url: request.returnUrl,
          cancel_url: request.returnUrl,
        },
        custom_data: { psp_topup_id: 'topup-1' },
      });
    });

    it('devise autre que XOF : refus avant tout appel', async () => {
      await expect(adapter.initiate({ ...request, currency: 'EUR' }, secrets)).rejects.toThrow(
        PspProviderError,
      );
      expect(server.requests).toHaveLength(0);
    });

    it('code de réponse autre que 00 : refus portant le code, sans secret', async () => {
      server.options.createCode = '1001';
      const error = await adapter.initiate(request, secrets).catch((e: Error) => e);
      expect(error).toBeInstanceOf(PspProviderError);
      expect((error as Error).message).toContain('1001');
      for (const s of [MASTER, PRIVATE, TOKEN_KEY])
        expect((error as Error).message).not.toContain(s);
    });

    it('création non rejouée sur 503 (non idempotente) : une seule requête', async () => {
      const failing = await startFakeServer((_req, res) => {
        res.statusCode = 503;
        res.end('{}');
      });
      const a = new PayDunyaPspAdapter(
        new PspHttpClient({ pspHttpTimeoutMs: 2000 }, () => Promise.resolve()),
        {
          pspBases: { wave: 'x', paydunya: failing.url, stripe: 'x' },
        },
      );
      await expect(a.initiate(request, secrets)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
      expect(failing.requests).toHaveLength(1);
      await failing.close();
    });
  });

  describe('verifyNotification (signal, D2)', () => {
    it('bon hash : SIGNAL sans montant, identifiant paydunya:<token>:<statut>', () => {
      const v = verify(ipn());
      expect(v).toEqual({
        ok: true,
        kind: 'SIGNAL',
        notificationId: 'paydunya:tok_abc123:completed',
        reference: { merchantReference: 'topup-1', providerPaymentRef: 'tok_abc123' },
        secretUsed: 'current',
      });
      expect(JSON.stringify(v)).not.toContain('999999');
    });

    it('comparaison à temps constant : timingSafeEqual est utilisé', () => {
      const spy = timingSafeEqual as jest.MockedFunction<typeof timingSafeEqual>;
      spy.mockClear();
      expect(verify(ipn())).toMatchObject({ ok: true });
      expect(verify(ipn({}, sha512('autre')))).toMatchObject({ ok: false });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('mauvais hash : SIGNATURE_INVALID', () => {
      expect(verify(ipn({}, sha512('autre')))).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    });

    it('hash absent : SIGNATURE_MISSING', () => {
      const raw = form({ 'data[status]': 'completed', 'data[invoice][token]': 't' });
      expect(verify(raw)).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
    });

    it('hash non hexadécimal ou de mauvaise longueur : SIGNATURE_MALFORMED', () => {
      expect(verify(ipn({}, 'Z'.repeat(128)))).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
      expect(verify(ipn({}, sha512(MASTER).slice(2)))).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
      const twice = Buffer.concat([ipn(), Buffer.from('&data%5Bhash%5D=' + sha512(MASTER))]);
      expect(verify(twice)).toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
    });

    it('hash en majuscules hexadécimales : accepté (même valeur)', () => {
      expect(verify(ipn({}, sha512(MASTER).toUpperCase()))).toMatchObject({ ok: true });
    });

    it('JSON au lieu du formulaire : BODY_MALFORMED', () => {
      const json = Buffer.from(JSON.stringify({ data: { hash: sha512(MASTER) } }));
      expect(verify(json, 'json')).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
    });

    it('aucun champ autre que data[hash] lu avant la comparaison', () => {
      // Hash faux et reste du corps vide d'invoice : on juge la preuve, pas le corps.
      const bad = form({ 'data[hash]': sha512('autre'), 'data[status]': '!!' });
      expect(verify(bad)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
      // Hash juste mais corps incomplet : refus du corps seulement après la preuve.
      const incomplete = form({ 'data[hash]': sha512(MASTER) });
      expect(verify(incomplete)).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
    });

    it('secret précédent jamais utilisé', () => {
      const withPrevious: PspSecrets = {
        ...secrets,
        notification: {
          current: Secret.of('nouvelle-cle'),
          previous: Secret.of(MASTER),
          previousValidUntil: new Date(NOW.getTime() + 3600_000),
        },
      };
      expect(verify(ipn(), 'form', withPrevious)).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('référence marchande facultative', () => {
      const raw = form({
        'data[hash]': sha512(MASTER),
        'data[status]': 'pending',
        'data[invoice][token]': 'tok_1',
      });
      expect(verify(raw)).toMatchObject({
        ok: true,
        reference: { merchantReference: null, providerPaymentRef: 'tok_1' },
      });
    });
  });

  describe('getStatus (confirmation)', () => {
    const query = { merchantReference: 'topup-1', providerPaymentRef: 'tok_abc123' };
    const body = (status: string, extra: Record<string, unknown> = {}) => ({
      response_code: '00',
      status,
      invoice: { total_amount: 5000 },
      custom_data: { psp_topup_id: 'topup-1' },
      customer: { name: 'Nom', phone: '221770000000' },
      ...extra,
    });

    it('GET checkout-invoice/confirm/{token} avec les trois clés', async () => {
      server.options.confirm = body('completed');
      const result = await adapter.getStatus(query, secrets);
      const sent = server.requests[0]!;
      expect(sent.method).toBe('GET');
      expect(sent.path).toBe('/api/v1/checkout-invoice/confirm/tok_abc123');
      expect(sent.headers['paydunya-master-key']).toBe(MASTER);
      expect(sent.headers['paydunya-private-key']).toBe(PRIVATE);
      expect(sent.headers['paydunya-token']).toBe(TOKEN_KEY);
      expect(result).toEqual({
        state: 'PAID',
        payment: {
          merchantReference: 'topup-1',
          providerPaymentRef: 'tok_abc123',
          amount: 5000n,
          currency: 'XOF',
          card: { fingerprint: null, threeDs: 'NOT_PERFORMED' },
        },
      });
    });

    it.each([
      ['pending', 'PENDING'],
      ['cancelled', 'CANCELLED'],
      ['failed', 'FAILED'],
      ['inconnu', 'UNKNOWN'],
    ])('statut %s : %s', async (status, state) => {
      server.options.confirm = body(status);
      expect((await adapter.getStatus(query, secrets)).state).toBe(state);
    });

    it('statut inconnu : jamais payé, sans paiement', async () => {
      server.options.confirm = body('paid');
      expect(await adapter.getStatus(query, secrets)).toEqual({ state: 'UNKNOWN', payment: null });
    });

    it('montant non entier ou absent : jamais payé', async () => {
      for (const invoice of [{ total_amount: 12.5 }, { total_amount: 'abc' }, {}]) {
        server.options.confirm = body('completed', { invoice });
        expect((await adapter.getStatus(query, secrets)).state).toBe('UNKNOWN');
      }
    });

    it('code de réponse autre que 00 : UNKNOWN', async () => {
      server.options.confirm = { response_code: '1002', status: 'completed' };
      expect((await adapter.getStatus(query, secrets)).state).toBe('UNKNOWN');
    });

    it('token absent ou piégé : aucun appel', async () => {
      expect((await adapter.getStatus({ ...query, providerPaymentRef: null }, secrets)).state).toBe(
        'UNKNOWN',
      );
      expect(
        (await adapter.getStatus({ ...query, providerPaymentRef: '../x?y' }, secrets)).state,
      ).toBe('UNKNOWN');
      expect(server.requests).toHaveLength(0);
    });

    it('carte jamais déclarée 3-D Secure (D7)', async () => {
      server.options.confirm = body('completed');
      const result = await adapter.getStatus(query, secrets);
      expect(result.payment?.card).toEqual({ fingerprint: null, threeDs: 'NOT_PERFORMED' });
      expect(
        JSON.stringify(result, (_k, v: unknown) => (typeof v === 'bigint' ? '1' : v)),
      ).not.toContain('221770000000');
    });

    it('identifiants d’un autre fournisseur : refus sans appel ni secret', async () => {
      const err = await adapter
        .getStatus(query, { ...secrets, credentials: { provider: 'FAKE', key: null } })
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(PspProviderError);
      expect(server.requests).toHaveLength(0);
    });

    it('réponse non JSON : erreur sans secret ni corps', async () => {
      const bad = await startFakeServer((_req, res) => {
        res.end('<html>secret-page</html>');
      });
      const a = new PayDunyaPspAdapter(new PspHttpClient({ pspHttpTimeoutMs: 2000 }), {
        pspBases: { wave: 'x', paydunya: bad.url, stripe: 'x' },
      });
      const err = await a.getStatus(query, secrets).catch((e: Error) => e);
      expect(err).toBeInstanceOf(PspProviderError);
      expect((err as Error).message).not.toContain('secret-page');
      for (const s of [MASTER, PRIVATE, TOKEN_KEY]) expect((err as Error).message).not.toContain(s);
      await bad.close();
    });
  });

  describe('cancel et readStatement', () => {
    it('sans appel : non annulé, relevé non pris en charge', async () => {
      expect(
        await adapter.cancel({ merchantReference: 'a', providerPaymentRef: 'b' }, secrets),
      ).toEqual({
        cancelled: false,
      });
      expect(await adapter.readStatement({ from: NOW, to: NOW }, secrets)).toEqual({
        supported: false,
      });
      expect(server.requests).toHaveLength(0);
    });
  });

  describe('borne OP PayDunya (D2)', () => {
    it('un signal valide ne porte aucun montant, aucune devise, aucune carte', () => {
      const v = verify(ipn({ 'data[invoice][total_amount]': '1', 'data[status]': 'completed' }));
      expect(v).toMatchObject({ ok: true, kind: 'SIGNAL' });
      if (!v.ok || v.kind !== 'SIGNAL') throw new Error('signal attendu');
      expect(Object.keys(v).sort()).toEqual([
        'kind',
        'notificationId',
        'ok',
        'reference',
        'secretUsed',
      ]);
      expect(Object.keys(v.reference).sort()).toEqual(['merchantReference', 'providerPaymentRef']);
    });

    it('signal « completed » mais confirmation pending : rien n’est PAID', async () => {
      const v = verify(ipn());
      expect(v).toMatchObject({ ok: true, kind: 'SIGNAL' });
      server.options.confirm = {
        response_code: '00',
        status: 'pending',
        invoice: { total_amount: 5000 },
        custom_data: { psp_topup_id: 'topup-1' },
      };
      const result = await adapter.getStatus(
        { merchantReference: 'topup-1', providerPaymentRef: 'tok_abc123' },
        secrets,
      );
      expect(result.state).toBe('PENDING');
      expect(result.state).not.toBe('PAID');
    });
  });
});
