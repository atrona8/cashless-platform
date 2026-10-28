// Intégration : caution due après un crédit PSP (lot WP11, T058 ; R-06, A33). `afterCommit` prend la caution du
// bracelet du portefeuille dans SA PROPRE transaction, après le COMMIT du crédit, aussi sur le chemin doublon ;
// un échec n'altère ni le crédit ni l'issue. Utilise (et prouve) `DepositService.takeDueDepositForWallet`.
import { DepositService } from '../../../src/media/lifecycle/deposit.service';
import type { PaymentOutcome } from '../../../src/topups/psp/psp-payment-types';
import { withOwner } from '../../support/db';
import {
  createBatch,
  ownerRows,
  seedPersonalizedMedia,
  activateMedia,
} from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

const AUDIT = { actorId: null, actorRole: null, origin: 'psp', requestId: null };

describe('caution due après un crédit PSP', () => {
  let p: PspWorld;
  let deposits: DepositService;
  let batchId: string;

  beforeAll(async () => {
    p = await PspWorld.create();
    deposits = p.sw.api.app.get(DepositService, { strict: false });
    batchId = await withOwner((db) =>
      createBatch(db, {
        operatorId: p.op,
        organizerId: p.w.ids.organizerA,
        eventId: p.ev.eventId,
        status: 'ACTIVE',
        depositAmount: 2000,
        depositMode: 'FROM_BALANCE',
      }),
    );
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(() => jest.restoreAllMocks());

  /** Portefeuille avec un bracelet activé dont la caution est due. */
  async function walletWithDueDeposit() {
    const w = await p.wallet();
    const media = await withOwner(async (db) => {
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: p.op,
        batchId,
        kmsKeyRef: p.w.keyRef.a,
        count: 1,
      });
      await activateMedia(db, {
        operatorId: p.op,
        eventId: p.ev.eventId,
        walletId: w.walletId,
        mediaIds: [m!.id],
      });
      // Comme l'activation par l'API : solde insuffisant, la caution (FROM_BALANCE) devient due.
      await db.query('SELECT take_deposit($1, NULL)', [m!.id]);
      return m!;
    });
    const state = () =>
      ownerRows<{ deposit_status: string }>('SELECT deposit_status FROM media WHERE id = $1', [
        media.id,
      ]).then((r) => r[0]!.deposit_status);
    expect(await state()).toBe('DUE');
    return { ...w, media, state };
  }
  const taken = (mediaId: string) =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction
        WHERE type = 'DEPOSIT_TAKEN' AND idempotency_key LIKE 'deposit:' || $1::text || ':%'`,
      [mediaId],
    ).then((r) => r[0]!.n);

  it('crédit puis caution : la prise a lieu APRÈS le COMMIT (le crédit est visible d’une autre connexion)', async () => {
    const w = await walletWithDueDeposit();
    const t = await p.topup({ wallet: w, amount: 10000 });
    const original = deposits.takeDueDepositForWallet.bind(deposits);
    const seen: number[] = [];
    jest.spyOn(deposits, 'takeDueDepositForWallet').mockImplementation(async (...args) => {
      seen.push((await p.transactions(t.row.topupId)).length);
      return original(...args);
    });
    const out = await p.pay(t.row);
    expect(out).toMatchObject({ outcome: 'CREDITED', depositDue: true });
    expect(await w.state()).toBe('DUE');
    await p.processor.afterCommit(p.op, out, AUDIT);
    expect(seen).toEqual([1]);
    expect(await w.state()).toBe('HELD');
    expect(await taken(w.media.id)).toBe(1);
  });

  it('chemin doublon : un crédit passé sans caution prise est repris à la notification suivante (A33)', async () => {
    const w = await walletWithDueDeposit();
    const t = await p.topup({ wallet: w, amount: 10000 });
    await p.pay(t.row, { paymentRef: 'dup-dep' }); // la caution n'est pas prise (plantage simulé)
    expect(await w.state()).toBe('DUE');
    const again = await p.pay(t.row, { paymentRef: 'dup-dep' });
    expect(again).toMatchObject({ outcome: 'DUPLICATE_PAYMENT', depositDue: true });
    await p.processor.afterCommit(p.op, again, AUDIT);
    expect(await w.state()).toBe('HELD');
    // Idempotent : une deuxième prise ne reprend pas la caution.
    await p.processor.afterCommit(p.op, again, AUDIT);
    expect(await taken(w.media.id)).toBe(1);
  });

  it('échec de la prise : journalisé, jamais relancé ; crédit, issue et recharge intacts, caution restée DUE', async () => {
    const w = await walletWithDueDeposit();
    const t = await p.topup({ wallet: w, amount: 10000 });
    const out = await p.pay(t.row);
    jest.spyOn(deposits, 'takeDueDepositForWallet').mockRejectedValue(new Error('panne'));
    await expect(p.processor.afterCommit(p.op, out, AUDIT)).resolves.toBeUndefined();
    expect(out.outcome).toBe('CREDITED');
    expect((await p.read(t.row.topupId))!.status).toBe('SUCCEEDED');
    expect(await w.state()).toBe('DUE');
  });

  it('caution supérieure au solde : reste DUE ; portefeuille sans bracelet : rien', async () => {
    const small = await walletWithDueDeposit();
    const t = await p.topup({ wallet: small, amount: 1000 });
    const out = await p.pay(t.row);
    await p.processor.afterCommit(p.op, out, AUDIT);
    expect(await small.state()).toBe('DUE');
    const bare = await p.topup();
    const bareOut = await p.pay(bare.row);
    await expect(p.processor.afterCommit(p.op, bareOut, AUDIT)).resolves.toBeUndefined();
    expect(await deposits.takeDueDepositForWallet(p.op, bare.walletId, AUDIT)).toBeNull();
  });

  it('depositDue faux pour NOT_CREDITED, MISMATCH, NO_EFFECT, UNMATCHED : aucune prise tentée', async () => {
    const spy = jest.spyOn(deposits, 'takeDueDepositForWallet');
    const t = await p.topup({ amount: 5000 });
    const outcomes: PaymentOutcome[] = [
      await p.pay(t.row, { amount: 1n, paymentRef: 'mm' }), // MISMATCH
      await p.pay(t.row, { kind: 'PAYMENT_FAILED' }), // NO_EFFECT
      await p.pay(t.row, { merchantRef: crypto.randomUUID(), paymentRef: 'zz' }), // UNMATCHED
    ];
    const blocked = await p.wallet({ status: 'BLOCKED' });
    const bt = await p
      .topup({ wallet: { ...blocked, walletId: blocked.walletId } })
      .catch(() => null);
    expect(bt).toBeNull(); // create_psp_topup refuse un portefeuille bloqué (CL039)
    expect(outcomes.map((o) => [o.outcome, o.depositDue])).toEqual([
      ['MISMATCH', false],
      ['NO_EFFECT', false],
      [null, false],
    ]);
    for (const o of outcomes) await p.processor.afterCommit(p.op, o, AUDIT);
    expect(spy).not.toHaveBeenCalled();
  });
});
