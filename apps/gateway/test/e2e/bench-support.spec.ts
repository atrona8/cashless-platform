// Preuves du banc lui-même (T112) : jeton de terminal par la passerelle, paiement réel à deux
// processus,
// sonde de NFR-001 (avec contrôle de sensibilité), générateur de file, canari (contrôle positif).
import {
  assertNoLeak,
  assertSearchersDetectLeak,
  makeCanary,
  pgDump,
  searchPgDump,
  searchText,
} from '../support/canary';
import { generateQueue } from '../support/queue-generator';
import {
  chainsEqual,
  edgeSeqContinuity,
  exclusionViolations,
  maxPostingId,
} from '../support/sql-probes';
import { TwoProcessBench, until } from '../support/two-process-bench';

describe('canari', () => {
  const canary = makeCanary();
  it('contrôle positif : chaque représentation plantée est trouvée, pas de faux positif', () => {
    assertSearchersDetectLeak(canary);
    expect(canary.representations.length).toBeGreaterThanOrEqual(14);
  });
  it('les échappements JSON et SQL diffèrent du texte (ils ne sont pas triviaux)', () => {
    const names = Object.fromEntries(
      canary.representations.map((r) => [r.name, r.needle.toString()]),
    );
    expect(names['json-escaped']).not.toBe(canary.text);
    expect(names['sql-escaped']).not.toBe(canary.text);
  });
  it("searchText trouve une fuite base64 au milieu d'un flux, pas un texte propre", () => {
    const aligned = Buffer.concat([Buffer.from('xy'), canary.bytes, Buffer.from('z')]).toString(
      'base64',
    );
    expect(searchText(canary, 'flux', `{"a":"${aligned}"}`)).toHaveLength(1);
    assertNoLeak(searchText(canary, 'flux', '{"a":"rien"}'));
  });
});

describe('banc à deux processus', () => {
  let bench: TwoProcessBench;
  afterAll(async () => bench?.close());

  it('jeton, paiement, sonde, générateur de file, canari en base', async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    const term = await w.terminal();
    const prior = await w.terminal();
    const media = await w.media(3, 100_000);
    // Contrôle de sensibilité de la sonde : un débit ONLINE au central (avant la bascule) est vu
    // avec W = 0.
    expect(
      (await w.pay(prior, w.catalogBody(prior, { tap: w.tap(media[2]!) }, [[1, 1]]))).status,
    ).toBe(201);
    expect(
      await exclusionViolations(bench.centralQuery.bind(bench), bench.ledgerId, 0n),
    ).toHaveLength(1);
    const W = await maxPostingId(bench.centralQuery.bind(bench));
    expect(
      await exclusionViolations(bench.centralQuery.bind(bench), bench.ledgerId, W),
    ).toHaveLength(0);

    await bench.switchToEdge();
    await bench.waitLocalState('ACTIVE', 30_000);
    await until(
      'portefeuilles répliqués',
      async () => (await bench.localQuery('SELECT 1 FROM edge_wallet')).length >= 3,
    );
    const sale = await bench.gwPay(term, w.catalogBody(term, { tap: w.tap(media[0]!) }, [[1, 1]]));
    expect(sale.status).toBe(201);
    // Le central refuse le débit pendant que la passerelle a l'autorité.
    const central = await w.pay(prior, w.catalogBody(prior, { tap: w.tap(media[1]!) }, [[1, 1]]), {
      epoch: String(bench.epoch),
    });
    expect(central.status).toBe(409);
    expect(central.body.code ?? central.body.type).toMatch(/DEBIT_AUTHORITY_EDGE/);

    // Générateur de file : 25 opérations par EdgeQueue.append, vidées au rendu.
    const queued = await generateQueue(bench, { count: 25, terminal: term, media, firstSeq: 2 });
    expect(queued.lastEdgeSeq - queued.firstEdgeSeq).toBe(24);
    await bench.releaseToCentral();
    await until(
      'vidage',
      async () => {
        const c = await edgeSeqContinuity(bench.centralQuery.bind(bench), bench.gatewayId);
        return c.max === queued.lastEdgeSeq ? c : null;
      },
      60_000,
    );
    const cont = await edgeSeqContinuity(bench.centralQuery.bind(bench), bench.gatewayId);
    expect(cont.gaps).toEqual([]);
    expect(cont.duplicates).toBe(0);
    expect(
      (
        await chainsEqual(
          bench.centralQuery.bind(bench),
          bench.localQuery.bind(bench),
          bench.gatewayId,
        )
      ).equal,
    ).toBe(true);
    expect(
      await exclusionViolations(bench.centralQuery.bind(bench), bench.ledgerId, W),
    ).toHaveLength(0);

    // pg_dump : un secret planté dans la base locale est retrouvé, un autre non planté ne l'est
    // pas.
    const planted = makeCanary('PLANTE');
    const absent = makeCanary('ABSENT');
    await bench.localQuery('CREATE TABLE IF NOT EXISTS canary_control (v text)');
    await bench.localQuery('INSERT INTO canary_control VALUES ($1)', [planted.text]);
    expect(searchPgDump(planted, bench.edgeDb.name)).toHaveLength(1);
    assertNoLeak(searchPgDump(absent, bench.edgeDb.name));
    expect(pgDump(bench.edgeDb.name).length).toBeGreaterThan(1000);
  }, 300_000);
});
