// Adaptateur Wave (WP05) : requêtes exactes, signature des requêtes, notification, statuts, relevé. Faux serveur local.
import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PspHttpClient } from '../../../../src/psp/http/psp-http';
import { PspProviderError } from '../../../../src/psp/psp-errors';
import type { PspSecrets } from '../../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../../src/psp/secret';
import { WavePspAdapter } from '../../../../src/psp/wave/wave-adapter';
import type { PspInitiateRequest } from '../../../../src/psp/psp.types';
import {
  WAVE_TEST_API_KEY,
  startFakeWave,
  waveSession,
  type FakeWave,
} from '../../../support/fake-servers/wave';

// Secret, horodatage et forme d'en-tête de l'exemple de docs.wave.com/webhook.
const WEBHOOK_SECRET = 'wave_sn_WHS_xz4m6g8rjs9bshxy05xj4khcvjv7j3hcp4fbpvv6met0zdrjvezg';
const T = 1667920421;
const NOW = new Date((T + 10) * 1000);
const SIGNING = 'wave_sn_RSS_signing_secret_0001';

const noSleep = (): Promise<void> => Promise.resolve();
const sign = (secret: string, t: number, body: string, sep = ''): string =>
  createHmac('sha256', secret).update(`${t}${sep}`).update(body).digest('hex');

function secrets(over: { signing?: boolean; previous?: string; until?: Date } = {}): PspSecrets {
  return {
    credentials: {
      provider: 'WAVE',
      apiKey: Secret.of(WAVE_TEST_API_KEY),
      requestSigningSecret: over.signing ? Secret.of(SIGNING) : null,
    },
    notification: {
      current: Secret.of(WEBHOOK_SECRET),
      previous: over.previous ? Secret.of(over.previous) : null,
      previousValidUntil: over.until ?? null,
    },
  };
}

const request = (over: Partial<PspInitiateRequest> = {}): PspInitiateRequest => ({
  pspTopupId: 'topup-1',
  method: 'WAVE',
  amount: 1000n,
  currency: 'XOF',
  payerMsisdn: null,
  returnUrl: 'https://app.example.com/retour',
  notificationUrl: 'https://api.example.com/webhooks/wave',
  ...over,
});

const completedBody = JSON.stringify({
  id: 'AE_ijzo7oGgrlM7',
  type: 'checkout.session.completed',
  data: {
    id: 'cos-1b01sghpg100j',
    amount: '100',
    checkout_status: 'complete',
    client_reference: 'topup-1',
    currency: 'XOF',
    payment_status: 'succeeded',
    transaction_id: 'TCN4Y4ZC3FM',
    when_completed: '2022-11-08T15:53:41Z',
  },
});
const failedBody = JSON.stringify({
  id: 'EV_8bO0d7TwW6Eq',
  type: 'checkout.session.payment_failed',
  data: {
    id: 'cos-18qq25rgr100a',
    checkout_status: 'open',
    client_reference: 'topup-1',
    payment_status: 'failed',
    last_payment_error: { code: 'insufficient-funds', message: 'Insufficient balance' },
  },
});

describe('WavePspAdapter', () => {
  let fake: FakeWave;
  let adapter: WavePspAdapter;
  let logs: string[];

  const build = (timeoutMs = 5000): WavePspAdapter =>
    new WavePspAdapter(
      new PspHttpClient({ pspHttpTimeoutMs: timeoutMs }, noSleep),
      {
        pspBases: { wave: fake.server.url, paydunya: 'x', stripe: 'x' },
        waveDefaultUrls: { success: 'https://d.example.com/ok', error: 'https://d.example.com/ko' },
      },
      () => NOW,
    );

  beforeEach(async () => {
    logs = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((m: unknown) => void logs.push(String(m)));
    fake = await startFakeWave();
    adapter = build();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fake.close();
  });

  describe('initiate', () => {
    it('envoie la requête exacte et rend la session', async () => {
      const result = await adapter.initiate(request({ payerMsisdn: '+221771234567' }), secrets());
      expect(fake.server.requests).toHaveLength(1);
      const req = fake.server.requests[0]!;
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/v1/checkout/sessions');
      expect(req.headers.authorization).toBe(`Bearer ${WAVE_TEST_API_KEY}`);
      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['wave-signature']).toBeUndefined();
      expect(JSON.parse(req.body.toString())).toEqual({
        amount: '1000',
        currency: 'XOF',
        client_reference: 'topup-1',
        success_url: 'https://app.example.com/retour',
        error_url: 'https://app.example.com/retour',
        restrict_payer_mobile: '+221771234567',
      });
      expect(result.providerPaymentRef).toBe('cos-fake1');
      expect(result.action).toEqual({ kind: 'REDIRECT', url: 'https://pay.wave.com/c/cos-fake1' });
      expect(result.expiresAt.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    });

    it('adresses par défaut de la configuration ; msisdn sans + ignoré', async () => {
      await adapter.initiate(request({ returnUrl: null, payerMsisdn: '221771234567' }), secrets());
      const body = JSON.parse(fake.server.requests[0]!.body.toString()) as Record<string, string>;
      expect(body.success_url).toBe('https://d.example.com/ok');
      expect(body.error_url).toBe('https://d.example.com/ko');
      expect(body).not.toHaveProperty('restrict_payer_mobile');
    });

    it.each([
      ['devise autre que XOF', { currency: 'EUR' }],
      ['montant nul', { amount: 0n }],
      ['adresse http', { returnUrl: 'http://app.example.com/retour' }],
    ])('refus avant tout appel : %s', async (_n, over) => {
      await expect(adapter.initiate(request(over), secrets())).rejects.toMatchObject({
        kind: 'REJECTED',
      });
      expect(fake.server.requests).toHaveLength(0);
    });

    it('sans adresse de retour ni défaut : refus avant appel', async () => {
      const bare = new WavePspAdapter(new PspHttpClient({ pspHttpTimeoutMs: 1000 }, noSleep), {
        pspBases: { wave: fake.server.url, paydunya: 'x', stripe: 'x' },
        waveDefaultUrls: { success: null, error: null },
      });
      await expect(bare.initiate(request({ returnUrl: null }), secrets())).rejects.toBeInstanceOf(
        PspProviderError,
      );
      expect(fake.server.requests).toHaveLength(0);
    });

    it('signe la requête quand le secret de signature est posé (t + corps)', async () => {
      fake.signingSecret = SIGNING;
      await adapter.initiate(request(), secrets({ signing: true }));
      const req = fake.server.requests[0]!;
      expect(req.headers['wave-signature']).toBe(
        `t=${T + 10},v1=${sign(SIGNING, T + 10, req.body.toString())}`,
      );
      expect(fake.badSignatures).toBe(0);
    });

    it('délai à la création : recherche, une seule création, session ouverte rendue', async () => {
      fake.behaviour.hangCreate = true;
      adapter = build(1000);
      const result = await adapter.initiate(request(), secrets());
      expect(fake.creates()).toHaveLength(1);
      expect(fake.server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'POST /v1/checkout/sessions',
        'GET /v1/checkout/sessions/search?client_reference=topup-1',
      ]);
      expect(result.providerPaymentRef).toBe('cos-fake1');
    });

    it('délai et aucune session trouvée : erreur, jamais de seconde création', async () => {
      fake.behaviour.hangCreate = true;
      adapter = build(1000);
      jest.spyOn(fake.sessions, 'set').mockImplementation(() => fake.sessions); // la session n'existe pas
      await expect(adapter.initiate(request(), secrets())).rejects.toMatchObject({
        kind: 'UNAVAILABLE',
      });
      expect(fake.creates()).toHaveLength(1);
    });

    describe('reprise après échec de la création', () => {
      const other = (over: Record<string, unknown>): void => {
        fake.sessions.set('cos-other', waveSession({ id: 'cos-other', ...over }));
      };
      it.each([
        ['500', { createStatus: 500 }],
        ['429', { createStatus: 429 }],
      ])('création %s : recherche puis reprise, une seule création', async (_n, b) => {
        fake.behaviour.createStatus = b.createStatus;
        const result = await adapter.initiate(request(), secrets());
        expect(fake.creates()).toHaveLength(1);
        expect(fake.server.requests[1]!.path).toBe(
          '/v1/checkout/sessions/search?client_reference=topup-1',
        );
        expect(result.providerPaymentRef).toBe('cos-fake1');
      });

      it('création 500 sans session trouvée : erreur, une seule création', async () => {
        fake.behaviour.createStatus = 500;
        fake.behaviour.createRecords = false;
        await expect(adapter.initiate(request(), secrets())).rejects.toMatchObject({
          kind: 'UNAVAILABLE',
        });
        expect(fake.creates()).toHaveLength(1);
      });

      it("ignore la session ouverte d'une autre référence", async () => {
        fake.behaviour.hangCreate = true;
        fake.behaviour.createRecords = false;
        adapter = build(1000);
        other({ client_reference: 'topup-10' });
        // simule une recherche trop large du serveur : préfixe
        fake.behaviour.looseSearch = true;
        await expect(adapter.initiate(request(), secrets())).rejects.toMatchObject({
          kind: 'UNAVAILABLE',
        });
      });

      it.each([
        ['montant', { amount: '999', client_reference: 'topup-1' }],
        ['devise', { currency: 'EUR', client_reference: 'topup-1' }],
      ])('session reprise de %s différent : erreur', async (_n, over) => {
        fake.behaviour.hangCreate = true;
        fake.behaviour.createRecords = false;
        adapter = build(1000);
        other(over);
        await expect(adapter.initiate(request(), secrets())).rejects.toMatchObject({
          kind: 'UNAVAILABLE',
        });
        expect(fake.creates()).toHaveLength(1);
      });
    });

    it('401 invalid-auth : le code Wave remonte, jamais la clé ni le corps', async () => {
      fake.behaviour.authOk = false;
      const error = await adapter.initiate(request(), secrets()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PspProviderError);
      const message = (error as Error).message;
      expect(message).toContain('invalid-auth');
      expect(message).not.toContain(WAVE_TEST_API_KEY);
      expect(message).not.toContain('Invalid API key');
      expect(logs.join('\n')).not.toContain(WAVE_TEST_API_KEY);
    });
  });

  describe('verifyNotification', () => {
    const verify = (
      body: string,
      header: string | undefined,
      over: { secrets?: PspSecrets; now?: Date; contentType?: 'json' | 'form' } = {},
    ) =>
      adapter.verifyNotification({
        rawBody: Buffer.from(body),
        contentType: over.contentType ?? 'json',
        headers: header === undefined ? {} : { 'Wave-Signature': header },
        secrets: over.secrets ?? secrets(),
        now: over.now ?? NOW,
      });
    const header = (body: string, t = T, secret = WEBHOOK_SECRET): string =>
      `t=${t},v1=${sign(secret, t, body)}`;

    it('vecteur selon la documentation (secret et t publiés, HMAC de t+corps) : accepté', () => {
      const v = verify(completedBody, header(completedBody));
      expect(v).toMatchObject({ ok: true, kind: 'NOTIFICATION', secretUsed: 'current' });
      if (!v.ok || v.kind !== 'NOTIFICATION') throw new Error('attendu NOTIFICATION');
      expect(v.confirmationRequired).toBe(false);
      expect(v.signedAt.getTime()).toBe(T * 1000);
      expect(v.notification).toEqual({
        notificationId: 'AE_ijzo7oGgrlM7',
        kind: 'PAYMENT_SUCCEEDED',
        payment: {
          merchantReference: 'topup-1',
          providerPaymentRef: 'cos-1b01sghpg100j',
          amount: 100n,
          currency: 'XOF',
          card: null,
        },
        dispute: null,
      });
    });

    it('en-tête insensible à la casse', () => {
      const v = adapter.verifyNotification({
        rawBody: Buffer.from(completedBody),
        contentType: 'json',
        headers: { 'wave-SIGNATURE': header(completedBody) },
        secrets: secrets(),
        now: NOW,
      });
      expect(v.ok).toBe(true);
    });

    it('même corps signé avec un point (schéma Stripe) : refusé', () => {
      const dotted = `t=${T},v1=${sign(WEBHOOK_SECRET, T, completedBody, '.')}`;
      expect(verify(completedBody, dotted)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    });

    it("deux v1 (rotation) : accepté si l'un correspond", () => {
      const h = `t=${T},v1=${'0'.repeat(64)},v1=${sign(WEBHOOK_SECRET, T, completedBody)}`;
      expect(verify(completedBody, h).ok).toBe(true);
    });

    it('secret précédent : accepté avant échéance, refusé après', () => {
      const prev = 'wave_sn_WHS_previous';
      const h = header(completedBody, T, prev);
      const live = secrets({ previous: prev, until: new Date(NOW.getTime() + 1000) });
      expect(verify(completedBody, h, { secrets: live })).toMatchObject({
        ok: true,
        secretUsed: 'previous',
      });
      const expired = secrets({ previous: prev, until: new Date(NOW.getTime() - 1000) });
      expect(verify(completedBody, h, { secrets: expired })).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('hors délai (au-delà de 300 s, dans les deux sens)', () => {
      const h = header(completedBody);
      for (const now of [new Date((T + 301) * 1000), new Date((T - 301) * 1000)])
        expect(verify(completedBody, h, { now })).toEqual({
          ok: false,
          reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
        });
    });

    it("corps modifié d'un octet : refusé", () => {
      const h = header(completedBody);
      expect(verify(completedBody.replace('"100"', '"101"'), h)).toEqual({
        ok: false,
        reason: 'SIGNATURE_INVALID',
      });
    });

    it('en-tête absent, mal formé, entrée inconnue, en-tête répété', () => {
      expect(verify(completedBody, undefined)).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
      expect(verify(completedBody, 'n-importe-quoi')).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
      expect(verify(completedBody, `${header(completedBody)},v0=ab`)).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
      const twice = adapter.verifyNotification({
        rawBody: Buffer.from(completedBody),
        contentType: 'json',
        headers: { 'wave-signature': [header(completedBody), header(completedBody)] },
        secrets: secrets(),
        now: NOW,
      });
      expect(twice).toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
    });

    it('contenu en formulaire : BODY_MALFORMED', () => {
      expect(verify(completedBody, header(completedBody), { contentType: 'form' })).toEqual({
        ok: false,
        reason: 'BODY_MALFORMED',
      });
    });

    it('corps signé mais non JSON ou montant décimal : BODY_MALFORMED', () => {
      const bad = 'pas du json';
      expect(verify(bad, header(bad))).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
      const decimal = completedBody.replace('"100"', '"100.5"');
      expect(verify(decimal, header(decimal))).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
    });

    it('payment_failed, succès sans payment_status succeeded, autre type', () => {
      const f = verify(failedBody, header(failedBody));
      expect(f).toMatchObject({ ok: true, notification: { kind: 'PAYMENT_FAILED' } });
      const processing = completedBody.replace('"succeeded"', '"processing"');
      expect(verify(processing, header(processing))).toMatchObject({
        ok: true,
        notification: { kind: 'UNKNOWN' },
      });
      const other = completedBody.replace(
        'checkout.session.completed',
        'merchant.payment_received',
      );
      expect(verify(other, header(other))).toMatchObject({
        ok: true,
        notification: { kind: 'UNKNOWN' },
      });
    });
  });

  describe('getStatus et cancel', () => {
    const query = { merchantReference: 'topup-1', providerPaymentRef: 'cos-18qq25rgr100a' };
    const put = (over: Record<string, unknown>): void => {
      fake.sessions.set('cos-18qq25rgr100a', waveSession(over));
    };

    it.each([
      ['complete+succeeded', { checkout_status: 'complete', payment_status: 'succeeded' }, 'PAID'],
      ['expired', { checkout_status: 'expired', payment_status: 'processing' }, 'EXPIRED'],
      ['cancelled', { checkout_status: 'open', payment_status: 'cancelled' }, 'FAILED'],
      ['open', { checkout_status: 'open', payment_status: 'processing' }, 'PENDING'],
      ['processing', { checkout_status: 'complete', payment_status: 'processing' }, 'PENDING'],
      ['inconnu', { checkout_status: 'weird', payment_status: 'weird' }, 'UNKNOWN'],
    ])('%s -> %s', async (_n, over, state) => {
      put(over);
      const r = await adapter.getStatus(query, secrets());
      expect(r.state).toBe(state);
      expect(fake.server.requests[0]).toMatchObject({
        method: 'GET',
        path: '/v1/checkout/sessions/cos-18qq25rgr100a',
      });
      expect(r.payment).toEqual({
        merchantReference: 'topup-1',
        providerPaymentRef: 'cos-18qq25rgr100a',
        amount: 1000n,
        currency: 'XOF',
        card: null,
      });
    });

    it('payé mais montant décimal : jamais PAID', async () => {
      put({ checkout_status: 'complete', payment_status: 'succeeded', amount: '1000.5' });
      expect(await adapter.getStatus(query, secrets())).toEqual({
        state: 'UNKNOWN',
        payment: null,
      });
    });

    it('session inconnue (404) : UNKNOWN', async () => {
      expect(
        (await adapter.getStatus({ ...query, providerPaymentRef: 'cos-zzz' }, secrets())).state,
      ).toBe('UNKNOWN');
    });

    it('sans référence Wave : recherche, la plus récente, journal du nombre', async () => {
      fake.sessions.set(
        'cos-a',
        waveSession({ id: 'cos-a', when_created: '2026-11-26T09:00:00Z' }),
      );
      fake.sessions.set(
        'cos-b',
        waveSession({
          id: 'cos-b',
          when_created: '2026-11-26T11:00:00Z',
          checkout_status: 'complete',
          payment_status: 'succeeded',
        }),
      );
      const r = await adapter.getStatus(
        { merchantReference: 'topup-1', providerPaymentRef: null },
        secrets(),
      );
      expect(r.state).toBe('PAID');
      expect(r.payment?.providerPaymentRef).toBe('cos-b');
      expect(logs.some((l) => l.includes('"count":2'))).toBe(true);
      const none = await adapter.getStatus(
        { merchantReference: 'autre', providerPaymentRef: null },
        secrets(),
      );
      expect(none).toEqual({ state: 'UNKNOWN', payment: null });
    });

    it("recherche : ignore une session d'une autre référence (getStatus et cancel)", async () => {
      fake.behaviour.looseSearch = true;
      fake.sessions.set('cos-x', waveSession({ id: 'cos-x', client_reference: 'topup-10' }));
      const lookup = { merchantReference: 'topup-1', providerPaymentRef: null };
      expect(await adapter.getStatus(lookup, secrets())).toEqual({
        state: 'UNKNOWN',
        payment: null,
      });
      expect(await adapter.cancel(lookup, secrets())).toEqual({ cancelled: false });
      expect(fake.sessions.get('cos-x')!.checkout_status).toBe('open');
    });

    it('référence Wave : la session rendue doit porter cet identifiant', async () => {
      fake.behaviour.wrongId = true;
      put({});
      await expect(adapter.getStatus(query, secrets())).rejects.toMatchObject({
        kind: 'UNAVAILABLE',
      });
    });

    it('cancel : 200, 409, 404, autre', async () => {
      put({});
      expect(await adapter.cancel(query, secrets())).toEqual({ cancelled: true });
      expect(fake.server.requests[0]).toMatchObject({
        method: 'POST',
        path: '/v1/checkout/sessions/cos-18qq25rgr100a/expire',
      });
      put({});
      fake.behaviour.expireStatus = 409;
      expect(await adapter.cancel(query, secrets())).toEqual({ cancelled: false });
      expect(await adapter.cancel({ ...query, providerPaymentRef: 'cos-zzz' }, secrets())).toEqual({
        cancelled: false,
      });
      fake.behaviour.expireStatus = 403;
      await expect(adapter.cancel(query, secrets())).rejects.toBeInstanceOf(PspProviderError);
    });
  });

  describe('readStatement', () => {
    it('deux jours, deux pages : lignes, frais, extourne, signe conservé', async () => {
      fake.transactions.set('2026-11-25', [
        [
          {
            timestamp: '2026-11-25T10:00:00Z',
            transaction_id: 'TCN1',
            amount: '1000',
            fee: '10',
            currency: 'XOF',
            client_reference: 'topup-1',
            checkout_api_session_id: 'cos-1',
          },
        ],
        [
          {
            timestamp: '2026-11-25T11:00:00Z',
            transaction_id: 'TCN2',
            amount: '-500',
            fee: '-5',
            currency: 'XOF',
            is_reversal: true,
          },
        ],
      ]);
      fake.transactions.set('2026-11-26', [
        [
          {
            timestamp: '2026-11-26T08:00:00Z',
            transaction_id: 'TCN3',
            amount: 200,
            fee: 0,
            currency: 'XOF',
          },
        ],
      ]);
      const r = await adapter.readStatement(
        { from: new Date('2026-11-25T23:00:00Z'), to: new Date('2026-11-26T01:00:00Z') },
        secrets(),
      );
      expect(fake.server.requests.map((q) => q.path)).toEqual([
        '/v1/transactions?date=2026-11-25',
        '/v1/transactions?date=2026-11-25&after=cursor-1',
        '/v1/transactions?date=2026-11-26',
      ]);
      expect(r).toMatchObject({ supported: true });
      if (!r.supported) throw new Error();
      expect(
        r.lines.map((l) => [l.reference, l.providerPaymentRef, l.amount, l.fee, l.reversal]),
      ).toEqual([
        ['topup-1', 'cos-1', 1000n, 10n, false],
        ['', 'TCN2', -500n, -5n, true],
        ['', 'TCN3', 200n, 0n, false],
      ]);
      expect(r.lines[0]!.date.toISOString()).toBe('2026-11-25T10:00:00.000Z');
    });

    it('période de plus de 31 jours : erreur sans appel ; 31 jours permis', async () => {
      const from = new Date('2026-10-01T00:00:00Z');
      await expect(
        adapter.readStatement({ from, to: new Date('2026-11-01T00:00:00Z') }, secrets()),
      ).rejects.toBeInstanceOf(PspProviderError);
      expect(fake.server.requests).toHaveLength(0);
      const ok = await adapter.readStatement(
        { from, to: new Date('2026-10-31T00:00:00Z') },
        secrets(),
      );
      expect(ok).toMatchObject({ supported: true });
      expect(fake.server.requests).toHaveLength(31);
    });

    it('ligne dans une autre devise : refusée et journalisée', async () => {
      fake.transactions.set('2026-11-25', [
        [
          { timestamp: '2026-11-25T10:00:00Z', transaction_id: 'A', amount: '1', currency: 'EUR' },
          { timestamp: '2026-11-25T10:00:00Z', transaction_id: 'B', amount: '2', currency: 'XOF' },
        ],
      ]);
      const r = await adapter.readStatement(
        { from: new Date('2026-11-25T00:00:00Z'), to: new Date('2026-11-25T01:00:00Z') },
        secrets(),
      );
      if (!r.supported) throw new Error();
      expect(r.lines.map((l) => l.providerPaymentRef)).toEqual(['B']);
      expect(logs.some((l) => l.includes('"refused":"currency"'))).toBe(true);
    });

    it('plus de 100 pages pour un jour : erreur', async () => {
      fake.transactions.set(
        '2026-11-25',
        Array.from({ length: 101 }, () => []),
      );
      await expect(
        adapter.readStatement(
          { from: new Date('2026-11-25T00:00:00Z'), to: new Date('2026-11-25T01:00:00Z') },
          secrets(),
        ),
      ).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
      expect(fake.server.requests).toHaveLength(100);
    });
  });

  it("identifiants d'un autre fournisseur : refus sans appel", async () => {
    const wrong = { ...secrets(), credentials: { provider: 'FAKE', key: null } } as PspSecrets;
    await expect(adapter.initiate(request(), wrong)).rejects.toBeInstanceOf(PspProviderError);
    expect(fake.server.requests).toHaveLength(0);
  });
});
