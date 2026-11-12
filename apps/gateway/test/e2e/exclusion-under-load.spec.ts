// T114 / NFR-001, SC-002 : bascule puis rendu enchaînés sous 100 débits par seconde vers le central
// (charge offerte de 110 débits/s : 24 terminaux, un débit toutes les ~218 ms chacun). Après chaque bascule : aucun débit de
// portefeuille d'une source autre que `EDGE_SYNC` entre `W` (watermark de la bascule) et la fin du
// rendu, aucune opération perdue, chaque requête rend 2xx, 4xx ou 409. Mode long
// (`M8_E2E_LONG=1`) :
// 20 cycles ; sinon 3. Contrôle de sensibilité : un débit du central après le rendu, hors borne,
// est
// vu par la même requête sans sa borne haute.
import { performance } from 'node:perf_hooks';
import type {
  PayMedia,
  PayTerminal,
} from '../../../api/test/integration/payments/payments-fixtures';
import {
  exclusionViolations,
  exclusionViolationsDuring,
  maxPostingId,
} from '../support/sql-probes';
import { TwoProcessBench, until } from '../support/two-process-bench';
import {
  activateEdge,
  KeepAliveClient,
  LONG,
  paced,
  report,
  round,
  summarize,
} from '../support/load-support';

const CYCLES = LONG ? 20 : 3;
// Charge OFFERTE : 110 débits par seconde (10 % au-dessus du plancher exigé de 100, NFR-001), soit
// WORKERS terminaux, un débit toutes les WORKERS x 1000 / 110 ms chacun. Une charge offerte égale au
// plancher ne peut que le manquer (boucle fermée : tout retard d'une réponse est perdu, CI du 12/11 :
// 99/s offerts 100). Le plancher, lui, ne change pas (`M8_MIN_DEBIT_RATE`).
const OFFERED_RATE = Number(process.env.M8_OFFERED_RATE ?? 110);
const WORKERS = Number(process.env.M8_LOAD_WORKERS ?? 24);
const PERIOD_MS = Math.round((WORKERS * 1000) / OFFERED_RATE);

let bench: TwoProcessBench;
let workers: Array<ReturnType<typeof paced>> = [];
let clients: KeepAliveClient[] = [];
// Les générateurs de charge sont arrêtés AVANT la fermeture du banc (donc de la suppression des
// bases), même si l'essai échoue : sinon ils frappent un central qui disparaît et `afterAll`
// reste bloqué.
afterAll(async () => {
  await Promise.allSettled(workers.map((x) => x.stop()));
  clients.forEach((c) => c.close());
  await bench?.close();
});

interface Seen {
  status: number;
  key: string;
}

describe('NFR-001 : exclusion sous charge', () => {
  it(`${CYCLES} bascules et rendus sous 100 débits/s`, async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    const central = bench.centralQuery.bind(bench);
    const tills: PayTerminal[] = [];
    for (let i = 0; i < WORKERS; i += 1) tills.push(await w.terminal());
    const media: PayMedia[] = await w.media(WORKERS + 1, 20_000_000);
    const gwTill = await w.terminal();
    const gwMedia = media[WORKERS]!;

    const seen: Seen[] = [];
    const latencies: number[] = [];
    const statuses = new Map<number, number>();
    // Connexions persistantes (comme les tablettes) : le générateur ne mange pas le processeur du
    // banc en poignées de main.
    clients = tills.map((till) => new KeepAliveClient(bench, till));
    workers = tills.map((till, i) =>
      paced(PERIOD_MS, async () => {
        const key = till.t.seqKey();
        const res = await clients[i]!.payCentral(
          w.catalogBody(till, { tap: w.tap(media[i]!) }, [[0, 1]]),
          key,
          bench.epoch,
        );
        latencies.push(res.ms);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        seen.push({ status: res.status, key });
      }),
    );
    const t0 = Date.now();
    const elu0 = performance.eventLoopUtilization();
    const cpu0 = process.cpuUsage();
    const gwSales: string[] = [];
    let lastEdge = '';
    let lastCentral = '';
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await new Promise((r) => setTimeout(r, 500));
      await activateEdge(bench, [gwMedia.walletId]);
      for (let k = 0; k < 3; k += 1) {
        const key = gwTill.t.seqKey();
        const res = await bench.gwPay(
          gwTill,
          w.catalogBody(gwTill, { tap: w.tap(gwMedia) }, [[0, 1]]),
          { key },
        );
        expect(res.status).toBe(201);
        gwSales.push(key);
      }
      await new Promise((r) => setTimeout(r, 500));
      await bench.releaseToCentral();
      const done = await until(
        `rendu ${cycle}`,
        async () =>
          (
            await central<{ id: string; status: string }>(
              `SELECT id, status FROM debit_authority_handover
                WHERE ledger_id = $1 AND direction = 'TO_CENTRAL'
                ORDER BY requested_at DESC LIMIT 1`,
              [bench.ledgerId],
            )
          ).find((r) => r.status === 'COMPLETED') ?? null,
        180_000,
        200,
      );
      lastCentral = done.id;
      lastEdge = (
        await central<{ id: string }>(
          `SELECT id FROM debit_authority_handover
            WHERE ledger_id = $1 AND direction = 'TO_EDGE' ORDER BY requested_at DESC LIMIT 1`,
          [bench.ledgerId],
        )
      )[0]!.id;
      const bad = await exclusionViolationsDuring(central, bench.ledgerId, lastEdge, lastCentral);
      expect([cycle, bad]).toEqual([cycle, []]);
      // Époque centrale pour les débits suivants : celle de l'autorité (bascule + rendu).
      bench.epoch = Number(
        (
          await central<{ e: string }>('SELECT max(epoch)::text AS e FROM debit_authority_handover')
        )[0]!.e,
      );
    }
    const elapsedS = (Date.now() - t0) / 1000;
    // Réponses reçues PENDANT la fenêtre mesurée : celles qui arrivent pendant l'arrêt des
    // générateurs ne comptent pas dans la cadence (sinon le débit serait surévalué).
    const inWindow = seen.length;
    const elu = performance.eventLoopUtilization(elu0).utilization;
    const cpu = process.cpuUsage(cpu0);
    const nodeCpu = round((cpu.user + cpu.system) / 1e6 / elapsedS, 2);
    await Promise.all(workers.map((x) => x.stop()));
    clients.forEach((c) => c.close());
    expect(workers.flatMap((x) => x.failures())).toEqual([]);

    // Aucune réponse hors 2xx, 4xx : un 5xx est un échec.
    const codes = [...statuses.keys()];
    expect(codes.filter((c) => c >= 500 || c < 200 || (c >= 300 && c < 400))).toEqual([]);
    // Aucune opération perdue : chaque 201 est au registre du central, y compris les ventes de la
    // passerelle (versées au rendu).
    const accepted = seen.filter((s) => s.status === 201).map((s) => s.key);
    const found = await central<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_transaction
        WHERE ledger_id = $1 AND idempotency_key = ANY($2::text[])`,
      [bench.ledgerId, [...accepted, ...gwSales]],
    );
    expect(Number(found[0]!.n)).toBe(accepted.length + gwSales.length);
    const attempts = seen.length;
    report('NFR-001 exclusion', {
      cycles: CYCLES,
      requetes: attempts,
      debitParSeconde: Math.round(inWindow / elapsedS),
      statuts: Object.fromEntries(statuses),
      latenceCentralMs: summarize(latencies),
      violations: 0,
      ventesPasserelle: gwSales.length,
      eluNode: round(elu, 2),
      coeursNode: nodeCpu,
    });
    expect(statuses.get(409) ?? 0).toBeGreaterThan(0);
    // Sensibilité : un débit du central, légitime après le rendu, est vu sans la borne haute.
    const W = await maxPostingId(central);
    const last = await central<{ w: string }>(
      `SELECT watermark_posting_id::text AS w FROM debit_authority_handover WHERE id = $1`,
      [lastEdge],
    );
    const sale = await w.pay(
      tills[0]!,
      w.catalogBody(tills[0]!, { tap: w.tap(media[0]!) }, [[0, 1]]),
      {
        key: tills[0]!.t.seqKey(),
        epoch: String(bench.epoch),
      },
    );
    expect([sale.status, sale.body.type]).toEqual([201, 'PURCHASE']);
    const unbounded = await exclusionViolations(central, bench.ledgerId, BigInt(last[0]!.w));
    expect(unbounded.length).toBeGreaterThan(0);
    expect(
      await exclusionViolationsDuring(central, bench.ledgerId, lastEdge, lastCentral),
    ).toHaveLength(0);
    expect(W).toBeGreaterThan(0n);
    // Cadence (NFR-001, décision 53) : 100 débits par seconde, plancher réglable seulement pour
    // une mesure de diagnostic (`M8_MIN_DEBIT_RATE`). Vérifiée en dernier : la sensibilité et les
    // violations sont jugées même si la cadence n'est pas atteinte. Le chiffre est dans la sortie.
    const floor = Number(process.env.M8_MIN_DEBIT_RATE ?? 100);
    expect(inWindow / elapsedS).toBeGreaterThanOrEqual(floor);
  }, 3_600_000);
});
