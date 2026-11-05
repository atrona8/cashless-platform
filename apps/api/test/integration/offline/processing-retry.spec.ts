// `CL007` pendant l'écriture d'une vente hors ligne (mission 7, lot WP19 ; T081 ; research R-30.11, ADR-139) :
// SAVEPOINT autour du moteur, trois reprises, quatrième `CL007` = rejet réessayable avec trace RETRY, rien au registre,
// passage non consommé. Le `CL007` est injecté APRÈS l'écriture réelle du moteur : le retour au point de sauvegarde
// doit défaire la vente (pas de double écriture).
import 'reflect-metadata';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { ownerRows } from '../../support/media-fixtures';
import { ProcessingWorld } from './processing-fixtures';

jest.setTimeout(240_000);

describe('CL007 : reprises et trace RETRY (WP19)', () => {
  let world: ProcessingWorld;
  let engine: LedgerEngineService;
  let failures = 0;
  let calls = 0;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
    engine = world.pw.api.app.get(LedgerEngineService, { strict: false });
    const original = engine.execute.bind(engine);
    jest.spyOn(engine, 'execute').mockImplementation(async (client, command) => {
      const result = await original(client, command);
      if (command.type === 'PURCHASE') {
        calls += 1;
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('solde insuffisant (débit concurrent)'), { code: 'CL007' });
        }
      }
      return result;
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await world?.close();
  });
  beforeEach(() => {
    failures = 0;
    calls = 0;
  });

  const setup = async () => {
    const t = await world.terminal();
    const media = await world.pw.media(1, 20_000);
    return { t, m: media[0]!, version: await world.snapshot(t, media) };
  };

  it.each([1, 2, 3])('%i échec(s) de CL007 : la vente passe, une seule écriture', async (n) => {
    const { t, m, version } = await setup();
    failures = n;
    const res = await world.submit(t, [world.sale(t, m, 4000, version)]);
    const [r] = world.results(res);
    expect(r).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 4000, retryable: false });
    expect(calls).toBe(n + 1);
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    expect(await world.spendable(m.walletId)).toBe(16_000);
    const trace = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM offline_batch_retry WHERE device_id = $1',
      [t.t.deviceId],
    );
    expect(trace[0]!.n).toBe(0);
  });

  it('quatre CL007 : REJECTED INSUFFICIENT_FUNDS_RETRY retryable, trace RETRY, registre sans ligne, passage non consommé ; renvoi : la vente passe et la trace se clôt', async () => {
    const { t, m, version } = await setup();
    failures = 4;
    const op = world.sale(t, m, 4000, version);
    const res = await world.submit(t, [op]);
    const [r] = world.results(res);
    expect(r).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'INSUFFICIENT_FUNDS_RETRY',
      retryable: true,
      effect: 'NONE',
    });
    expect(calls).toBe(4);
    expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
    expect(await world.pw.registry(t.t.deviceId)).toHaveLength(0);
    expect(await world.spendable(m.walletId)).toBe(20_000);
    const trace = await ownerRows<{ seq: string; closed_at: Date | null }>(
      'SELECT seq::text, closed_at FROM offline_batch_retry WHERE device_id = $1',
      [t.t.deviceId],
    );
    expect(trace).toEqual([{ seq: '1', closed_at: null }]);
    const taps = await ownerRows<{ transaction_id: string | null }>(
      'SELECT transaction_id FROM media_tap WHERE device_id = $1',
      [t.t.deviceId],
    );
    expect(taps).toEqual([{ transaction_id: null }]);
    expect(res.body.contiguous_acked_seq).toBe(0);

    // Renvoi du même numéro (mêmes octets) dans un lot ultérieur : écrit, trace close.
    failures = 0;
    const again = await world.submit(t, [op], { fromSeq: 1 });
    expect(world.results(again)[0]).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 4000 });
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    const closed = await ownerRows<{ closed_at: Date | null }>(
      'SELECT closed_at FROM offline_batch_retry WHERE device_id = $1',
      [t.t.deviceId],
    );
    expect(closed[0]!.closed_at).not.toBeNull();
    expect(await world.spendable(m.walletId)).toBe(16_000);
  });
});
