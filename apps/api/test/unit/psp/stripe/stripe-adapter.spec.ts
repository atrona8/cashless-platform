// Adaptateur Stripe (WP07) : faux serveur local, aucun appel externe.
import { createHmac } from 'node:crypto';
import { PspHttpClient } from '../../../../src/psp/http/psp-http';
import { PspProviderError } from '../../../../src/psp/psp-errors';
import type { PspSecrets } from '../../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../../src/psp/secret';
import type { PspInitiateRequest } from '../../../../src/psp/psp.types';
import { StripePspAdapter } from '../../../../src/psp/stripe/stripe-adapter';
import { startFakeStripe, type FakeStripe } from '../../../support/fake-servers/stripe';

const NOW = new Date('2026-11-26T12:00:00Z');
const SK = 'sk_test_SECRET_KEY_VALUE';
const WHSEC = 'whsec_test_current';
const OLD = 'whsec_test_previous';

function secrets(extra: Partial<PspSecrets['notification']> = {}): PspSecrets {
  return {
    credentials: { provider: 'STRIPE', secretKey: Secret.of(SK) },
    notification: {
      current: Secret.of(WHSEC),
      previous: null,
      previousValidUntil: null,
      ...extra,
    },
  };
}

const request: PspInitiateRequest = {
  pspTopupId: '11111111-1111-4111-8111-111111111111',
  method: 'CARD',
  amount: 5000n,
  currency: 'XOF',
  payerMsisdn: null,
  returnUrl: 'https://app.example.invalid/retour',
  notificationUrl: 'https://api.example.invalid/webhooks/stripe/x',
};

// Signature calculée ici, indépendamment de hmac-signature.ts : HMAC-SHA256 de `t + '.' + corps` (docs.stripe.com).
function sign(body: string, secret = WHSEC, t = Math.floor(NOW.getTime() / 1000)): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}
const header = (body: string, secret = WHSEC, t = Math.floor(NOW.getTime() / 1000)) =>
  `t=${t},v1=${sign(body, secret, t)}`;

describe('StripePspAdapter', () => {
  let fake: FakeStripe;
  let adapter: StripePspAdapter;
  let sleeps: number[];

  beforeEach(async () => {
    fake = await startFakeStripe();
    sleeps = [];
    const http = new PspHttpClient({ pspHttpTimeoutMs: 5000 }, (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });
    adapter = new StripePspAdapter(
      http,
      { pspBases: { wave: '', paydunya: '', stripe: fake.url } },
      () => NOW,
    );
  });
  afterEach(() => fake.close());

  describe('initiate', () => {
    it('envoie le corps formulaire exact, la clé d idempotence et le jeton', async () => {
      const result = await adapter.initiate(request, secrets());
      const sent = fake.requests[0]!;
      expect(sent.method).toBe('POST');
      expect(sent.path).toBe('/v1/checkout/sessions');
      expect(sent.headers.authorization).toBe(`Bearer ${SK}`);
      expect(sent.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(sent.headers['idempotency-key']).toBe(request.pspTopupId);
      const expiresAt = Math.floor(NOW.getTime() / 1000) + 31 * 60;
      expect([...new URLSearchParams(sent.body.toString('utf8')).entries()]).toEqual([
        ['mode', 'payment'],
        ['line_items[0][price_data][currency]', 'xof'],
        ['line_items[0][price_data][unit_amount]', '5000'],
        ['line_items[0][price_data][product_data][name]', 'Recharge'],
        ['line_items[0][quantity]', '1'],
        ['payment_method_types[0]', 'card'],
        ['payment_method_options[card][request_three_d_secure]', 'any'],
        ['client_reference_id', request.pspTopupId],
        ['metadata[psp_topup_id]', request.pspTopupId],
        ['success_url', request.returnUrl],
        ['cancel_url', request.returnUrl],
        ['expires_at', String(expiresAt)],
      ]);
      expect(result.providerPaymentRef).toBe('cs_test_1');
      expect(result.action).toEqual({
        kind: 'REDIRECT',
        url: 'https://checkout.stripe.invalid/c/pay/cs_test_1',
      });
      expect(result.expiresAt).toEqual(new Date(expiresAt * 1000));
    });

    it('rejoue un 503 avec la MEME clé d idempotence et le même corps', async () => {
      fake.failNext(1);
      await adapter.initiate(request, secrets());
      expect(fake.requests).toHaveLength(2);
      expect(fake.requests[1]!.headers['idempotency-key']).toBe(request.pspTopupId);
      expect(fake.requests[1]!.headers['idempotency-key']).toBe(
        fake.requests[0]!.headers['idempotency-key'],
      );
      expect(fake.requests[1]!.body.equals(fake.requests[0]!.body)).toBe(true);
      expect(sleeps).toEqual([200]);
    });

    it('expires_at stable pour un même pspTopupId : reprise = même corps, même clé', async () => {
      let now = NOW;
      const http = new PspHttpClient({ pspHttpTimeoutMs: 5000 }, () => Promise.resolve());
      const later = new StripePspAdapter(
        http,
        { pspBases: { wave: '', paydunya: '', stripe: fake.url } },
        () => now,
      );
      await later.initiate(request, secrets());
      now = new Date(NOW.getTime() + 10 * 60 * 1000);
      await later.initiate(request, secrets());
      expect(fake.requests).toHaveLength(2);
      expect(fake.requests[1]!.body.equals(fake.requests[0]!.body)).toBe(true);
      // Une autre recharge reçoit sa propre échéance.
      await later.initiate({ ...request, pspTopupId: 'autre-recharge' }, secrets());
      expect(fake.requests[2]!.body.equals(fake.requests[0]!.body)).toBe(false);
    });

    it('refuse sans appel : adresse de retour absente, devise, moyen, montant, identifiants', async () => {
      const refused = async (r: PspInitiateRequest, s = secrets()) =>
        adapter.initiate(r, s).then(
          () => 'ok',
          (e: unknown) => (e instanceof PspProviderError ? e.kind : 'autre'),
        );
      expect(await refused({ ...request, returnUrl: null })).toBe('REJECTED');
      expect(await refused({ ...request, currency: 'EUR' })).toBe('REJECTED');
      expect(await refused({ ...request, method: 'WAVE' })).toBe('REJECTED');
      expect(await refused({ ...request, amount: 0n })).toBe('REJECTED');
      expect(await refused({ ...request, amount: 10n ** 20n })).toBe('REJECTED');
      expect(
        await refused(request, { ...secrets(), credentials: { provider: 'FAKE', key: null } }),
      ).toBe('REJECTED');
      expect(fake.requests).toHaveLength(0);
    });

    it('erreur 400 : REJECTED, type et code seulement, jamais le texte libre ni la clé', async () => {
      fake.rejectNext(400, 'invalid_request_error', 'amount_too_small');
      const err = await adapter.initiate(request, secrets()).then(
        () => null,
        (e: unknown) => e as PspProviderError,
      );
      expect(err).toBeInstanceOf(PspProviderError);
      expect(err!.kind).toBe('REJECTED');
      expect(err!.message).toBe(
        'Stripe initiate : refus 400 invalid_request_error amount_too_small',
      );
      for (const leak of ['texte libre', SK, fake.url, request.pspTopupId])
        expect(err!.message).not.toContain(leak);
    });

    it('401 : UNAVAILABLE (configuration)', async () => {
      fake.rejectNext(401, 'invalid_request_error', 'api_key_invalid');
      const err = await adapter.initiate(request, secrets()).then(
        () => null,
        (e: unknown) => e as PspProviderError,
      );
      expect(err!.kind).toBe('UNAVAILABLE');
    });
  });

  describe('verifyNotification', () => {
    const session = {
      id: 'cs_test_1',
      payment_status: 'paid',
      amount_total: 5000,
      currency: 'xof',
      client_reference_id: request.pspTopupId,
    };
    const event = (type: string, object: unknown, id = 'evt_1') =>
      JSON.stringify({ id, object: 'event', type, data: { object } });
    const verify = (
      body: string,
      headers: Record<string, string | string[] | undefined>,
      s = secrets(),
      contentType: 'json' | 'form' = 'json',
    ) =>
      adapter.verifyNotification({
        rawBody: Buffer.from(body),
        contentType,
        headers,
        secrets: s,
        now: NOW,
      });

    it('accepte la signature de t.corps (vecteur indépendant) : succès à relire', () => {
      const body = event('checkout.session.completed', session);
      const v = verify(body, { 'Stripe-Signature': header(body) });
      expect(v).toMatchObject({
        ok: true,
        kind: 'NOTIFICATION',
        secretUsed: 'current',
        confirmationRequired: true,
        notification: {
          notificationId: 'evt_1',
          kind: 'PAYMENT_SUCCEEDED',
          dispute: null,
          payment: {
            merchantReference: request.pspTopupId,
            providerPaymentRef: 'cs_test_1',
            amount: 5000n,
            currency: 'XOF',
            card: null,
          },
        },
      });
    });

    it('ignore v0 et les entrées inconnues, accepte plusieurs v1', () => {
      const body = event('checkout.session.completed', session);
      const t = Math.floor(NOW.getTime() / 1000);
      const h = `t=${t},v0=${'ab'.repeat(32)},secret=pas_un_secret,v1=${'cd'.repeat(32)},v1=${sign(body)}`;
      expect(verify(body, { 'stripe-signature': h }).ok).toBe(true);
    });

    it('refuse v0 seul : il ne sert jamais à vérifier', () => {
      const body = event('checkout.session.completed', session);
      const t = Math.floor(NOW.getTime() / 1000);
      expect(verify(body, { 'stripe-signature': `t=${t},v0=${sign(body)}` })).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
    });

    it('refuse le corps signé sans point (schéma Wave)', () => {
      const body = event('checkout.session.completed', session);
      const t = Math.floor(NOW.getTime() / 1000);
      const wave = createHmac('sha256', WHSEC).update(`${t}${body}`).digest('hex');
      expect(verify(body, { 'stripe-signature': `t=${t},v1=${wave}` })).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('refuse : en-tête absent, horodatage hors tolérance, corps modifié, mauvais secret', () => {
      const body = event('checkout.session.completed', session);
      expect(verify(body, {})).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
      const late = Math.floor(NOW.getTime() / 1000) - 301;
      expect(verify(body, { 'stripe-signature': header(body, WHSEC, late) })).toEqual({
        ok: false,
        reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
      });
      expect(verify(body + ' ', { 'stripe-signature': header(body) })).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
      expect(verify(body, { 'stripe-signature': header(body, 'whsec_autre') })).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('secret précédent : accepté avant échéance, refusé après', () => {
      const body = event('checkout.session.completed', session);
      const live = secrets({
        previous: Secret.of(OLD),
        previousValidUntil: new Date(NOW.getTime() + 1000),
      });
      expect(verify(body, { 'stripe-signature': header(body, OLD) }, live)).toMatchObject({
        ok: true,
        secretUsed: 'previous',
      });
      const expired = secrets({
        previous: Secret.of(OLD),
        previousValidUntil: new Date(NOW.getTime() - 1000),
      });
      expect(verify(body, { 'stripe-signature': header(body, OLD) }, expired)).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('formulaire : BODY_MALFORMED ; JSON invalide ou sans data.object : BODY_MALFORMED', () => {
      const body = event('checkout.session.completed', session);
      const h = { 'stripe-signature': header(body) };
      expect(verify(body, h, secrets(), 'form')).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
      for (const bad of ['pas du json', '{"id":"evt_1","type":"x"}', '[]']) {
        expect(verify(bad, { 'stripe-signature': header(bad) })).toEqual({
          ok: false,
          reason: 'BODY_MALFORMED',
        });
      }
    });

    it('succès sans montant entier positif : BODY_MALFORMED', () => {
      for (const amount of [0, -5, 12.5, '5000', null]) {
        const body = event('checkout.session.completed', { ...session, amount_total: amount });
        expect(verify(body, { 'stripe-signature': header(body) })).toEqual({
          ok: false,
          reason: 'BODY_MALFORMED',
        });
      }
    });

    it('async_payment_succeeded : à relire ; completed non payé : UNKNOWN sans effet', () => {
      const a = event('checkout.session.async_payment_succeeded', session);
      expect(verify(a, { 'stripe-signature': header(a) })).toMatchObject({
        confirmationRequired: true,
        notification: { kind: 'PAYMENT_SUCCEEDED' },
      });
      const u = event('checkout.session.completed', { ...session, payment_status: 'unpaid' });
      expect(verify(u, { 'stripe-signature': header(u) })).toMatchObject({
        confirmationRequired: false,
        notification: { kind: 'UNKNOWN' },
      });
    });

    it('échec, expiration, litige, inconnu', () => {
      const cases: [string, unknown, string][] = [
        ['checkout.session.async_payment_failed', session, 'PAYMENT_FAILED'],
        ['checkout.session.expired', session, 'PAYMENT_CANCELLED'],
        ['payment_intent.created', { id: 'pi_1' }, 'UNKNOWN'],
      ];
      for (const [type, object, kind] of cases) {
        const body = event(type, object);
        expect(verify(body, { 'stripe-signature': header(body) })).toMatchObject({
          ok: true,
          confirmationRequired: false,
          notification: { kind },
        });
      }
      const d = event('charge.dispute.created', {
        id: 'dp_1',
        amount: 5000,
        currency: 'xof',
        payment_intent: 'pi_9',
        charge: 'ch_9',
      });
      expect(verify(d, { 'stripe-signature': header(d) })).toMatchObject({
        ok: true,
        confirmationRequired: true,
        notification: {
          kind: 'DISPUTE',
          dispute: { providerDisputeId: 'dp_1', amount: 5000n },
          payment: { providerPaymentRef: 'pi_9', amount: 5000n, currency: 'XOF' },
        },
      });
      for (const object of [
        { id: 'dp_1', amount: 0, currency: 'xof', payment_intent: 'pi_9' },
        { id: 'dp_1', amount: 5000, currency: 'xof', charge: 'ch_9' }, // sans PaymentIntent
      ]) {
        const bad = event('charge.dispute.created', object);
        expect(verify(bad, { 'stripe-signature': header(bad) })).toEqual({
          ok: false,
          reason: 'BODY_MALFORMED',
        });
      }
    });
  });

  describe('getStatus', () => {
    async function paid(three: unknown, extraCard: Record<string, unknown> = {}) {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      const session = fake.sessions.get(providerPaymentRef)!;
      session.status = 'complete';
      session.payment_status = 'paid';
      session.payment_intent = 'pi_1';
      fake.intents.set('pi_1', {
        id: 'pi_1',
        status: 'succeeded',
        latest_charge: {
          id: 'ch_1',
          payment_method_details: {
            card: {
              fingerprint: 'fp_abc',
              ...(three === undefined ? {} : { three_d_secure: { result: three } }),
              ...extraCard,
            },
          },
        },
      });
      return { providerPaymentRef, session };
    }
    const query = (ref: string) => ({
      merchantReference: request.pspTopupId,
      providerPaymentRef: ref,
    });

    it.each([
      ['authenticated', 'SUCCEEDED'],
      ['attempt_acknowledged', 'NOT_PERFORMED'],
      ['failed', 'FAILED'],
      ['processing_error', 'FAILED'],
      ['not_supported', 'NOT_PERFORMED'],
      ['exempted', 'NOT_PERFORMED'],
      ['data_share_only', 'NOT_PERFORMED'],
      [undefined, 'NOT_PERFORMED'],
      ['valeur_inconnue', 'NOT_PERFORMED'],
    ])('3-D Secure %s -> %s', async (result, expected) => {
      const { providerPaymentRef } = await paid(result);
      const status = await adapter.getStatus(query(providerPaymentRef), secrets());
      expect(status.state).toBe('PAID');
      expect(status.payment).toEqual({
        merchantReference: request.pspTopupId,
        providerPaymentRef,
        amount: 5000n,
        currency: 'XOF',
        card: { fingerprint: 'fp_abc', threeDs: expected },
      });
      const calls = fake.requests.slice(-2).map((r) => `${r.method} ${r.path}`);
      expect(calls).toEqual([
        'GET /v1/checkout/sessions/cs_test_1',
        'GET /v1/payment_intents/pi_1?expand[]=latest_charge',
      ]);
    });

    it('empreinte absente : null ; charge non développée : aucune carte', async () => {
      const { providerPaymentRef } = await paid('authenticated', { fingerprint: null });
      expect((await adapter.getStatus(query(providerPaymentRef), secrets())).payment?.card).toEqual(
        {
          fingerprint: null,
          threeDs: 'SUCCEEDED',
        },
      );
      fake.intents.get('pi_1')!.latest_charge = 'ch_1';
      expect(
        (await adapter.getStatus(query(providerPaymentRef), secrets())).payment?.card,
      ).toBeNull();
    });

    it('états : ouverte, expirée, annulée, impayée, inconnue, absente', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      const session = fake.sessions.get(providerPaymentRef)!;
      const state = async () =>
        (await adapter.getStatus(query(providerPaymentRef), secrets())).state;
      expect(await state()).toBe('PENDING');
      session.status = 'expired';
      expect(await state()).toBe('EXPIRED');
      session.status = 'open';
      session.payment_intent = 'pi_2';
      fake.intents.set('pi_2', { id: 'pi_2', status: 'canceled', latest_charge: null });
      expect(await state()).toBe('CANCELLED');
      session.payment_intent = null;
      session.status = 'complete';
      session.payment_status = 'unpaid';
      expect(await state()).toBe('PENDING');
      session.status = 'autre';
      expect(await state()).toBe('UNKNOWN');
      expect(await adapter.getStatus(query('cs_inconnue'), secrets())).toEqual({
        state: 'UNKNOWN',
        payment: null,
      });
      expect(
        await adapter.getStatus({ merchantReference: 'x', providerPaymentRef: null }, secrets()),
      ).toEqual({ state: 'UNKNOWN', payment: null });
    });

    it('session d une autre recharge : jamais créditée', async () => {
      const { providerPaymentRef } = await paid('authenticated');
      const status = await adapter.getStatus(
        { merchantReference: 'autre-recharge', providerPaymentRef },
        secrets(),
      );
      expect(status).toEqual({ state: 'UNKNOWN', payment: null });
    });
  });

  describe('cancel', () => {
    it('200 expirée -> true, avec Idempotency-Key cancel-<id>', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      const q = { merchantReference: request.pspTopupId, providerPaymentRef };
      expect(await adapter.cancel(q, secrets())).toEqual({ cancelled: true });
      const sent = fake.requests.at(-1)!;
      expect(sent.path).toBe(`/v1/checkout/sessions/${providerPaymentRef}/expire`);
      expect(sent.headers['idempotency-key']).toBe(`cancel-${providerPaymentRef}`);
    });

    it('200 dont la session n est pas expirée -> false', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      fake.sessions.get(providerPaymentRef)!.refuseToExpire = true;
      const q = { merchantReference: request.pspTopupId, providerPaymentRef };
      expect(await adapter.cancel(q, secrets())).toEqual({ cancelled: false });
    });

    it('session non ouverte (400) -> false ; inconnue (404) -> false ; sans référence -> false', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      fake.sessions.get(providerPaymentRef)!.status = 'complete';
      const q = { merchantReference: request.pspTopupId, providerPaymentRef };
      expect(await adapter.cancel(q, secrets())).toEqual({ cancelled: false });
      expect(await adapter.cancel({ ...q, providerPaymentRef: 'cs_x' }, secrets())).toEqual({
        cancelled: false,
      });
      const before = fake.requests.length;
      expect(await adapter.cancel({ ...q, providerPaymentRef: null }, secrets())).toEqual({
        cancelled: false,
      });
      expect(fake.requests).toHaveLength(before);
    });

    it('panne du service : l erreur remonte (UNAVAILABLE)', async () => {
      fake.failNext(5);
      const err = await adapter
        .cancel({ merchantReference: 'x', providerPaymentRef: 'cs_1' }, secrets())
        .then(
          () => null,
          (e: unknown) => e as PspProviderError,
        );
      expect(err).toBeInstanceOf(PspProviderError);
      expect(err!.kind).toBe('UNAVAILABLE');
    });
  });

  describe('resolvePaymentReference', () => {
    it('retrouve la session du PaymentIntent (GET ?payment_intent=&limit=1)', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      fake.sessions.get(providerPaymentRef)!.payment_intent = 'pi_9';
      const found = await adapter.resolvePaymentReference('pi_9', secrets());
      expect(found).toEqual({ merchantReference: request.pspTopupId, providerPaymentRef });
      const sent = fake.requests.at(-1)!;
      expect(sent.method).toBe('GET');
      expect(sent.path).toBe('/v1/checkout/sessions?payment_intent=pi_9&limit=1');
      expect(sent.headers.authorization).toBe(`Bearer ${SK}`);
    });

    it('inconnu -> null ; session sans référence marchande -> null', async () => {
      expect(await adapter.resolvePaymentReference('pi_inconnu', secrets())).toBeNull();
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      const session = fake.sessions.get(providerPaymentRef)!;
      session.payment_intent = 'pi_9';
      session.client_reference_id = null;
      expect(await adapter.resolvePaymentReference('pi_9', secrets())).toBeNull();
    });

    it('le faux ignorant le filtre : une session d un autre PaymentIntent n est pas rendue', async () => {
      const { providerPaymentRef } = await adapter.initiate(request, secrets());
      fake.sessions.get(providerPaymentRef)!.payment_intent = 'pi_autre';
      fake.ignoreFilters = true;
      expect(await adapter.resolvePaymentReference('pi_9', secrets())).toBeNull();
    });
  });

  describe('readStatement', () => {
    const row = (i: number, type = 'charge') => ({
      id: `txn_${i}`,
      amount: 5000,
      fee: 150,
      currency: 'xof',
      created: 1_700_000_000 + i,
      source: i % 2 === 0 ? `ch_${i}` : null,
      type,
    });

    it('relevé paginé par starting_after, lignes normalisées', async () => {
      for (let i = 1; i <= 250; i += 1)
        fake.balanceTransactions.push(row(i, i === 3 ? 'refund' : 'charge'));
      const statement = await adapter.readStatement(
        { from: new Date(1_700_000_000_000), to: new Date(1_700_001_000_000) },
        secrets(),
      );
      expect(statement.supported).toBe(true);
      if (!statement.supported) return;
      expect(statement.lines).toHaveLength(250);
      expect(fake.requests).toHaveLength(3);
      expect(fake.requests[0]!.path).toBe(
        '/v1/balance_transactions?created[gte]=1700000000&created[lte]=1700001000&limit=100',
      );
      expect(fake.requests[1]!.path).toContain('&starting_after=txn_100');
      expect(fake.requests[2]!.path).toContain('&starting_after=txn_200');
      expect(statement.lines[1]).toEqual({
        reference: 'ch_2',
        providerPaymentRef: 'ch_2',
        amount: 5000n,
        fee: 150n,
        currency: 'XOF',
        date: new Date((1_700_000_000 + 2) * 1000),
        reversal: false,
      });
      expect(statement.lines[0]).toMatchObject({ reference: 'txn_1', providerPaymentRef: null });
      expect(statement.lines[2]!.reversal).toBe(true);
    });

    it('relevé trop long (plus de 100 pages) : erreur, jamais un relevé tronqué', async () => {
      for (let i = 1; i <= 10_100 + 1; i += 1) fake.balanceTransactions.push(row(i));
      const err = await adapter
        .readStatement(
          { from: new Date(1_700_000_000_000), to: new Date(1_700_100_000_000) },
          secrets(),
        )
        .then(
          () => null,
          (e: unknown) => e as PspProviderError,
        );
      expect(err).toBeInstanceOf(PspProviderError);
      expect(fake.requests).toHaveLength(100);
    });
  });

  it('aucune clé dans le journal ni dans l objet sérialisé', () => {
    expect(JSON.stringify(secrets())).not.toContain(SK);
    expect(adapter.isFake).toBe(false);
    expect(adapter.service).toBe('psp.stripe');
  });
});
