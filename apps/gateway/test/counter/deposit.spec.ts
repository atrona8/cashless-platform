// WP22 / T101 : caution en espèces seule (`takeDeposit`). Session du terminal exigée, caution
// idempotente, `FROM_BALANCE` et autres moyens refusés sans numéro consommé.
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
let accountId: string;
let seq = 0;
const terms = (o: Partial<DepositTerms> = {}) => ({
  lookup: async () => ({
    depositAmount: 2000n,
    depositStatus: 'DUE' as const,
    activationFeeFromBalance: 0n,
    ...o,
  }),
});

beforeAll(async () => {
  let session;
  ({ bench, device, session } = await readyBench({ terms: terms() }));
  accountId = session.accountId;
}, 120_000);
afterAll(async () => bench.close());

async function deposit(
  media: SeedMedia,
  body: Record<string, unknown> = {},
  who = device,
  key?: string,
) {
  seq += 1;
  return counterRequest(bench, who, {
    path: `/v1/media/${media.mediaId}/deposit`,
    key: key ?? `${who.serial}:${seq}`,
    body: { payment: { method: 'CASH' }, tap: tapOf(media, bench), ...body },
  });
}
const lastSeq = async () =>
  Number(
    (await bench.q<{ n: string }>('SELECT coalesce(max(edge_seq),0) AS n FROM edge_op'))[0]!.n,
  );

describe('caution en espèces', () => {
  it('écrit DEPOSIT_CASH avec le compte de caisse de la session du terminal', async () => {
    bench.terms.current = terms();
    const media = await seedMedia(bench);
    const r = await deposit(media);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'HELD', amount: 2000, mode: 'SEPARATE' });
    const row = (
      await bench.q<{ type: string; operation: Loose }>(
        'SELECT type, operation FROM edge_op ORDER BY edge_seq DESC LIMIT 1',
      )
    )[0]!;
    expect(row.type).toBe('DEPOSIT_CASH');
    expect(row.operation.edge_guichet).toMatchObject({
      media_id: media.mediaId,
      deposit_amount: 2000,
      cash_desk_account_id: accountId,
    });
  });

  it('idempotente : caution déjà HELD, aucune nouvelle entrée de file', async () => {
    bench.terms.current = terms({ depositStatus: 'HELD' });
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await deposit(media);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'HELD' });
    expect(await opCount(bench)).toBe(before);
  });

  it('idempotente : une seconde clé après un premier encaissement ne double pas', async () => {
    bench.terms.current = terms();
    const media = await seedMedia(bench);
    expect((await deposit(media)).status).toBe(200);
    const before = await opCount(bench);
    const again = await deposit(media);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: 'HELD' });
    expect(await opCount(bench)).toBe(before);
  });

  it('rejeu de la même clé : un seul effet', async () => {
    const media = await seedMedia(bench);
    const body = { payment: { method: 'CASH' }, tap: tapOf(media, bench) };
    const key = `${device.serial}:9000`;
    const before = await opCount(bench);
    for (let i = 0; i < 20; i += 1) {
      const r = await counterRequest(bench, device, {
        path: `/v1/media/${media.mediaId}/deposit`,
        key,
        body,
      });
      expect(r.status).toBe(200);
    }
    expect(await opCount(bench)).toBe(before + 1);
  }, 120_000);
});

describe('session de caisse du terminal exigée', () => {
  it('terminal sans session utilisable : 409 CONFLICT_STATE, rien d’écrit', async () => {
    const late = await bench.newDevice();
    await seedSession(bench, late, {
      openedAt: new Date(bench.clock.now().getTime() - 1000),
      usable: false,
    });
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await deposit(media, {}, late);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await opCount(bench)).toBe(before);
  });

  it('cash_session_id qui ne concorde pas : 409, rien d’écrit', async () => {
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await deposit(media, { cash_session_id: randomUUID() });
    expect(r.status).toBe(409);
    expect(await opCount(bench)).toBe(before);
  });

  it('la session d’un autre terminal ne sert pas', async () => {
    const other = await bench.newDevice();
    const theirs = await seedSession(bench, other, {
      openedAt: new Date(bench.clock.now().getTime() - 7200_000),
    });
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const r = await deposit(media, { cash_session_id: theirs.id });
    expect(r.status).toBe(409);
    expect(await opCount(bench)).toBe(before);
  });
});

describe('FROM_BALANCE et autres moyens : DEBIT_AUTHORITY_EDGE, aucun numéro consommé', () => {
  it.each([
    ['sans paiement (FROM_BALANCE)', { payment: undefined }],
    ['carte', { payment: { method: 'CARD' } }],
    ['mobile money', { payment: { method: 'MOBILE_MONEY' } }],
  ])('%s', async (_name, body) => {
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    const seqBefore = await lastSeq();
    const r = await deposit(media, body as Record<string, unknown>);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', retryable: false });
    expect((r.json as Loose).edge_base_url).toBeUndefined();
    expect(await opCount(bench)).toBe(before);
    expect(await lastSeq()).toBe(seqBefore);
  });

  it('aucune caution due : 409 CONFLICT_STATE', async () => {
    bench.terms.current = terms({ depositAmount: 0n, depositStatus: 'NONE' });
    const media = await seedMedia(bench);
    const r = await deposit(media);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONFLICT_STATE' });
    bench.terms.current = terms();
  });

  it('conditions inconnues (non répliquées) : refus fermé', async () => {
    bench.terms.current = { lookup: async () => null };
    const media = await seedMedia(bench);
    const before = await opCount(bench);
    expect((await deposit(media)).status).toBe(409);
    expect(await opCount(bench)).toBe(before);
    bench.terms.current = terms();
  });
});
