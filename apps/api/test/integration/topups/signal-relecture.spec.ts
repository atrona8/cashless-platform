// Intégration : signal PSP et relecture asynchrone (mission 12b-1, lot WP03 ; FR-001, FR-006, NFR-005, SC-002).
// HTTPS réel, vraie base, `FakeSignalPspAdapter` pour WAVE et PAYDUNYA (le signal ne porte ni montant ni statut :
// le crédit ne vient que de `getStatus`). Aucun appel réseau.
import { randomUUID } from 'node:crypto';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import {
  FakeSignalPspAdapter,
  fakeSignalHeaderValue,
  SIGNAL_HEADER_NAME,
} from '../../../src/psp/fake/fake-signal-psp-adapter';
import { PSP_ADAPTERS } from '../../../src/psp/psp.tokens';
import { PSP_PROVIDERS, type PspStatusResult } from '../../../src/psp/psp.types';
import { PspStatusConfirmer } from '../../../src/topups/psp/psp-status-confirmer';
import type { PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { closeBacklog, closePending, WebhookWorld } from '../webhooks/webhook-fixtures';

jest.setTimeout(90_000);

const waveSignal = new FakeSignalPspAdapter('WAVE');
const paydunyaSignal = new FakeSignalPspAdapter('PAYDUNYA');
const registry = new PspAdapterRegistry(
  PSP_PROVIDERS.map((provider) =>
    provider === 'WAVE'
      ? waveSignal
      : provider === 'PAYDUNYA'
        ? paydunyaSignal
        : new FakePspAdapter(provider),
  ),
  true,
);

describe('signal PSP et relecture asynchrone', () => {
  let w: WebhookWorld;
  let confirmer: PspStatusConfirmer;
  let paydunyaConfig: string;

  beforeAll(async () => {
    w = await WebhookWorld.create([{ provide: PSP_ADAPTERS, useValue: registry }]);
    await closeBacklog();
    await closePending();
    confirmer = w.p.sw.api.app.get(PspStatusConfirmer, { strict: false });
    paydunyaConfig = await seedPaydunya();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });
  afterEach(() => jest.restoreAllMocks());

  /** Configuration PAYDUNYA (carte), non par défaut, avec un secret dans le faux coffre. */
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
    w.p.store.put(ref, { current: `pd-secret-${randomUUID()}`, key: 'pd-key' });
    return id;
  }

  const paid = (t: PspTopupRow, over: { amount?: bigint } = {}): PspStatusResult => ({
    state: 'PAID',
    payment: {
      merchantReference: t.topupId,
      providerPaymentRef: `pay-${t.topupId.slice(0, 8)}`,
      amount: over.amount ?? t.amount,
      currency: t.currency,
      card: null,
    },
  });

  async function signal(
    t: PspTopupRow,
    over: {
      id?: string;
      secret?: string;
      paymentId?: string;
      merchantReference?: string | null;
    } = {},
  ) {
    const secret = over.secret ?? (await w.secretOf('WAVE'));
    const body = JSON.stringify({
      id: over.id ?? `sig-${randomUUID()}`,
      merchantReference: over.merchantReference === undefined ? t.topupId : over.merchantReference,
      paymentId: over.paymentId ?? `pay-${t.topupId.slice(0, 8)}`,
    });
    return w.raw(body, { [SIGNAL_HEADER_NAME]: fakeSignalHeaderValue(secret) }, { method: 'WAVE' });
  }

  const status = async (t: PspTopupRow) => (await w.p.read(t.topupId))!.status;
  const credits = (t: PspTopupRow) => w.p.transactions(t.topupId);

  async function until(condition: () => Promise<boolean> | boolean, ms = 8000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('condition non atteinte');
  }
  const settleDown = () => new Promise((resolve) => setTimeout(resolve, 400));

  it('signal PENDING : 200, rien crédité ; puis PAID et nouvelle relecture : crédit une seule fois', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    waveSignal.setStatus(t.topupId, { state: 'PENDING', payment: null });
    const before = await w.footprint();
    const res = await signal(t);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    await until(() => getStatus.mock.calls.length === 1);
    await settleDown();
    expect(await status(t)).toBe('PENDING');
    expect(await credits(t)).toHaveLength(0);
    const after = await w.footprint();
    expect(after.journal_transaction).toBe(before.journal_transaction);
    expect(after.posting).toBe(before.posting);
    // L'événement du signal est conservé, nature UNKNOWN, traité sans effet, sans montant.
    const events = await w.events(t.configurationId);
    expect(events.at(-1)).toMatchObject({
      kind: 'UNKNOWN',
      status: 'PROCESSED',
      outcome: 'NO_EFFECT',
    });
    const [norm] = await ownerRows<{ normalized: Record<string, unknown>; body: Buffer | null }>(
      `SELECT normalized, body FROM psp_event WHERE psp_configuration_id = $1
        ORDER BY received_at DESC LIMIT 1`,
      [t.configurationId],
    );
    expect(JSON.stringify(norm!.normalized)).not.toMatch(/amount/i);
    expect(norm!.body).toBeNull();

    // Le PSP dit PAID : un nouveau signal, plus d'une minute après, provoque la relecture et le crédit.
    waveSignal.setStatus(t.topupId, paid(t));
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => realNow + 61_000);
    expect((await signal(t)).status).toBe(200);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    expect(await credits(t)).toHaveLength(1);
  });

  it('100 signaux identiques en parallèle : un seul événement, une relecture, un seul crédit', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, paid(t));
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    const fixed = `sig-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 100 }, () => signal(t, { id: fixed })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    await settleDown();
    expect(await credits(t)).toHaveLength(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('100 signaux d’identifiants distincts : une relecture (borne par minute), un seul crédit', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, paid(t));
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    const results = await Promise.all(Array.from({ length: 100 }, () => signal(t)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    await settleDown();
    expect(await credits(t)).toHaveLength(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('relectures concurrentes sans borne (appel direct du confirmateur) : un seul crédit', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, paid(t));
    const topup = {
      pspTopupId: t.topupId,
      operatorId: t.operatorId,
      pspConfigurationId: t.configurationId,
      provider: 'WAVE' as const,
      providerPaymentRef: null,
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => confirmer.confirm(topup)));
    expect(results.every((r) => r === 'APPLIED')).toBe(true);
    expect(await credits(t)).toHaveLength(1);
  });

  it('signal à preuve fausse : 401, rien conservé, aucun appel à getStatus', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, paid(t));
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    const before = await w.footprint();
    const res = await signal(t, { secret: 'mauvais-secret' });
    expect(res.status).toBe(401);
    await settleDown();
    expect(getStatus).not.toHaveBeenCalled();
    expect(await w.footprint()).toEqual(before);
    expect(await status(t)).toBe('PENDING');
  });

  it('signal valide mais montant différent chez le PSP : aucune écriture, anomalie PSP_MISMATCH', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, paid(t, { amount: t.amount + 1n }));
    const before = (await w.p.anomalies('PSP_MISMATCH')).length;
    expect((await signal(t)).status).toBe(200);
    await until(async () => (await w.p.anomalies('PSP_MISMATCH')).length === before + 1);
    expect(await status(t)).toBe('PENDING');
    expect(await credits(t)).toHaveLength(0);
  });

  it('signal d’une recharge inconnue ou d’une autre configuration : rien, aucun appel', async () => {
    const other = (await w.p.topup({ method: 'ORANGE_MONEY' })).row;
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    expect((await signal(other)).status).toBe(200); // recharge d'une autre configuration
    expect(
      (await signal(other, { merchantReference: randomUUID(), paymentId: 'inconnu' })).status,
    ).toBe(200);
    await settleDown();
    expect(getStatus).not.toHaveBeenCalled();
    expect(await status(other)).toBe('PENDING');
  });

  it('la réponse est rendue avant la relecture (getStatus bloqué : la réponse arrive quand même)', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const getStatus = jest.spyOn(waveSignal, 'getStatus').mockImplementation(async () => {
      await gate;
      return paid(t);
    });
    const res = await signal(t);
    // Si la relecture se faisait dans la requête, la réponse n'arriverait jamais tant que le PSP est bloqué.
    expect(res.status).toBe(200);
    expect(await status(t)).toBe('PENDING');
    await until(() => getStatus.mock.calls.length === 1);
    release();
    await until(async () => (await status(t)) === 'SUCCEEDED');
    expect(await credits(t)).toHaveLength(1);
  });

  it('deux signaux de la même recharge à 1 s d’écart : une seule relecture', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    waveSignal.setStatus(t.topupId, { state: 'PENDING', payment: null });
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    await signal(t);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await signal(t);
    await settleDown();
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('la borne tient aussi quand le signal désigne la recharge par une autre référence', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    // La référence du PSP est connue de la recharge (comme après `initiate`).
    await ownerRows('UPDATE psp_topup SET provider_payment_ref = $2 WHERE psp_topup_id = $1', [
      t.topupId,
      `ref-${t.topupId.slice(0, 8)}`,
    ]);
    waveSignal.setStatus(t.topupId, { state: 'PENDING', payment: null });
    const getStatus = jest.spyOn(waveSignal, 'getStatus');
    await signal(t);
    await signal(t, { merchantReference: null, paymentId: `ref-${t.topupId.slice(0, 8)}` });
    await settleDown();
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('relecture en échec : la borne par minute n’est pas posée, le signal suivant relit', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    const getStatus = jest
      .spyOn(waveSignal, 'getStatus')
      .mockRejectedValueOnce(new Error('panne réseau'))
      .mockResolvedValue(paid(t));
    jest.spyOn((await import('@nestjs/common')).Logger.prototype, 'error').mockImplementation();
    await signal(t);
    await until(() => getStatus.mock.calls.length === 1);
    await settleDown();
    expect(await status(t)).toBe('PENDING');
    // Aucune minute écoulée : sans la correction, la borne bloquerait cette relecture.
    await signal(t);
    await until(async () => (await status(t)) === 'SUCCEEDED');
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(await credits(t)).toHaveLength(1);
  });

  it('erreur du PSP à la relecture : FAILED, recharge PENDING, aucun secret dans le journal', async () => {
    const t = (await w.p.topup({ method: 'WAVE' })).row;
    jest.spyOn(waveSignal, 'getStatus').mockRejectedValue(new Error('cle-secrete-xyz'));
    const lines: string[] = [];
    const { Logger } = await import('@nestjs/common');
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(((m: unknown) => lines.push(String(m))) as never);
    const result = await confirmer.confirm({
      pspTopupId: t.topupId,
      operatorId: t.operatorId,
      pspConfigurationId: t.configurationId,
      provider: 'WAVE',
      providerPaymentRef: null,
    });
    expect(result).toBe('FAILED');
    expect(await status(t)).toBe('PENDING');
    expect(lines.join('\n')).toContain('psp.confirm.failed');
    expect(lines.join('\n')).not.toContain('cle-secrete-xyz');
  });

  describe('format du corps', () => {
    it('formulaire envoyé à /webhooks/wave : 400, le coffre n’est pas interrogé', async () => {
      const t = (await w.p.topup({ method: 'WAVE' })).row;
      const get = jest.spyOn(w.p.store, 'get');
      const res = await w.raw(
        `data[hash]=abc&id=${t.topupId}`,
        { 'content-type': 'application/x-www-form-urlencoded' },
        { method: 'WAVE' },
      );
      expect(res.status).toBe(400);
      expect(get).not.toHaveBeenCalled();
    });

    it('type de contenu inconnu : 400 avant le coffre', async () => {
      const get = jest.spyOn(w.p.store, 'get');
      const res = await w.raw('x', { 'content-type': 'text/plain' }, { method: 'WAVE' });
      expect(res.status).toBe(400);
      expect(get).not.toHaveBeenCalled();
    });

    it('formulaire envoyé à /webhooks/paydunya : transmis à l’adaptateur en `form`, corps brut intact', async () => {
      const verify = jest.spyOn(paydunyaSignal, 'verifyNotification');
      const body = 'data%5Bhash%5D=abc&data%5Binvoice%5D%5Btoken%5D=tok1';
      await w.raw(
        body,
        { 'content-type': 'application/x-www-form-urlencoded' },
        { method: 'CARD', configId: paydunyaConfig, segment: 'paydunya' },
      );
      expect(verify).toHaveBeenCalledTimes(1);
      const call = verify.mock.calls[0]![0];
      expect(call.contentType).toBe('form');
      expect(call.rawBody.toString('utf8')).toBe(body);
    });

    it('JSON envoyé à /webhooks/paydunya : transmis à l’adaptateur en `json` (qui le refuse ici : 400)', async () => {
      const verify = jest.spyOn(paydunyaSignal, 'verifyNotification');
      const res = await w.raw(
        '{"a":1}',
        {},
        { method: 'CARD', configId: paydunyaConfig, segment: 'paydunya' },
      );
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]![0].contentType).toBe('json');
      expect(res.status).toBe(401);
    });
  });
});
