// Intégration : expiration des recharges PSP par l'interrogation (lot WP12, T062 ; R-12, A15). L'échéance ne tranche
// qu'APRÈS la relecture du statut chez le PSP : un paiement tardif est un succès, pas une expiration.
import { registerPayment } from '../webhooks/poll-fixtures';
import {
  ageTopup,
  closeBacklog,
  startPoller,
  WebhookWorld,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(60_000);

describe('expiration des recharges PSP', () => {
  let w: WebhookWorld;
  let proc: PollerProcess;

  beforeAll(async () => {
    w = await WebhookWorld.create();
    await closeBacklog();
    proc = await startPoller(w);
  }, 240_000);
  afterAll(async () => {
    await proc.close();
    await w.close();
  });
  afterEach(() => jest.restoreAllMocks());

  const status = async (topupId: string) => (await w.p.read(topupId))!.status;

  it('échéance dépassée et statut non payé : EXPIRED, aucune écriture au grand livre', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PENDING');
    await ageTopup(t.row.topupId, { expired: true });
    expect(await proc.poller.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await status(t.row.topupId)).toBe('EXPIRED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
  });

  it('échéance dépassée, recharge inconnue du PSP (initiate en échec) : EXPIRED', async () => {
    const t = await w.p.topup();
    await ageTopup(t.row.topupId, { expired: true });
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('EXPIRED');
  });

  it('échéance dépassée mais payée entre-temps : traitée comme un succès, jamais expirée', async () => {
    const t = await w.p.topup();
    const ref = await registerPayment(w, t.row, 'PAID');
    await ageTopup(t.row.topupId, { expired: true });
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('SUCCEEDED');
    const [tx] = await w.p.transactions(t.row.topupId);
    expect(tx!.idempotency_key).toBe(`wave:${t.row.configurationId}:${ref}`);
  });

  it('le statut est lu AVANT l’expiration (ordre : lecture du PSP puis écriture)', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PENDING');
    await ageTopup(t.row.topupId, { expired: true });
    const order: string[] = [];
    const adapter = w.p.adapter('WAVE');
    const original = adapter.getStatus.bind(adapter);
    jest.spyOn(adapter, 'getStatus').mockImplementation(async (query, secrets) => {
      if (query.merchantReference === t.row.topupId)
        order.push(`getStatus:${await status(t.row.topupId)}`);
      return original(query, secrets);
    });
    await proc.poller.runOnce();
    // Au moment de la lecture chez le PSP, la recharge est encore PENDING ; elle ne devient EXPIRED qu'ensuite.
    expect(order).toEqual(['getStatus:PENDING']);
    expect(await status(t.row.topupId)).toBe('EXPIRED');
  });

  it('recharge plus ancienne que 2 minutes mais non échue : jamais expirée', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PENDING');
    await ageTopup(t.row.topupId, { minutes: 10 });
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('PENDING');
  });

  it('succès tardif après expiration (notification) : crédité, recevable (R-20)', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PENDING');
    await ageTopup(t.row.topupId, { expired: true });
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('EXPIRED');
    const res = await w.post(w.event(t.row));
    expect(res.status).toBe(200);
    expect(await status(t.row.topupId)).toBe('SUCCEEDED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
  });
});
