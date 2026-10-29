// Intégration : codes d'alerte du processus `psp-poller` (lot WP12, T063 ; A22, A30). L'ordonnanceur alerte sur tout
// code de sortie non nul : 2 interrogation en échec, 3 événement abandonné, 4 purge en échec.
import { TenantTx } from '../../../src/db/tenant-tx';
import {
  ALARM_EVENT_RETRY_EXHAUSTED,
  ALARM_POLL_FAILURE,
  ALARM_PURGE_FAILED,
} from '../../../src/topups/poller/poller-alarms';
import { registerPayment } from '../webhooks/poll-fixtures';
import {
  ageTopup,
  captureLogs,
  closeBacklog,
  closePending,
  insertEvent,
  startPoller,
  WebhookWorld,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(60_000);

describe('codes d’alerte du processus psp-poller', () => {
  let w: WebhookWorld;

  beforeAll(async () => {
    w = await WebhookWorld.create();
    await closeBacklog();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });
  afterEach(() => jest.restoreAllMocks());

  it('constantes nommées, distinctes de celles du contrôle quotidien', () => {
    expect([ALARM_POLL_FAILURE, ALARM_EVENT_RETRY_EXHAUSTED, ALARM_PURGE_FAILED]).toEqual([
      2, 3, 4,
    ]);
  });

  it('rien à signaler : 0', async () => {
    await closeBacklog();
    await closePending();
    const proc = await startPoller(w);
    try {
      await proc.workers.drain();
      expect(proc.workers.alarm()).toBe(0);
    } finally {
      await proc.close();
    }
  });

  it('adaptateur en échec : code 2, journal sans secret, la recharge suivante est quand même traitée', async () => {
    const down = await w.p.topup();
    const fine = await w.p.topup();
    await registerPayment(w, down.row, 'PAID');
    await registerPayment(w, fine.row, 'PAID');
    await ageTopup(down.row.topupId);
    await ageTopup(fine.row.topupId);
    const adapter = w.p.adapter('WAVE');
    const real = adapter.getStatus.bind(adapter);
    jest
      .spyOn(adapter, 'getStatus')
      .mockImplementation((query, secrets) =>
        query.merchantReference === down.row.topupId
          ? Promise.reject(new Error('PSP injoignable : secret-canari-987'))
          : real(query, secrets),
      );
    const proc = await startPoller(w);
    const logs = captureLogs();
    try {
      expect(await proc.poller.runOnce()).toBeGreaterThanOrEqual(1);
      expect(proc.poller.alarm()).toBe(ALARM_POLL_FAILURE);
      expect(proc.workers.alarm()).toBe(2);
    } finally {
      logs.restore();
      await proc.close();
    }
    expect((await w.p.read(down.row.topupId))?.status).toBe('PENDING');
    expect((await w.p.read(fine.row.topupId))?.status).toBe('SUCCEEDED');
    expect(logs.text()).toContain('psp.poll.failed');
    expect(logs.text()).not.toContain('secret-canari-987');
  });

  it('événement au-delà de 5 essais : code 3', async () => {
    const t = await w.p.topup();
    await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification: w.p.notification(t.row),
      status: 'RETRY',
      attempts: 6,
    });
    const proc = await startPoller(w);
    try {
      await proc.retry.runOnce();
      expect(proc.workers.alarm()).toBe(3);
    } finally {
      await proc.close();
    }
    await closeBacklog();
  });

  it('purge en échec : code 4, la panne est journalisée sans donnée sensible', async () => {
    const proc = await startPoller(w);
    const tx = proc.app.get(TenantTx, { strict: false });
    const logs = captureLogs();
    try {
      jest.spyOn(tx, 'withoutTenant').mockRejectedValue(new Error('panne secret-canari-654'));
      expect(await proc.purge.runOnce()).toBe(0);
      expect(proc.purge.alarm()).toBe(ALARM_PURGE_FAILED);
      expect(proc.workers.alarm()).toBe(4);
    } finally {
      logs.restore();
      await proc.close();
    }
    expect(logs.text()).toContain('psp.purge.failed');
    expect(logs.text()).not.toContain('secret-canari-654');
  });

  it('le code le plus grave l’emporte', async () => {
    const proc = await startPoller(w);
    try {
      jest.spyOn(proc.poller, 'alarm').mockReturnValue(2);
      jest.spyOn(proc.purge, 'alarm').mockReturnValue(4);
      expect(proc.workers.alarm()).toBe(4);
    } finally {
      await proc.close();
    }
  });
});
