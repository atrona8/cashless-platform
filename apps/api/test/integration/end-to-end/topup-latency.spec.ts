// Latence des recharges (mission 6, lot WP14, T072 ; NFR-006, NFR-009). EN SÉRIE, HTTPS réel, vraie base.
//   (a) NFR-006 : 200 notifications authentifiées, temps mesuré côté serveur autour de `WebhookIntake.receive` (de la
//       vérification de la signature au `200`, les deux transactions comprises) : p95 <= 500 ms ;
//   (b) NFR-009 : 200 recharges espèces, mesurées autour de `CashTopupService.create` : p95 <= 200 ms.
// Seuils exacts, jamais relâchés pour passer. p50, p99 et maximum écrits sur la sortie. Écartée de la passe parallèle
// (`SKIP_LATENCY=1`) et lancée SEULE ensuite par la CI (ledger-tests.yml) : aucune autre suite en parallèle.
// Écritures directes en base : amorçage seulement (bracelets, portefeuilles, recharges PENDING d'avant la mesure).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CashTopupService } from '../../../src/topups/cash/cash-topup.service';
import { WebhookIntake } from '../../../src/webhooks/webhook-intake.service';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  createBatch,
  seedPersonalizedMedia,
  tapBody,
  type SeededMedia,
} from '../../support/media-fixtures';
import { WebhookWorld } from '../webhooks/webhook-fixtures';

jest.setTimeout(900_000);

const CALLS = 200;
const NOTIFICATION_P95_MS = 500;
const CASH_P95_MS = 200;
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const percentile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!;
const ms = (started: bigint) => Number(process.hrtime.bigint() - started) / 1e6;

describe('NFR-006, NFR-009 : latence des recharges (indicatif, local)', () => {
  let w: WebhookWorld;
  beforeAll(async () => {
    w = await WebhookWorld.create();
  }, 300_000);
  afterAll(async () => {
    await w?.close();
  });

  /** Remplace `method` de `target` par une version chronométrée ; rend la restauration. */
  function timed<T extends object, K extends keyof T>(
    target: T,
    method: K,
    into: number[],
  ): () => void {
    const original = target[method] as unknown as (...args: unknown[]) => Promise<unknown>;
    (target as Record<K, unknown>)[method] = async (...args: unknown[]) => {
      const started = process.hrtime.bigint();
      try {
        return await original.apply(target, args);
      } finally {
        into.push(ms(started));
      }
    };
    return () => {
      (target as Record<K, unknown>)[method] = original;
    };
  }
  const report = (label: string, durations: number[]) =>
    process.stdout.write(
      `${label}, ${durations.length} appels en série : p50 ${percentile(durations, 0.5).toFixed(1)} ms, ` +
        `p95 ${percentile(durations, 0.95).toFixed(1)} ms, p99 ${percentile(durations, 0.99).toFixed(1)} ms, ` +
        `max ${Math.max(...durations).toFixed(1)} ms\n`,
    );

  latency(
    `NFR-006 : ${CALLS} notifications en série : p95 <= ${NOTIFICATION_P95_MS} ms (serveur seul)`,
    async () => {
      const intake = w.p.sw.api.app.get(WebhookIntake, { strict: false });
      // Recharges PENDING d'avant la mesure (un portefeuille chacune), échauffement hors mesure.
      const topups = [];
      for (let i = 0; i < CALLS + 1; i += 1) topups.push((await w.p.topup({ amount: 1000 })).row);
      const warm = await w.post(w.event(topups[0]!));
      expect(warm.status).toBe(200);
      const durations: number[] = [];
      const restore = timed(intake, 'receive', durations);
      try {
        const statuses: number[] = [];
        for (const row of topups.slice(1))
          statuses.push((await w.post(w.event(row, { id: `evt-${randomUUID()}` }))).status);
        expect(statuses.filter((s) => s !== 200)).toEqual([]);
      } finally {
        restore();
      }
      expect(durations).toHaveLength(CALLS);
      report('NFR-006 : notification PSP authentifiée', durations);
      expect(percentile(durations, 0.95)).toBeLessThanOrEqual(NOTIFICATION_P95_MS);
    },
  );

  latency(
    `NFR-009 : ${CALLS} recharges espèces en série : p95 <= ${CASH_P95_MS} ms (serveur seul)`,
    async () => {
      const cw = w.p.sw;
      const service = cw.api.app.get(CashTopupService, { strict: false });
      const t = await cw.terminal();
      await cw.open(t, cw.w.cashierA);
      const batchId = await withOwner((db) =>
        createBatch(db, {
          operatorId: w.p.op,
          organizerId: cw.w.ids.organizerA,
          eventId: w.p.ev.eventId,
          status: 'ACTIVE',
        }),
      );
      // 40 bracelets, cinq recharges de 1 000 chacun (aucun plafond atteint).
      const medias: SeededMedia[] = [];
      for (let i = 0; i < CALLS / 5 + 1; i += 1) {
        const wallet = await w.p.wallet();
        medias.push(
          await withOwner(async (db) => {
            const [m] = await seedPersonalizedMedia(db, {
              operatorId: w.p.op,
              batchId,
              kmsKeyRef: cw.w.keyRef.a,
              count: 1,
            });
            await activateMedia(db, {
              operatorId: w.p.op,
              eventId: w.p.ev.eventId,
              walletId: wallet.walletId,
              mediaIds: [m!.id],
            });
            return m!;
          }),
        );
      }
      let counter = 10_000;
      const topup = (m: SeededMedia) =>
        cw.term(t, 'POST', '/topups/cash', cw.w.cashierA, {
          amount: 1000,
          currency: 'XOF',
          occurred_at: new Date().toISOString(),
          tap: tapBody(m, (counter += 1)),
        });
      expect((await topup(medias[CALLS / 5]!)).status).toBe(201); // échauffement hors mesure
      const durations: number[] = [];
      const restore = timed(service, 'create', durations);
      try {
        const statuses: number[] = [];
        for (let i = 0; i < CALLS; i += 1)
          statuses.push((await topup(medias[i % (CALLS / 5)]!)).status);
        expect(statuses.filter((s) => s !== 201)).toEqual([]);
      } finally {
        restore();
      }
      expect(durations).toHaveLength(CALLS);
      report('NFR-009 : recharge espèces', durations);
      expect(percentile(durations, 0.95)).toBeLessThanOrEqual(CASH_P95_MS);
    },
  );
});
