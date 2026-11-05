// Débit d'un lot hors ligne (lot WP21, T089 ; NFR-003) : un lot de 500 opérations est traité en 60 s au plus pour 95 %
// des lots. Seuil de la spécification, confirmé le 29/10/2026, jamais desserré ici. Route réelle `POST /offline-batches`
// en HTTPS réel, VRAI processeur (conformité, écriture du grand livre, registre, anomalies), un lot à la fois et rien
// d'autre ne tourne (la suite est écartée de la passe parallèle et lancée seule, `--runInBand`).
// La durée est celle de la requête complète vue du client de test (donc au-dessus du temps du seul service) ; le p95
// porte sur `LOTS` lots d'une série (20 : le plus petit échantillon dont le p95 écarte un lot isolé). Une seule série, seuil tel quel.
import 'reflect-metadata';
import { cpus, platform, release, totalmem } from 'node:os';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { settleClock } from '../../support/offline-dataset';
import { ProcessingWorld } from '../offline/processing-fixtures';

const latency = process.env.SKIP_LATENCY ? it.skip : it;
const LOTS = 20;
const OPS = 500;
// Une seule série, en CI comme ailleurs : un lot dure près d'une minute, refaire la série ne ferait que masquer un seuil non tenu.
const MAX_SERIES = 1;
const LIMIT_MS = 60_000;

jest.setTimeout(3_600_000);

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * q) - 1]!);
}
const p95 = (s: number[]) => percentile(s, 0.95);

describe('NFR-003 : débit d’un lot de 500 opérations', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    if (process.env.SKIP_LATENCY) return;
    world = await ProcessingWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  latency(
    `${LOTS} lots de ${OPS} opérations, un à la fois : p95 ≤ 60 s, toutes les opérations écrites`,
    async () => {
      const t = await world.terminal({ max_snapshot_age_seconds: 80_000 });
      const media = await world.pw.media(10, 1_000_000);
      await settleClock();
      const version = await world.snapshot(t, media, { generatedAgo: 1 });
      let written = 0;
      /** Un lot de 500 ventes de 10 sur dix bracelets ; rend la durée (ms) de la requête complète. */
      const lot = async (): Promise<number> => {
        const ops = Array.from({ length: OPS }, (_, i) =>
          world.sale(t, media[i % media.length]!, 10, version),
        );
        await t.t.issueToken(world.pw.api.app.get(DeviceTokenService, { strict: false })); // jeton court
        const built = t.t.buildBatch(ops, { ledgerId: world.ledgerId });
        const start = process.hrtime.bigint();
        const res = await t.t.submitBatch(
          world.pw.api.baseUrl,
          world.pw.api.tls.serverCaPem,
          built,
        );
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        if (res.status !== 200)
          throw new Error(`lot refusé : ${res.status} ${res.text.slice(0, 200)}`);
        const results = res.body.results as Array<{ status: string }>;
        if (results.length !== OPS || results.some((r) => r.status !== 'ACCEPTED'))
          throw new Error('toutes les opérations devaient être acceptées');
        written += OPS;
        return elapsed;
      };
      await lot(); // mise en route (connexions, requêtes préparées), hors mesure
      const attempts: number[][] = [];
      do {
        const series: number[] = [];
        for (let n = 0; n < LOTS; n += 1) series.push(await lot());
        attempts.push(series);
      } while (attempts.length < MAX_SERIES && p95(attempts[attempts.length - 1]!) > LIMIT_MS);
      const best = attempts.find((a) => p95(a) <= LIMIT_MS) ?? attempts[attempts.length - 1]!;
      const sorted = [...best].sort((a, b) => a - b);
      process.stdout.write(
        `LATENCE-LOT ${JSON.stringify({
          lots: best.length,
          operations_par_lot: OPS,
          p95_ms: p95(best),
          p99_ms: percentile(best, 0.99),
          max_ms: Math.round(sorted[sorted.length - 1]!),
          min_ms: Math.round(sorted[0]!),
          seuil_p95_ms: LIMIT_MS,
          series_p95_ms: attempts.map(p95),
          machine: `${platform()} ${release()} ${cpus()[0]?.model} x${cpus().length}, ${Math.round(totalmem() / 2 ** 30)} Gio`,
          ci: Boolean(process.env.CI),
        })}\n`,
      );
      expect(best).toHaveLength(LOTS);
      expect(p95(best)).toBeLessThanOrEqual(LIMIT_MS);
      expect(await world.txRows(t.t.deviceId)).toHaveLength(written);
    },
  );
});
