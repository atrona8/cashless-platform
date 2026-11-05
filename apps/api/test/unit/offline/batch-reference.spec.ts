// Mémoire de référence d'un lot (NFR-003, WP21 part J) : une lecture n'est faite qu'une fois par lot, deux lots ne
// partagent rien, un échec n'est pas gardé ; et le résolveur de configuration n'y range que des objets immuables.
import { SqlConfigResolver } from '../../../src/configuration/sql-config-resolver';
import { ReferenceMemo } from '../../../src/ledger/ports/reference-memo';

describe('ReferenceMemo', () => {
  it('ne charge une clé qu’une fois, même demandée en même temps', async () => {
    const memo = new ReferenceMemo();
    const load = jest.fn(async () => 42);
    const [a, b] = await Promise.all([memo.remember('k', load), memo.remember('k', load)]);
    expect([a, b, await memo.remember('k', load)]).toEqual([42, 42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(memo.loadCount).toBe(1);
  });

  it('deux lots (deux mémoires) ne partagent rien', async () => {
    const first = new ReferenceMemo();
    const second = new ReferenceMemo();
    const load = jest.fn(async () => 'v');
    await first.remember('k', load);
    await second.remember('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ne garde pas un échec : la lecture suivante est refaite', async () => {
    const memo = new ReferenceMemo();
    const load = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('absent'))
      .mockResolvedValueOnce('ok');
    await expect(memo.remember('k', load)).rejects.toThrow('absent');
    await expect(memo.remember('k', load)).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('SqlConfigResolver avec mémoire de lot', () => {
  const EVENT = {
    id: 'e1',
    operator_id: 'op',
    organizer_id: 'org',
    contract_id: 'c1',
    jurisdiction_id: 'j1',
  };
  /** Client factice : compte les requêtes par table lue. */
  function fakeClient() {
    const counts: Record<string, number> = {};
    const hit = (name: string) => (counts[name] = (counts[name] ?? 0) + 1);
    return {
      counts,
      query: async (text: string) => {
        if (text.includes('FROM ledger l JOIN event e')) return hit('event'), { rows: [EVENT] };
        if (text.includes("purpose = 'PLT_REDEV'"))
          return hit('platform'), { rows: [{ owner_party_id: 'plt' }] };
        if (text.includes('FROM contract WHERE id'))
          return (
            hit('contract'),
            {
              rows: [
                {
                  breakage_organizer_bps: 0,
                  chargeback_bearer: 'ORGANIZER',
                  cash_diff_bearer: 'ORGANIZER',
                  offline_loss_bearer: 'ORGANIZER',
                },
              ],
            }
          );
        if (text.includes('FROM jurisdiction_profile'))
          return hit('jurisdiction'), { rows: [{ breakage_destination: 'NONE', taxes: {} }] };
        if (text.includes('FROM fee_rule')) return hit('rules'), { rows: [] };
        if (text.includes('FROM merchant_participation')) return hit('pitch'), { rows: [] };
        if (text.includes('FROM config_version')) return hit('version'), { rows: [] };
        throw new Error(`requête inattendue : ${text}`);
      },
    };
  }
  const cascade = {
    resolveForEvent: jest.fn(async () => ({
      psp_fee_bearer: { value: 'ORGANIZER' },
      spend_order: { value: 'PROMO_FIRST' },
    })),
  };
  const resolver = new SqlConfigResolver(cascade as never);
  const query = (client: ReturnType<typeof fakeClient>, extra: object = {}) => ({
    ledgerId: 'l1',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    client: client as never,
    ...extra,
  });

  it('avec mémoire : contrat, juridiction et partie plateforme lus une fois ; événement, règles et version relus', async () => {
    const client = fakeClient();
    const memo = new ReferenceMemo();
    await resolver.resolve(query(client, { memo, skipPitchFees: true }));
    await resolver.resolve(query(client, { memo, skipPitchFees: true }));
    expect(client.counts).toEqual({
      event: 2,
      platform: 1,
      contract: 1,
      jurisdiction: 1,
      rules: 2,
      version: 2,
    });
  });

  it('sans mémoire (chemin en ligne) : tout est relu, droits de place compris', async () => {
    const client = fakeClient();
    await resolver.resolve(query(client));
    await resolver.resolve(query(client));
    expect(client.counts).toEqual({
      event: 2,
      platform: 2,
      contract: 2,
      jurisdiction: 2,
      rules: 2,
      pitch: 2,
      version: 2,
    });
  });

  it('droits de place non lus : la lecture de config.pitchFees lève', async () => {
    const config = await resolver.resolve(query(fakeClient(), { skipPitchFees: true }));
    expect(() => config.pitchFees).toThrow(/droits de place non lus/);
  });

  it('deux lots ne partagent aucune lecture', async () => {
    const client = fakeClient();
    await resolver.resolve(query(client, { memo: new ReferenceMemo(), skipPitchFees: true }));
    await resolver.resolve(query(client, { memo: new ReferenceMemo(), skipPitchFees: true }));
    expect(client.counts.contract).toBe(2);
  });
});
