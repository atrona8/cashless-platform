// Latence du paiement par bracelet (mission 5b, lot WP14, T069 ; NFR-001, SC-006). 200 paiements en un aller-retour,
// EN SÉRIE, HTTPS réel avec les trois preuves du terminal, vraie base. Temps mesuré côté serveur, autour du
// traitement du paiement (`PaymentsService.create` : verrous, grand livre, lignes, attribution, enregistrement de la
// réponse idempotente), jamais autour du client. Seuils : p95 ≤ 200 ms et p99 ≤ 500 ms. Mesure indicative en local,
// écartée de la passe parallèle (`SKIP_LATENCY=1`) et lancée SEULE ensuite par la CI (ledger-tests.yml) : aucune
// autre suite en parallèle. Les valeurs mesurées sont écrites sur la sortie.
//
// Écritures directes en base : amorçage seulement (jeu d'essai commun des paiements).
import 'reflect-metadata';
import { PaymentsService } from '../../../src/payments/payments.service';
import { PaymentWorld, type PayMedia } from '../payments/payments-fixtures';

jest.setTimeout(600_000);

const PAYMENTS = 200;
const P95_MS = 200;
const P99_MS = 500;
/** `SKIP_LATENCY=1` (passe parallèle) : mesures écartées, lancées seules ensuite. */
const latency = process.env.SKIP_LATENCY ? it.skip : it;

/** Rang le plus proche (méthode du rang supérieur) : le plus petit x dont au moins q des valeurs sont ≤ x. */
const percentile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!;
const ms = (started: bigint) => Number(process.hrtime.bigint() - started) / 1e6;

describe('NFR-001, SC-006 : latence du paiement par bracelet (indicatif, local)', () => {
  let pw: PaymentWorld;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
  });
  afterAll(async () => {
    await pw?.close();
  });

  latency(
    `${PAYMENTS} paiements en série : p95 ≤ ${P95_MS} ms, p99 ≤ ${P99_MS} ms (serveur seul)`,
    async () => {
      const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
      // 40 bracelets de 50 000 : cinq ventes de 1 000 chacun (aucune limite de solde ou de plafond atteinte).
      const media: PayMedia[] = await pw.media(PAYMENTS / 5, 50_000);
      const service = pw.api.app.get(PaymentsService, { strict: false });
      const original = service.create.bind(service);
      const durations: number[] = [];
      service.create = (async (...args: Parameters<PaymentsService['create']>) => {
        const started = process.hrtime.bigint();
        try {
          return await original(...args);
        } finally {
          durations.push(ms(started));
        }
      }) as PaymentsService['create'];
      try {
        // Échauffement hors mesure : connexions, caches de plans, premier hachage.
        const [warm] = (await pw.media(1)) as [PayMedia];
        expect((await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(warm) }, 1000))).status).toBe(
          201,
        );
        durations.length = 0;
        const statuses: number[] = [];
        for (let i = 0; i < PAYMENTS; i += 1) {
          const m = media[i % media.length]!;
          statuses.push((await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000))).status);
        }
        expect(statuses.filter((s) => s !== 201)).toEqual([]);
      } finally {
        service.create = original;
      }
      expect(durations).toHaveLength(PAYMENTS);
      const p95 = percentile(durations, 0.95);
      const p99 = percentile(durations, 0.99);
      process.stdout.write(
        `NFR-001 : paiement par bracelet, ${PAYMENTS} appels en série : p50 ` +
          `${percentile(durations, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, p99 ` +
          `${p99.toFixed(1)} ms, max ${Math.max(...durations).toFixed(1)} ms\n`,
      );
      expect(p95).toBeLessThanOrEqual(P95_MS);
      expect(p99).toBeLessThanOrEqual(P99_MS);
      expect(await pw.salesOf(term.t.deviceId)).toBe(PAYMENTS + 1);
    },
  );
});
