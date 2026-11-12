// Aucune double écriture, aucune perte silencieuse (mission 8, lot WP14, T065 ; R-23). Monde complet après reprise forcée :
// un terminal envoie son journal en lots, un autre (révoqué) le fait importer par deux personnes. Pour CHAQUE numéro,
// exactement un état : écrit au grand livre, déjà rejoué (reconnu), ou anomalie ouverte portant le montant. Jamais zéro,
// jamais deux ; tout rejouer une seconde fois ne change ni le bilan ni les compteurs.
import 'reflect-metadata';
import { ownerRows } from '../../../support/media-fixtures';
import { JournalWorld } from '../../offline/journal-world';
import type { OfflineTerminal } from '../../offline/processing-fixtures';
import { dbNow, onlineRef, runImport, Takeover } from './journal-support';

jest.setTimeout(300_000);

type State = 'WRITTEN' | 'REPLAYED' | 'ANOMALY';

describe('bilan par opération après reprise forcée (WP14, T065)', () => {
  let jw: JournalWorld;
  let takeover: Takeover;
  beforeAll(async () => {
    jw = await JournalWorld.create();
    takeover = new Takeover(jw.pw);
  });
  afterAll(async () => {
    await jw?.close();
  });

  const topup = (amount: number) => ({
    type: 'TOPUP_CASH',
    occurred_at: new Date(dbNow() - 5000).toISOString(),
    amount,
    currency: 'XOF',
  });

  /** États de chaque numéro du terminal, lus en base (jamais déduits de la réponse). */
  async function ledgerOf(t: OfflineTerminal): Promise<Map<number, State[]>> {
    const id = t.t.deviceId;
    const regs = await ownerRows<{
      seq: string;
      outcome: string;
      transaction_id: string | null;
      known: boolean;
    }>(
      `SELECT r.seq::text, r.outcome, r.transaction_id,
              (EXISTS (SELECT 1 FROM edge_sync_registry e WHERE e.origin_key = $2::text || ':' || lpad(r.seq::text, 4, '0'))
               OR EXISTS (SELECT 1 FROM api_idempotency a WHERE a.scope = 'device:' || $3::text || ':'
                            AND a.idempotency_key = $2::text || ':' || lpad(r.seq::text, 4, '0'))) AS known
         FROM device_seq_registry r WHERE r.device_id = $1 ORDER BY r.seq`,
      [id, t.t.serial, id],
    );
    const anomalies = await ownerRows<{ seq: string; n: number; amount: string }>(
      `SELECT seq::text, count(*)::int AS n, max(amount)::text AS amount FROM anomaly
        WHERE device_id = $1 AND kind IN ('EDGE_REPLAY_FAILED', 'NON_COMPLIANT_OPERATION') GROUP BY seq`,
      [id],
    );
    const out = new Map<number, State[]>();
    for (const r of regs) {
      const states: State[] = [];
      if (r.outcome.startsWith('ACCEPTED') && r.transaction_id) states.push('WRITTEN');
      if (r.outcome === 'DUPLICATE' || (r.outcome === 'VOID' && r.known)) states.push('REPLAYED');
      const an = anomalies.find((a) => a.seq === r.seq);
      if (an) {
        expect(an.n).toBe(1);
        states.push('ANOMALY');
      }
      out.set(Number(r.seq), states);
    }
    return out;
  }
  const counters = (t: OfflineTerminal) =>
    ownerRows<{ tx: number; an: number; reg: number }>(
      `SELECT (SELECT count(*)::int FROM journal_transaction WHERE device_id = $1) AS tx,
              (SELECT count(*)::int FROM anomaly WHERE device_id = $1) AS an,
              (SELECT count(*)::int FROM device_seq_registry WHERE device_id = $1) AS reg`,
      [t.t.deviceId],
    ).then((r) => r[0]!);

  it('lots hors ligne et journal importé : un seul état par numéro, bilan et compteurs inchangés au second passage', async () => {
    await takeover.set({});

    // Terminal A, lots : deux ventes, trois références rejouées (journal, registre EDGE_SYNC, route en ligne),
    // activation et caution non rejouées, recharge en espèces.
    const a = await jw.seller(2);
    const fromA = a.t.t.nextBatchSeq;
    await takeover.replayed(a.t, fromA + 2, 'JOURNAL');
    await takeover.replayed(a.t, fromA + 3, 'EDGE_REGISTRY');
    await takeover.replayed(a.t, fromA + 4, 'ONLINE_IDEMPOTENCY');
    const opsA = [
      jw.sale(a.t, a.media[0]!, 1000, a.version, 1),
      jw.sale(a.t, a.media[1]!, 2000, a.version, 1),
      onlineRef('activateMedia', { amount: 1500 }),
      onlineRef('activateMedia', { amount: 1500 }),
      onlineRef('takeDeposit', { amount: 2500 }),
      onlineRef('activateMedia', { amount: 3500 }),
      onlineRef('takeDeposit', { amount: 4500 }),
      topup(20_000),
    ];
    const batchA = a.t.t.buildBatch(opsA, { ledgerId: jw.pw.ledgerId });
    const sendA = () =>
      a.t.t.submitBatch(jw.pw.pw.api.baseUrl, jw.pw.pw.api.tls.serverCaPem, batchA).then((r) => {
        jw.pw.results(r);
      });
    await sendA();

    // Terminal B, journal importé après révocation : une référence rejouée, une non rejouée, une recharge.
    const b = { t: await jw.pw.terminal() };
    const fromB = b.t.t.nextBatchSeq;
    await takeover.replayed(b.t, fromB, 'EDGE_REGISTRY');
    const batchesB = jw.exportBatches(b.t, [
      [
        onlineRef('activateMedia', { amount: 900 }),
        onlineRef('takeDeposit', { amount: 1800 }),
        topup(6000),
      ],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await jw.revoke(b.t);
    const bodiesB = batchesB.map((x) => x.body);
    expect((await runImport(jw, b.t, bodiesB)).status).toBe('APPLIED');

    const expectedA: State[][] = [
      ['WRITTEN'],
      ['WRITTEN'],
      ['REPLAYED'],
      ['REPLAYED'],
      ['REPLAYED'],
      ['ANOMALY'],
      ['ANOMALY'],
      ['ANOMALY'],
    ];
    const expectedB: State[][] = [['REPLAYED'], ['ANOMALY'], ['ANOMALY']];
    const bilan = async () => ({
      a: [...(await ledgerOf(a.t)).entries()].sort((x, y) => x[0] - y[0]).map(([, s]) => s),
      b: [...(await ledgerOf(b.t)).entries()].sort((x, y) => x[0] - y[0]).map(([, s]) => s),
    });
    const first = await bilan();
    expect(first.a).toEqual(expectedA);
    expect(first.b).toEqual(expectedB);
    const before = { a: await counters(a.t), b: await counters(b.t) };

    // Tout rejouer : le même lot (deux fois), le même export importé de nouveau.
    await sendA();
    await sendA();
    expect((await runImport(jw, b.t, bodiesB)).status).toBe('APPLIED');
    expect(await bilan()).toEqual(first);
    expect({ a: await counters(a.t), b: await counters(b.t) }).toEqual(before);

    // Les montants des anomalies sont ceux des opérations non rejouées.
    const amounts = await ownerRows<{ device_id: string; seq: string; amount: string }>(
      `SELECT device_id, seq::text, amount::text FROM anomaly
        WHERE device_id IN ($1, $2) AND kind IN ('EDGE_REPLAY_FAILED', 'NON_COMPLIANT_OPERATION')
        ORDER BY device_id, seq`,
      [a.t.t.deviceId, b.t.t.deviceId],
    );
    const byDevice = (id: string) => amounts.filter((x) => x.device_id === id).map((x) => x.amount);
    expect(byDevice(a.t.t.deviceId)).toEqual(['3500', '4500', '20000']);
    expect(byDevice(b.t.t.deviceId)).toEqual(['1800', '6000']);
  });
});
