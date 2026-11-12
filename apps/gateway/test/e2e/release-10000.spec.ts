// T114 / NFR-002, SC-003, NFR-006 : file de 10 000 opérations valides, rendu au central, `kill
// -9` de
// la passerelle au milieu du vidage puis redémarrage. Preuves : aucun débit de la passerelle après
// `RELEASING` (la vente tentée pendant le rendu est refusée, aucune ligne locale postérieure),
// `edge_seq` 1..N continus au registre du central, chaîne égale, aucune opération perdue ni écrite
// deux fois, durée du vidage (kill et redémarrage compris) inférieure à 10 minutes (NFR-006, mesure
// à refaire en recette sur le matériel : R-28). Mode long (`M8_E2E_LONG=1`) : N = 10 000 ; sinon
// 2 000 (même suite, volumes réduits, dits dans la mesure).
import { performance } from 'node:perf_hooks';
import { generateQueue } from '../support/queue-generator';
import { chainsEqual, edgeSeqContinuity } from '../support/sql-probes';
import { TwoProcessBench, until } from '../support/two-process-bench';
import { activateEdge, LONG, report } from '../support/load-support';

const N = LONG ? 10_000 : 2_000;
const LIMIT_MS = 10 * 60_000;

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

describe('NFR-002 et NFR-006 : rendu d’une grosse file avec arrêt brutal', () => {
  it(`${N} opérations, kill au milieu du vidage, rendu complet`, async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    const central = bench.centralQuery.bind(bench);
    const local = bench.localQuery.bind(bench);
    const till = await w.terminal();
    const media = await w.media(10, 100 * (N / 10) * 2);
    await activateEdge(
      bench,
      media.map((m) => m.walletId),
    );

    const g0 = performance.now();
    const queued = await generateQueue(bench, { count: N, terminal: till, media, firstSeq: 1 });
    const generateMs = performance.now() - g0;
    expect(queued.lastEdgeSeq - queued.firstEdgeSeq + 1).toBe(N);

    const t0 = performance.now();
    await bench.releaseToCentral();
    await bench.waitLocalState('RELEASING', 120_000);
    // Aucun débit de la passerelle une fois RELEASING : la vente tentée est refusée (409).
    const during = await bench.gwPay(
      till,
      w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]),
    );
    expect(during.status).toBe(409);

    // Arrêt brutal au tiers du vidage.
    const done = () =>
      central<{ n: string }>(
        `SELECT count(*)::text AS n FROM edge_sync_batch_result x
           JOIN edge_sync_batch b ON b.batch_id = x.batch_id WHERE b.gateway_id = $1`,
        [bench.gatewayId],
      ).then((r) => Number(r[0]!.n));
    await until('un tiers vidé', async () => ((await done()) >= N / 3 ? true : null), 600_000, 25);
    const atKill = await done();
    await bench.gateway!.kill('SIGKILL');
    expect(await done()).toBeLessThan(N); // le vidage n'était pas fini
    await bench.startGateway();

    await until(
      'rendu terminé',
      async () =>
        (
          await central<{ status: string }>(
            `SELECT status FROM debit_authority_handover
              WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
            [bench.ledgerId],
          )
        )[0]?.status === 'COMPLETED',
      LIMIT_MS,
      500,
    );
    const drainMs = performance.now() - t0;

    const cont = await edgeSeqContinuity(central, bench.gatewayId);
    expect(cont).toMatchObject({ gaps: [], duplicates: 0, count: N, min: 1, max: N });
    expect((await chainsEqual(central, local, bench.gatewayId)).equal).toBe(true);
    const written = await central<{ n: string; d: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT idempotency_key)::text AS d
         FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [bench.ledgerId],
    );
    expect(Number(written[0]!.n)).toBe(N);
    expect(written[0]!.d).toBe(written[0]!.n);
    // Horodatage du journal local contre la date de RELEASING : rien après (même horloge, base).
    const late = await central<{ n: string }>(
      `SELECT count(*)::text AS n FROM debit_authority_handover r WHERE r.id = (
         SELECT id FROM debit_authority_handover WHERE ledger_id = $1 AND direction = 'TO_CENTRAL'
          ORDER BY requested_at DESC LIMIT 1) AND r.begun_releasing_at IS NOT NULL`,
      [bench.ledgerId],
    );
    expect(late[0]!.n).toBe('1');
    const releasingAt = (
      await central<{ t: Date }>(
        `SELECT begun_releasing_at AS t FROM debit_authority_handover
          WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
        [bench.ledgerId],
      )
    )[0]!.t;
    const after = await local<{ n: string }>(
      'SELECT count(*)::text AS n FROM edge_op WHERE recorded_at > $1',
      [releasingAt],
    );
    expect(after[0]!.n).toBe('0');
    report('NFR-002/NFR-006 rendu', {
      operations: N,
      generationMs: Math.round(generateMs),
      videesAvantKill: atKill,
      dureeVidageMs: Math.round(drainMs),
      limiteMs: LIMIT_MS,
    });
    expect(drainMs).toBeLessThan(LIMIT_MS);
  }, 3_600_000);
});
