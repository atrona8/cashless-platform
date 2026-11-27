// Crédit unique par les adaptateurs PSP RÉELS (mission 12b-1, WP10 ; analyse C1, NFR-005, SC-003). Vraie base,
// HTTPS réel sur la route des notifications, adaptateurs Wave, PayDunya et Stripe construits par la fabrique de
// production avec `PSP_ADAPTERS=real`, contre les faux serveurs LOCAUX de WP05 à WP07. Aucun appel réseau externe.
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/config';
import { computeSignature, STRIPE_SCHEME, WAVE_SCHEME } from '../../../src/psp/hmac-signature';
import { FakePspSecretStore } from '../../../src/psp/fake/fake-psp-secret-store';
import type { PspSecretBinding, PspSecrets } from '../../../src/psp/psp-secret-store.port';
import { createPspAdapters } from '../../../src/psp/psp.providers';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../../src/psp/psp.tokens';
import { Secret } from '../../../src/psp/secret';
import type { PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import { startFakePayDunya, type FakePayDunya } from '../../support/fake-servers/paydunya';
import { startFakeStripe, type FakeStripe } from '../../support/fake-servers/stripe';
import { startFakeWave, WAVE_TEST_API_KEY } from '../../support/fake-servers/wave';
import { ownerRows } from '../../support/media-fixtures';
import { withOwner } from '../../support/db';
import { closeBacklog, closePending, WebhookWorld } from '../webhooks/webhook-fixtures';

jest.setTimeout(120_000);

const STRIPE_KEY = 'sk_test_cle_de_test_locale';
const PAYDUNYA_PRIVATE = 'test_private_local';
const PAYDUNYA_TOKEN = 'test_token_local';

/** Coffre de test : les notifications gardent leur secret (faux coffre du monde), les identifiants sont typés. */
class TypedStore extends FakePspSecretStore {
  override async get(binding: PspSecretBinding): Promise<PspSecrets> {
    const base = await super.get(binding);
    const notification = base.notification;
    switch (binding.provider) {
      case 'WAVE':
        return {
          notification,
          credentials: {
            provider: 'WAVE',
            apiKey: Secret.of(WAVE_TEST_API_KEY),
            requestSigningSecret: null,
          },
        };
      case 'PAYDUNYA':
        return {
          notification,
          credentials: {
            provider: 'PAYDUNYA',
            masterKey: notification.current, // la clé maître est le secret de notification (WP08, L4)
            privateKey: Secret.of(PAYDUNYA_PRIVATE),
            token: Secret.of(PAYDUNYA_TOKEN),
          },
        };
      case 'STRIPE':
        return {
          notification,
          credentials: { provider: 'STRIPE', secretKey: Secret.of(STRIPE_KEY) },
        };
      default:
        return base;
    }
  }
}

describe('adaptateurs réels : un seul crédit sous 100 notifications identiques (NFR-005)', () => {
  let w: WebhookWorld;
  let wave: Awaited<ReturnType<typeof startFakeWave>>;
  let stripe: FakeStripe;
  let paydunya: FakePayDunya;
  let paydunyaConfig: string;

  beforeAll(async () => {
    wave = await startFakeWave();
    stripe = await startFakeStripe();
    paydunya = await startFakePayDunya();
    const config = loadConfig({
      NODE_ENV: 'test',
      PSP_ADAPTERS: 'real',
      WAVE_API_BASE: wave.server.url,
      STRIPE_API_BASE: stripe.url,
      PAYDUNYA_API_BASE: paydunya.base,
    });
    // La fabrique de production, avec `real` : trois adaptateurs, jamais Orange Money.
    const registry = createPspAdapters(config);
    expect(registry.forProvider('WAVE').isFake).toBe(false);
    w = await WebhookWorld.create([
      { provide: PSP_ADAPTERS, useValue: registry },
      { provide: PSP_SECRET_STORE, useValue: new TypedStore() },
    ]);
    await closeBacklog();
    await closePending();
    paydunyaConfig = await seedPaydunya();
  }, 240_000);

  afterAll(async () => {
    await w?.close();
    await Promise.all([wave?.close(), stripe?.close(), paydunya?.close()]);
  });

  async function seedPaydunya(): Promise<string> {
    const ref = `psp/${w.p.holderId}/test-paydunya-${randomUUID().slice(0, 8)}`;
    const id = await withOwner(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO psp_configuration (operator_id, organizer_id, method, provider, holder_party_id,
                secret_ref, compliance_ref, status, is_default, valid_from, created_by, approved_by,
                activated_at)
         VALUES ($1, $2, 'CARD', 'PAYDUNYA', $3, $4, 'KYB-TEST', 'ACTIVE', false, '2026-01-01', $5, $6,
                 now())
         RETURNING psp_configuration_id AS id`,
        [
          w.p.op,
          w.p.w.ids.organizerA,
          w.p.holderId,
          ref,
          w.p.w.operatorAdminA.userId,
          w.p.w.organizerAdminA.userId,
        ],
      );
      return rows[0]!.id;
    });
    w.p.store.put(ref, { current: `pd-master-${randomUUID()}`, key: 'pd-key' });
    await ownerRows(
      `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
                             rate_bps, trigger, valid_from)
       VALUES ($1, 'PSP_CONFIGURATION', $2, 'ORG_FPSP', 'PSP_FRAIS', 'TOPUP_AMOUNT', 150, 'REALTIME',
               '2026-01-01')`,
      [w.p.op, id],
    );
    return id;
  }

  const status = async (t: PspTopupRow) => (await w.p.read(t.topupId))!.status;
  const credits = (t: PspTopupRow) => w.p.transactions(t.topupId);
  const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  async function until(condition: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('condition non atteinte');
  }

  it('Wave : 100 notifications identiques en parallèle, un seul crédit', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    const body = JSON.stringify({
      id: `evt-${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        id: 'cos-real-1',
        client_reference: t.topupId,
        amount: String(t.amount),
        currency: t.currency,
        checkout_status: 'complete',
        payment_status: 'succeeded',
      },
    });
    const secret = Secret.of(await w.secretOf('WAVE'));
    const ts = nowSeconds();
    const header = `t=${ts},v1=${computeSignature(secret, ts, Buffer.from(body), WAVE_SCHEME)}`;
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        w.raw(body, { 'wave-signature': header }, { method: 'WAVE' }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    await settle();
    expect(await credits(t)).toHaveLength(1);
    // Une signature fausse reste refusée avec l'adaptateur réel : rien n'est ajouté.
    const forged = `t=${ts},v1=${'0'.repeat(64)}`;
    expect((await w.raw(body, { 'wave-signature': forged }, { method: 'WAVE' })).status).toBe(401);
    expect(await credits(t)).toHaveLength(1);
  });

  it('Stripe : 100 notifications identiques, une seule relecture appliquée, un seul crédit', async () => {
    const t = (await w.p.topup({ method: 'CARD' })).row;
    const sessionId = `cs_test_${randomUUID().slice(0, 8)}`;
    const intentId = `pi_${randomUUID().slice(0, 8)}`;
    await ownerRows('UPDATE psp_topup SET provider_payment_ref = $2 WHERE psp_topup_id = $1', [
      t.topupId,
      sessionId,
    ]);
    stripe.sessions.set(sessionId, {
      id: sessionId,
      status: 'complete',
      payment_status: 'paid',
      amount_total: Number(t.amount),
      currency: 'xof',
      client_reference_id: t.topupId,
      payment_intent: intentId,
    });
    stripe.intents.set(intentId, {
      id: intentId,
      status: 'succeeded',
      latest_charge: {
        payment_method_details: {
          card: { fingerprint: 'fp-real-1', three_d_secure: { result: 'authenticated' } },
        },
      },
    });
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_status: 'paid',
          amount_total: Number(t.amount),
          currency: 'xof',
          client_reference_id: t.topupId,
        },
      },
    });
    const secret = Secret.of(await w.secretOf('CARD'));
    const ts = nowSeconds();
    const header = `t=${ts},v1=${computeSignature(secret, ts, Buffer.from(body), STRIPE_SCHEME)}`;
    const before = stripe.requests.filter((r) =>
      r.path.startsWith(`/v1/checkout/sessions/${sessionId}`),
    );
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        w.raw(body, { 'stripe-signature': header }, { method: 'CARD' }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    await settle();
    expect(await credits(t)).toHaveLength(1);
    const reads = stripe.requests
      .filter((r) => r.method === 'GET' && r.path.startsWith(`/v1/checkout/sessions/${sessionId}`))
      .filter((r) => !before.includes(r));
    expect(reads).toHaveLength(1);
  });

  it('PayDunya : 100 signaux identiques, une relecture, aucun crédit (carte sans 3-D Secure, D7)', async () => {
    // La recharge CARD est rattachée à la configuration PayDunya (seule active par défaut le temps de la création).
    const setDefault = async (configId: string) => {
      await ownerRows(
        `UPDATE psp_configuration SET is_default = false
          WHERE operator_id = $1 AND method = 'CARD' AND status = 'ACTIVE' AND is_default`,
        [w.p.op],
      );
      await ownerRows(
        'UPDATE psp_configuration SET is_default = true WHERE psp_configuration_id = $1',
        [configId],
      );
    };
    await setDefault(paydunyaConfig);
    let t: PspTopupRow;
    try {
      t = (await w.p.topup({ method: 'CARD' })).row;
    } finally {
      await setDefault(w.p.configs.CARD);
    }
    expect(t.configurationId).toBe(paydunyaConfig);
    const token = `tok_${randomUUID().slice(0, 8)}`;
    await ownerRows('UPDATE psp_topup SET provider_payment_ref = $2 WHERE psp_topup_id = $1', [
      t.topupId,
      token,
    ]);
    paydunya.options.confirm = {
      response_code: '00',
      response_text: 'ok',
      status: 'completed',
      invoice: { total_amount: Number(t.amount) },
      custom_data: { psp_topup_id: t.topupId },
    };
    const hash = createHash('sha512')
      .update(await masterKeyOf(paydunyaConfig))
      .digest('hex');
    const body =
      `data[hash]=${hash}&data[status]=completed&data[invoice][token]=${token}` +
      `&data[custom_data][psp_topup_id]=${t.topupId}`;
    const before = paydunya.requests.length;
    const before2 = (await w.events(paydunyaConfig)).length;
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        w.raw(
          body,
          { 'content-type': 'application/x-www-form-urlencoded' },
          { method: 'CARD', configId: paydunyaConfig, segment: 'paydunya' },
        ),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    await until(() => paydunya.requests.length > before);
    await settle(1500);
    // Reçue une fois, relue une fois, non créditée : la confirmation ne prouve pas le 3-D Secure.
    expect(paydunya.requests.slice(before)).toHaveLength(1);
    expect(paydunya.requests.at(-1)!.path).toBe(`/api/v1/checkout-invoice/confirm/${token}`);
    expect((await w.events(paydunyaConfig)).length).toBe(before2 + 1);
    expect(await credits(t)).toHaveLength(0);
    expect(await status(t)).not.toBe('SUCCEEDED');
  });

  async function masterKeyOf(configId: string): Promise<string> {
    const [row] = await ownerRows<{ secret_ref: string }>(
      'SELECT secret_ref FROM psp_configuration WHERE psp_configuration_id = $1',
      [configId],
    );
    const secrets = await w.p.store.get({
      provider: 'PAYDUNYA',
      configurationId: configId,
      holderPartyId: w.p.holderId,
      secretRef: row!.secret_ref,
    });
    return secrets.notification.current.reveal();
  }
});
