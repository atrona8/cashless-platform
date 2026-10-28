// Intégration : reprises des notifications conservées (lot WP12, T061, T062 point 4 ; A2, A4, A33).
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../../src/audit/audit.service';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DepositService } from '../../../src/media/lifecycle/deposit.service';
import { PspPaymentProcessor } from '../../../src/topups/psp/psp-payment-processor';
import { ALARM_EVENT_RETRY_EXHAUSTED } from '../../../src/topups/poller/poller-alarms';
import { EventDispatcher, type DisputeHandler } from '../../../src/webhooks/event-dispatcher';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  createBatch,
  ownerRows,
  seedPersonalizedMedia,
} from '../../support/media-fixtures';
import {
  closeBacklog,
  insertEvent,
  startPoller,
  topupWithId,
  WebhookWorld,
  type PollerProcess,
} from './webhook-fixtures';

jest.setTimeout(60_000);

describe('reprises des notifications', () => {
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

  const event = (id: string) =>
    ownerRows<{ status: string; outcome: string | null; attempts: number }>(
      'SELECT status, outcome, attempts FROM psp_event WHERE psp_event_id = $1',
      [id],
    ).then((rows) => rows[0]!);
  const mismatches = () =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE kind = 'PSP_MISMATCH' AND ledger_id IS NULL`,
    ).then((rows) => rows[0]!.n);

  /** Notification de succès d'une recharge qui n'existe pas (encore). */
  const orphan = (topupId: string, paymentRef: string) =>
    w.p.notification(
      { topupId, amount: 10000n, currency: 'XOF', method: 'WAVE', walletId: randomUUID() } as never,
      { paymentRef, merchantRef: topupId },
    );

  it('UNMATCHED repris : la recharge existe maintenant, un seul TOPUP', async () => {
    const topupId = randomUUID();
    const notification = orphan(topupId, `pay-${topupId.slice(0, 8)}`);
    const id = await insertEvent({
      configId: w.p.configs.WAVE,
      operatorId: w.p.op,
      notification,
      status: 'UNMATCHED',
      ageHours: 2,
    });
    expect(await proc.retry.runOnce()).toBe(0);
    expect((await event(id)).status).toBe('UNMATCHED');
    await topupWithId(w, topupId);
    expect(await proc.retry.runOnce()).toBe(1);
    expect(await event(id)).toMatchObject({ status: 'PROCESSED', outcome: 'CREDITED' });
    expect(await proc.retry.runOnce()).toBe(0);
    expect(await w.p.transactions(topupId)).toHaveLength(1);
  });

  it('UNMATCHED de 25 h : PSP_MISMATCH une seule fois ; de 23 h : encore en attente (A2)', async () => {
    const young = await insertEvent({
      configId: w.p.configs.WAVE,
      operatorId: w.p.op,
      notification: orphan(randomUUID(), `pay-young-${randomUUID()}`),
      status: 'UNMATCHED',
      ageHours: 23,
    });
    const old = await insertEvent({
      configId: w.p.configs.WAVE,
      operatorId: w.p.op,
      notification: orphan(randomUUID(), `pay-old-${randomUUID()}`),
      status: 'UNMATCHED',
      ageHours: 25,
    });
    const before = await mismatches();
    expect(await proc.retry.runOnce()).toBe(1);
    expect(await event(old)).toMatchObject({ status: 'PROCESSED', outcome: 'MISMATCH' });
    expect(await event(young)).toMatchObject({ status: 'UNMATCHED' });
    expect(await mismatches()).toBe(before + 1);
    expect(await proc.retry.runOnce()).toBe(0);
    expect(await mismatches()).toBe(before + 1);
    expect(proc.workers.alarm()).toBe(0);
  });

  it('erreur injectée : RETRY (essai 1) puis succès à la reprise, un seul TOPUP', async () => {
    const t = await w.p.topup();
    jest.spyOn(w.p.processor, 'process').mockRejectedValueOnce(new Error('panne'));
    const res = await w.post(w.event(t.row, { id: `evt-retry-${randomUUID()}` }));
    expect(res.status).toBe(200);
    const [stored] = (await w.events(t.row.configurationId)).slice(-1);
    expect(stored).toMatchObject({ status: 'RETRY', attempts: 1 });
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
    expect(await proc.retry.runOnce()).toBe(1);
    expect(await event(stored!.psp_event_id)).toMatchObject({
      status: 'PROCESSED',
      outcome: 'CREDITED',
    });
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
  });

  it('6e échec : plus repris automatiquement, code d’alerte 3 ; sous la borne : repris sans alarme', async () => {
    const t = await w.p.topup();
    const notification = w.p.notification(t.row);
    const id = await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification,
      status: 'RETRY',
      attempts: 5,
    });
    const process = jest
      .spyOn(proc.app.get(PspPaymentProcessor, { strict: false }), 'process')
      .mockRejectedValue(new Error('panne'));
    expect(await proc.retry.runOnce()).toBe(0);
    expect(await event(id)).toMatchObject({ status: 'RETRY', attempts: 6 });
    expect(proc.retry.alarm()).toBe(0);
    process.mockClear();
    // 6 essais : au-delà de 5, l'événement n'est plus repris et l'exploitation est alertée.
    expect(await proc.retry.runOnce()).toBe(0);
    expect(process).not.toHaveBeenCalled();
    expect(await event(id)).toMatchObject({ status: 'RETRY', attempts: 6 });
    expect(proc.retry.alarm()).toBe(ALARM_EVENT_RETRY_EXHAUSTED);
    expect(proc.workers.alarm()).toBe(3);
    // Il reste lisible par `--list`, marqué abandonné, sans donnée sensible.
    const lines = (await proc.retry.describe()).filter((line) => line.includes(id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('abandonné');
    // Clos à la main : il ne doit pas fausser les passages suivants.
    await ownerRows(
      `UPDATE psp_event SET status = 'PROCESSED', outcome = 'NO_EFFECT', processed_at = now()
        WHERE psp_event_id = $1`,
      [id],
    );
  });

  it('une contestation sans gestionnaire reste conservée, n’est pas un essai et n’alerte pas', async () => {
    const t = await w.p.topup({ method: 'CARD' });
    const notification = {
      ...w.p.notification(t.row, { kind: 'DISPUTE' }),
      dispute: { providerDisputeId: `dp-${randomUUID()}`, amount: 1000n },
    };
    const id = await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification,
      status: 'RECEIVED',
      ageHours: 1,
    });
    const fresh = await startPoller(w);
    try {
      expect(await fresh.retry.runOnce()).toBe(0);
      expect(await fresh.retry.runOnce()).toBe(0);
      expect(await event(id)).toMatchObject({ status: 'RECEIVED', outcome: null, attempts: 0 });
      expect(fresh.workers.alarm()).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  it('couture des contestations : un gestionnaire branché reçoit (client, événement, notification)', async () => {
    const t = await w.p.topup({ method: 'CARD' });
    const notification = {
      ...w.p.notification(t.row, { kind: 'DISPUTE' }),
      dispute: { providerDisputeId: `dp-${randomUUID()}`, amount: 1000n },
    };
    const id = await insertEvent({
      configId: t.row.configurationId,
      operatorId: w.p.op,
      notification,
      status: 'RECEIVED',
      ageHours: 1,
    });
    const handler: DisputeHandler = {
      handle: jest.fn().mockResolvedValue({
        disposition: 'PROCESSED',
        outcome: 'CHARGEBACK',
        topupId: t.row.topupId,
        payment: null,
      }),
    };
    const app = w.p.sw.api.app;
    const dispatcher = new EventDispatcher(
      app.get(TenantTx, { strict: false }),
      w.p.processor,
      app.get(AuditService, { strict: false }),
      handler,
    );
    const result = await dispatcher.apply(
      {
        pspEventId: id,
        operatorId: w.p.op,
        configurationId: t.row.configurationId,
        receivedAt: new Date(),
      },
      notification,
    );
    expect(result).toBe('PROCESSED');
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(await event(id)).toMatchObject({ status: 'PROCESSED', outcome: 'CHARGEBACK' });
  });

  it('deux travailleurs en même temps sur le même événement : un seul crédit', async () => {
    const topupId = randomUUID();
    const id = await insertEvent({
      configId: w.p.configs.WAVE,
      operatorId: w.p.op,
      notification: orphan(topupId, `pay-${topupId.slice(0, 8)}`),
      status: 'UNMATCHED',
      ageHours: 1,
    });
    await topupWithId(w, topupId);
    const second = await startPoller(w);
    try {
      const results = await Promise.all([proc.retry.runOnce(), second.retry.runOnce()]);
      expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    } finally {
      await second.close();
    }
    expect(await event(id)).toMatchObject({ status: 'PROCESSED', outcome: 'CREDITED' });
    expect(await w.p.transactions(topupId)).toHaveLength(1);
  });

  it('A33 : caution non prise après le premier crédit, reprise au rejeu d’une autre notification', async () => {
    const batchId = await withOwner((db) =>
      createBatch(db, {
        operatorId: w.p.op,
        organizerId: w.p.w.ids.organizerA,
        eventId: w.p.ev.eventId,
        status: 'ACTIVE',
        depositAmount: 2000,
        depositMode: 'FROM_BALANCE',
      }),
    );
    const wallet = await w.p.wallet();
    const media = await withOwner(async (db) => {
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.p.op,
        batchId,
        kmsKeyRef: w.p.w.keyRef.a,
        count: 1,
      });
      await activateMedia(db, {
        operatorId: w.p.op,
        eventId: w.p.ev.eventId,
        walletId: wallet.walletId,
        mediaIds: [m!.id],
      });
      await db.query('SELECT take_deposit($1, NULL)', [m!.id]);
      return m!;
    });
    const state = () =>
      ownerRows<{ deposit_status: string }>('SELECT deposit_status FROM media WHERE id = $1', [
        media.id,
      ]).then((rows) => rows[0]!.deposit_status);
    expect(await state()).toBe('DUE');

    const deposits = w.p.sw.api.app.get(DepositService, { strict: false });
    const spy = jest
      .spyOn(deposits, 'takeDueDepositForWallet')
      .mockRejectedValueOnce(new Error('panne après le COMMIT'));
    const t = await w.p.topup({ wallet });
    const first = await w.post(w.event(t.row, { id: `evt-a33-1-${randomUUID()}` }));
    expect(first.status).toBe(200);
    expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await state()).toBe('DUE');
    // Le PSP rejoue le paiement sous un autre identifiant de notification : doublon de paiement, caution reprise.
    spy.mockRestore();
    const replay = await w.post(w.event(t.row, { id: `evt-a33-2-${randomUUID()}` }));
    expect(replay.status).toBe(200);
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    expect(await state()).toBe('HELD');
  });
});
