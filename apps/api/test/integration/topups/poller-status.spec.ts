// Intégration : interrogation des recharges PSP en attente (lot WP12, T062 ; R-12, A15, A33 ; FR-015).
import { TenantTx } from '../../../src/db/tenant-tx';
import { runWorkers } from '../../../src/processes/bootstrap';
import { PspPollerProcessModule } from '../../../src/processes/psp-poller.module';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { registerPayment } from '../webhooks/poll-fixtures';
import {
  ageTopup,
  captureLogs,
  closeBacklog,
  startPoller,
  WebhookWorld,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(60_000);

describe('interrogation des recharges PSP', () => {
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

  it('processus démarré : les trois travailleurs sont enregistrés', () => {
    expect(proc.workers.names().sort()).toEqual([
      'psp-event-purge',
      'psp-event-retry',
      'psp-poller',
    ]);
  });

  it('paiement vu par l’interrogation : une seule écriture, même clé qu’une notification du même paiement', async () => {
    const t = await w.p.topup({ method: 'WAVE' });
    const ref = await registerPayment(w, t.row, 'PAID');
    await ageTopup(t.row.topupId);
    expect(await proc.poller.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await status(t.row.topupId)).toBe('SUCCEEDED');
    const [tx] = await w.p.transactions(t.row.topupId);
    expect(tx!.idempotency_key).toBe(`wave:${t.row.configurationId}:${ref}`);
    // La notification du même paiement arrive ensuite : doublon, aucune écriture de plus.
    const res = await w.post(w.event(t.row, { paymentId: ref }));
    expect(res.status).toBe(200);
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    expect((await w.events(t.row.configurationId)).at(-1)).toMatchObject({
      outcome: 'DUPLICATE_PAYMENT',
    });
  });

  it('notification d’abord, interrogation ensuite : une seule écriture', async () => {
    const t = await w.p.topup({ method: 'ORANGE_MONEY' });
    const ref = await registerPayment(w, t.row, 'PAID');
    await w.post(w.event(t.row, { paymentId: ref }), { method: 'ORANGE_MONEY' });
    expect(await status(t.row.topupId)).toBe('SUCCEEDED');
    await ageTopup(t.row.topupId);
    await proc.poller.runOnce();
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
  });

  it('recharge non payée et non échue : laissée PENDING', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PENDING');
    await ageTopup(t.row.topupId);
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('PENDING');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
  });

  it('recharge de moins de 2 minutes : pas encore interrogée', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PAID');
    const getStatus = jest.spyOn(w.p.adapter('WAVE'), 'getStatus');
    await proc.poller.runOnce();
    expect(getStatus.mock.calls.map(([query]) => query.merchantReference)).not.toContain(
      t.row.topupId,
    );
    expect(await status(t.row.topupId)).toBe('PENDING');
  });

  it('échec confirmé chez le PSP : FAILED, rien au grand livre', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'FAILED');
    await ageTopup(t.row.topupId);
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('FAILED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
  });

  it('annulation confirmée chez le PSP : CANCELLED', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'CANCELLED');
    await ageTopup(t.row.topupId);
    await proc.poller.runOnce();
    expect(await status(t.row.topupId)).toBe('CANCELLED');
  });

  it('paiement d’un autre montant vu par l’interrogation : écart PSP_MISMATCH, rien crédité', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PAID');
    await ageTopup(t.row.topupId);
    const adapter = w.p.adapter('WAVE');
    const real = adapter.getStatus.bind(adapter);
    const before = (await w.p.anomalies('PSP_MISMATCH')).length;
    jest.spyOn(adapter, 'getStatus').mockImplementation(async (query, secrets) => {
      const result = await real(query, secrets);
      return query.merchantReference === t.row.topupId && result.payment
        ? { ...result, payment: { ...result.payment, amount: result.payment.amount + 1n } }
        : result;
    });
    await proc.poller.runOnce();
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
    expect((await w.p.anomalies('PSP_MISMATCH')).length).toBe(before + 1);
  });

  it('aucune requête vers le PSP pendant qu’une transaction tient un verrou (R-12)', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PAID');
    await ageTopup(t.row.topupId);
    const tx = proc.app.get(TenantTx, { strict: false });
    let open = 0;
    const wrap = (name: 'run' | 'withoutTenant') => {
      const original = tx[name].bind(tx) as (...args: unknown[]) => Promise<unknown>;
      jest.spyOn(tx, name).mockImplementation(((...args: unknown[]) => {
        const fn = args[args.length - 1] as (client: unknown) => Promise<unknown>;
        args[args.length - 1] = async (client: unknown) => {
          open += 1;
          try {
            return await fn(client);
          } finally {
            open -= 1;
          }
        };
        return original(...args);
      }) as never);
    };
    wrap('run');
    wrap('withoutTenant');
    const seen: number[] = [];
    const adapter = w.p.adapter('WAVE');
    const original = adapter.getStatus.bind(adapter);
    jest.spyOn(adapter, 'getStatus').mockImplementation((...args) => {
      seen.push(open);
      return original(...args);
    });
    await proc.poller.runOnce();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((depth) => depth === 0)).toBe(true);
    expect(await status(t.row.topupId)).toBe('SUCCEEDED');
  });

  it('production, fournisseur indisponible : travailleur inactif (0, aucune erreur, aucune alerte)', async () => {
    const t = await w.p.topup();
    await registerPayment(w, t.row, 'PAID');
    await ageTopup(t.row.topupId);
    const getStatus = jest.spyOn(w.p.adapter('WAVE'), 'getStatus');
    const inactive = await startPoller(w, { registry: new PspAdapterRegistry([], false) });
    try {
      expect(await inactive.poller.runOnce()).toBe(0);
      expect(await inactive.poller.describe()).toEqual([expect.stringContaining('inactif')]);
      expect(inactive.poller.alarm()).toBe(0);
      expect(getStatus).not.toHaveBeenCalled();
    } finally {
      await inactive.close();
    }
    expect(await status(t.row.topupId)).toBe('PENDING');
  });

  it('--list n’écrit rien, --once rend 0 sans travail', async () => {
    await closeBacklog();
    const before = await w.footprint();
    const logs = captureLogs();
    let listed: number;
    let once: number;
    try {
      listed = await runWorkers(PspPollerProcessModule, ['--list']);
      expect(await w.footprint()).toEqual(before);
      once = await runWorkers(PspPollerProcessModule, ['--once']);
    } finally {
      logs.restore();
    }
    expect(listed).toBe(0);
    expect(once).toBe(0);
    expect(logs.text()).not.toMatch(/v1=/i);
  });
});
