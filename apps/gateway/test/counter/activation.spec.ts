// WP22 / T100 : activation de bracelet au guichet. Anonyme, `wallet_id` généré neuf (A24), caution
// en espèces (deux numéros consécutifs, même transaction), frais ou caution sur solde refusés sans
// numéro consommé.
import { randomUUID } from 'node:crypto';
import type { DepositTerms } from '../../src/operations/counter/deposit-terms';
import {
  counterRequest,
  opCount,
  readyBench,
  seedMedia,
  seedSession,
  tapOf,
  type Bench,
  type SeedMedia,
  type TestDevice,
} from './_support/bench';
import type { Loose } from '../support/loose';

let bench: Bench;
let device: TestDevice;
let seq = 0;
const terms = (o: Partial<DepositTerms> = {}) => ({
  lookup: async () => ({
    depositAmount: 0n,
    depositStatus: 'NONE' as const,
    activationFeeFromBalance: 0n,
    ...o,
  }),
});

beforeAll(async () => {
  ({ bench, device } = await readyBench());
}, 120_000);
afterAll(async () => bench.close());

async function activate(media: SeedMedia, o: Record<string, unknown> = {}, who = device) {
  seq += 1;
  return counterRequest(bench, who, {
    path: '/v1/media/activations',
    key: `${who.serial}:${seq}`,
    body: {
      channel: 'DESK',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
      ...o,
    },
  });
}
const ops = () =>
  bench.q<{ edge_seq: string; type: string; origin_key: string; operation: Loose }>(
    'SELECT edge_seq, type, origin_key, operation FROM edge_op ORDER BY edge_seq',
  );

describe('activation anonyme sans caution', () => {
  it('génère un wallet_id neuf, lie le bracelet, écrit ACTIVATION', async () => {
    bench.terms.current = terms();
    const media = await seedMedia(bench, { wallet: false });
    const r = await activate(media);
    expect(r.status).toBe(201);
    const walletId = (r.json as Loose).wallet.wallet_id as string;
    expect(walletId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.json).toMatchObject({ media_id: media.mediaId, media_status: 'ACTIVE' });
    expect((r.json as Loose).deposit).toMatchObject({ status: 'NONE', amount: 0 });
    const m = await bench.q('SELECT wallet_id, status FROM edge_media WHERE media_id = $1', [
      media.mediaId,
    ]);
    expect(m[0]).toMatchObject({ wallet_id: walletId, status: 'ACTIVE' });
    const last = (await ops()).pop()!;
    expect(last.type).toBe('ACTIVATION');
    expect(last.operation.edge_guichet).toMatchObject({ wallet_id: walletId, channel: 'DESK' });
  });

  it('un wallet_id fourni déjà connu est refusé, rien d’écrit', async () => {
    const known = await seedMedia(bench);
    const media = await seedMedia(bench, { wallet: false });
    const before = await opCount(bench);
    const r = await activate(media, { wallet_id: known.walletId });
    expect(r.status).toBe(422);
    expect(await opCount(bench)).toBe(before);
  });

  it('un wallet_id neuf fourni est admis (nominatif rattaché au portefeuille donné)', async () => {
    const media = await seedMedia(bench, { wallet: false });
    const walletId = randomUUID();
    const r = await activate(media, { wallet_id: walletId });
    expect(r.status).toBe(201);
    expect((r.json as Loose).wallet.wallet_id).toBe(walletId);
  });

  it('activation nominative par customer_id : non servie, rien d’écrit', async () => {
    const media = await seedMedia(bench, { wallet: false });
    const before = await opCount(bench);
    const r = await activate(media, { customer_id: randomUUID() });
    expect(r.status).toBe(422);
    expect(await opCount(bench)).toBe(before);
  });

  it('canal non autorisé par event.activation_modes : 422 ACTIVATION_MODE_NOT_ALLOWED', async () => {
    const media = await seedMedia(bench, { wallet: false });
    await bench.q(`UPDATE edge_event_setting SET activation_modes = '{FIRST_TOPUP}'`);
    const before = await opCount(bench);
    const r = await activate(media);
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: 'ACTIVATION_MODE_NOT_ALLOWED' });
    expect(await opCount(bench)).toBe(before);
    await bench.q(`UPDATE edge_event_setting SET activation_modes = '{DESK}'`);
  });

  it('bracelet déjà actif, bloqué ou d’un lot inactif : codes du contrat, rien d’écrit', async () => {
    const before = await opCount(bench);
    const active = await seedMedia(bench);
    expect((await activate(active)).json).toMatchObject({ code: 'MEDIA_STATE_INVALID' });
    const blocked = await seedMedia(bench, { wallet: false, status: 'BLACKLISTED' });
    expect((await activate(blocked)).json).toMatchObject({ code: 'MEDIA_BLOCKED' });
    const batch = await seedMedia(bench, { wallet: false, batchStatus: 'REVOKED' });
    expect((await activate(batch)).json).toMatchObject({ code: 'MEDIA_BATCH_INACTIVE' });
    expect(await opCount(bench)).toBe(before);
  });

  it('100 rejeux de la même clé : un seul effet', async () => {
    const media = await seedMedia(bench, { wallet: false });
    const body = {
      channel: 'DESK',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
    };
    seq += 1;
    const key = `${device.serial}:${seq}`;
    const before = await opCount(bench);
    for (let i = 0; i < 100; i += 1) {
      const r = await counterRequest(bench, device, { path: '/v1/media/activations', key, body });
      expect(r.status).toBe(201);
    }
    expect(await opCount(bench)).toBe(before + 1);
  }, 180_000);
});

describe('caution en espèces à l’activation', () => {
  it('ACTIVATION puis DEPOSIT_CASH, deux numéros consécutifs, clé #deposit, même session', async () => {
    bench.terms.current = terms({ depositAmount: 2000n, depositStatus: 'DUE' });
    const media = await seedMedia(bench, { wallet: false });
    const r = await activate(media, { deposit_payment: { method: 'CASH', amount: 2000 } });
    expect(r.status).toBe(201);
    expect((r.json as Loose).deposit).toMatchObject({ status: 'HELD', amount: 2000 });
    const rows = (await ops()).slice(-2);
    expect(rows.map((o) => o.type)).toEqual(['ACTIVATION', 'DEPOSIT_CASH']);
    expect(Number(rows[1]!.edge_seq)).toBe(Number(rows[0]!.edge_seq) + 1);
    expect(rows[1]!.origin_key).toBe(`${rows[0]!.origin_key}#deposit`);
    const session = await bench.q<{ cash_account_id: string }>(
      'SELECT cash_account_id FROM edge_cash_session WHERE device_id = $1',
      [device.deviceId],
    );
    expect(rows[1]!.operation.edge_guichet).toMatchObject({
      deposit_amount: 2000,
      cash_desk_account_id: session[0]!.cash_account_id,
    });
  });

  it('sans session de caisse du terminal : 409 CONFLICT_STATE, rien d’écrit ni activé', async () => {
    // Session ouverte après la bascule : la tolérance et la caution ne la reconnaissent pas.
    const late = await bench.newDevice();
    await seedSession(bench, late, {
      openedAt: new Date(bench.clock.now().getTime() - 1000),
      usable: false,
    });
    const media = await seedMedia(bench, { wallet: false });
    const before = await opCount(bench);
    const r = await activate(media, { deposit_payment: { method: 'CASH' } }, late);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await opCount(bench)).toBe(before);
    const m = await bench.q('SELECT wallet_id FROM edge_media WHERE media_id = $1', [
      media.mediaId,
    ]);
    expect(m[0]!.wallet_id).toBeNull();
  });

  it('conditions de caution inconnues (non répliquées) : refus fermé, rien d’écrit', async () => {
    bench.terms.current = { lookup: async () => null };
    const media = await seedMedia(bench, { wallet: false });
    const before = await opCount(bench);
    const r = await activate(media);
    expect(r.status).toBe(409);
    expect(await opCount(bench)).toBe(before);
  });
});

describe('frais ou caution sur solde : refusés pendant EDGE, aucun numéro consommé', () => {
  async function refused(o: Record<string, unknown>, t: Partial<DepositTerms>) {
    bench.terms.current = terms(t);
    const media = await seedMedia(bench, { wallet: false });
    const before = await opCount(bench);
    const lastSeq = await bench.q('SELECT coalesce(max(edge_seq),0) AS n FROM edge_op');
    const r = await activate(media, o);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', retryable: false });
    expect((r.json as Loose).edge_base_url).toBeUndefined();
    expect(await opCount(bench)).toBe(before);
    expect(await bench.q('SELECT coalesce(max(edge_seq),0) AS n FROM edge_op')).toEqual(lastSeq);
  }
  it('frais d’activation sur solde', () => refused({}, { activationFeeFromBalance: 500n }));
  it('caution sans espèces (sur solde)', () =>
    refused({}, { depositAmount: 2000n, depositStatus: 'DUE' }));
  it('caution par un autre moyen que les espèces', () =>
    refused(
      { deposit_payment: { method: 'CARD' } },
      { depositAmount: 2000n, depositStatus: 'DUE' },
    ));
});
