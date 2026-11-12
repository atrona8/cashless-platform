// WP22, cycle 2 : conditions de guichet lues dans `edge_terms` répliqué (décisions 21 et 36).
// Sans `edge_terms`, ou au moindre doute : refus (`DEPOSIT_TERMS_UNKNOWN`), échec fermé.
import { randomUUID } from 'node:crypto';
import { termsFromEdgeTerms } from '../../src/operations/counter/deposit-terms';
import { replicatedDepositTerms } from '../../src/operations/counter/deposit-terms';
import {
  counterRequest,
  opCount,
  readyBench,
  seedMedia,
  tapOf,
  type Bench,
} from './_support/bench';
import { makeRep, q, type Rep } from '../replication/_support/harness';

const B1 = randomUUID();
const B2 = randomUUID();
const batch = (id: string, amount: number, mode: string | null = 'SEPARATE') => ({
  batch_id: id,
  deposit_amount: amount,
  deposit_mode: mode,
});
const idle = { batchId: null, mediaStatus: 'ISSUED' };

describe('termsFromEdgeTerms', () => {
  it('absent, partiel ou sans lot : inconnu', () => {
    expect(termsFromEdgeTerms(null, idle)).toBeNull();
    expect(termsFromEdgeTerms({ activation_fee: 0 }, idle)).toBeNull();
    expect(termsFromEdgeTerms({ deposit_batches: [batch(B1, 0, null)] }, idle)).toBeNull();
    expect(termsFromEdgeTerms({ activation_fee: 0, deposit_batches: [] }, idle)).toBeNull();
  });

  it('lien bracelet -> lot inconnu : servi seulement si tous les lots ont les mêmes conditions', () => {
    const same = { activation_fee: 0, deposit_batches: [batch(B1, 1000), batch(B2, 1000)] };
    expect(termsFromEdgeTerms(same, idle)).toEqual({
      depositAmount: 1000n,
      depositStatus: 'DUE',
      activationFeeFromBalance: 0n,
    });
    const differ = { activation_fee: 0, deposit_batches: [batch(B1, 1000), batch(B2, 500)] };
    expect(termsFromEdgeTerms(differ, idle)).toBeNull();
    expect(termsFromEdgeTerms(differ, { batchId: B2, mediaStatus: 'ISSUED' })?.depositAmount).toBe(
      500n,
    );
    expect(termsFromEdgeTerms(differ, { batchId: randomUUID(), mediaStatus: 'ISSUED' })).toBeNull();
  });

  it('sans caution : NONE ; caution sur solde ou bracelet déjà actif : inconnu', () => {
    const free = { activation_fee: 0, deposit_batches: [batch(B1, 0, null)] };
    expect(termsFromEdgeTerms(free, idle)).toMatchObject({
      depositAmount: 0n,
      depositStatus: 'NONE',
    });
    const balance = { activation_fee: 0, deposit_batches: [batch(B1, 1000, 'FROM_BALANCE')] };
    expect(termsFromEdgeTerms(balance, idle)).toBeNull();
    expect(termsFromEdgeTerms(free, { batchId: null, mediaStatus: 'ACTIVE' })).toBeNull();
  });

  it('frais d’activation > 0 : rendus comme frais, que la route refuse', () => {
    const fee = { activation_fee: 200, deposit_batches: [batch(B1, 0, null)] };
    expect(termsFromEdgeTerms(fee, idle)?.activationFeeFromBalance).toBe(200n);
  });
});

describe('activation avec les conditions répliquées', () => {
  let bench: Bench;
  let seq = 0;
  beforeAll(async () => {
    ({ bench } = await readyBench({ terms: replicatedDepositTerms }));
  }, 120_000);
  afterAll(async () => bench.close());

  const activate = async (batchId: string) => {
    const media = await seedMedia(bench, { wallet: false });
    await bench.q('UPDATE edge_media SET batch_id = $1 WHERE media_id = $2', [
      batchId,
      media.mediaId,
    ]);
    const device = await bench.newDevice();
    seq += 1;
    return counterRequest(bench, device, {
      path: '/v1/media/activations',
      key: `${device.serial}:${seq}`,
      body: {
        channel: 'DESK',
        occurred_at: bench.clock.now().toISOString(),
        tap: tapOf(media, bench),
      },
    });
  };

  it('sans edge_terms : 409 DEPOSIT_TERMS_UNKNOWN, rien d’écrit', async () => {
    await bench.q('UPDATE edge_event_setting SET edge_terms = NULL');
    const before = await opCount(bench);
    const r = await activate(B1);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE', detail: 'DEPOSIT_TERMS_UNKNOWN' });
    expect(await opCount(bench)).toBe(before);
  });
});

describe('réplication de edge_terms (dernière page seulement)', () => {
  let r: Rep;
  beforeEach(async () => {
    r = await makeRep();
    await q(
      r,
      `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone, activation_modes)
       VALUES (true, 'LIVE', 'XOF', 0, 'UTC', '{DESK}')`,
    );
  });
  afterEach(async () => r.close());
  const stored = async () =>
    (await q<{ edge_terms: unknown }>(r, 'SELECT edge_terms FROM edge_event_setting'))[0]!
      .edge_terms;

  it('stockée sur la dernière page, remise à inconnu si la dernière page ne la porte pas', async () => {
    const terms = {
      max_cash_topup: 2000,
      activation_fee: 0,
      deposit_batches: [batch(B1, 1000)],
    };
    r.feed.queue.push(r.page({ edge_terms: terms }));
    await r.svc.pullOnce();
    expect(await stored()).toEqual(terms);
    r.feed.queue.push(r.page({ has_more: true, to_posting_id: 1 }));
    await r.svc.pullOnce();
    expect(await stored()).toEqual(terms); // page intermédiaire : inchangé
    r.feed.queue.push(r.page({ to_posting_id: 1 }));
    await r.svc.pullOnce();
    expect(await stored()).toBeNull(); // dernière page sans le champ : inconnu
  });

  it('spend_order (décision 45) : stocké tel quel ; valeur inconnue : page refusée en entier', async () => {
    for (const order of ['PAID_FIRST', 'PROMO_FIRST']) {
      r.feed.queue.push(r.page({ edge_terms: { spend_order: order } }));
      await r.svc.pullOnce();
      expect(await stored()).toEqual({ spend_order: order });
    }
    r.feed.queue.push(r.page({ edge_terms: { spend_order: 'ALEATOIRE' } }));
    await expect(r.svc.pullOnce()).rejects.toThrow(/page refusée/);
    expect(await stored()).toEqual({ spend_order: 'PROMO_FIRST' });
  });

  it('edge_terms mal formé : page refusée en entier', async () => {
    r.feed.queue.push(r.page({ edge_terms: { max_cash_topup: 0 } }));
    await expect(r.svc.pullOnce()).rejects.toThrow(/page refusée/);
    r.feed.queue.push(r.page({ edge_terms: { deposit_batches: [{ batch_id: 'x' }] } }));
    await expect(r.svc.pullOnce()).rejects.toThrow(/page refusée/);
  });
});
