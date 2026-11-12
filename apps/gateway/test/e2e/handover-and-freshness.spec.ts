// T114 / NFR-007 et NFR-008, deux processus.
//   NFR-007 : accusé de bascule (état ACTIVE au central et sur la passerelle) en moins de 30 s
// après
//   l'accord (réponse 202), lien sain ; puis avec la notification perdue (écoute du central
// coupée :
//   seul le repli de 2 s joue).
//   NFR-008 : 50 blocages de bracelets au central, chacun appliqué sur la passerelle en moins de
// 5 s
//   (p95). Sensibilité : relais coupé, le blocage n'est PAS appliqué en 5 s, puis l'est au retour.
import { performance } from 'node:perf_hooks';
import { HandoverListener } from '../../../api/src/edge/control/handover-listener';
import type { PayMedia } from '../../../api/test/integration/payments/payments-fixtures';
import { TwoProcessBench, until } from '../support/two-process-bench';
import { percentile, report, summarize } from '../support/load-support';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);

async function release(): Promise<void> {
  await bench.releaseToCentral();
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
    180_000,
    200,
  );
}

/** Millisecondes entre l'accord (réponse 202) et l'état ACTIVE au central ET sur la passerelle. */
async function ackDelay(): Promise<number> {
  await bench.switchToEdge();
  const agreed = performance.now();
  await until(
    'accusé',
    async () => {
      const local = await bench.localAuthority();
      const rows = await central<{ status: string }>(
        `SELECT status FROM debit_authority_handover
          WHERE ledger_id = $1 AND direction = 'TO_EDGE' ORDER BY requested_at DESC LIMIT 1`,
        [bench.ledgerId],
      );
      return local?.state === 'ACTIVE' && rows[0]?.status === 'ACTIVE';
    },
    60_000,
    50,
  );
  return performance.now() - agreed;
}

describe('NFR-007 : prise d’autorité', () => {
  it('accusé en moins de 30 s, lien sain (5 essais), puis notification perdue', async () => {
    bench = await TwoProcessBench.start();
    const healthy: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      healthy.push(await ackDelay());
      await release();
    }
    const s = summarize(healthy);
    report('NFR-007 lien sain', { ...s, cibleMs: 30_000 });
    expect(Math.max(...healthy)).toBeLessThan(30_000);

    // Notification perdue : l'écoute du processus central est coupée sans être rouverte.
    await bench.edge.app.get(HandoverListener, { strict: false }).halt();
    const lost = await ackDelay();
    report('NFR-007 notification perdue', { ms: Math.round(lost), cibleMs: 30_000 });
    expect(lost).toBeLessThan(30_000);
    await release();
  }, 900_000);
});

describe('NFR-008 : fraîcheur de la réplication', () => {
  let media: PayMedia[];
  const suspend = (mediaId: string) =>
    central("SELECT set_config('app.operator_id', $1, false), suspend_media($2, 'perdu', $3)", [
      bench.operatorId,
      mediaId,
      bench.world.w.cashierA.userId,
    ]);
  const localStatus = async (mediaId: string) =>
    (
      await bench.localQuery<{ status: string }>(
        'SELECT status FROM edge_media WHERE media_id = $1',
        [mediaId],
      )
    )[0]?.status;

  it('50 blocages appliqués sur la passerelle, p95 < 5 s', async () => {
    media = await bench.world.media(51, 1_000);
    await until(
      'bracelets répliqués',
      async () =>
        Number(
          (await bench.localQuery<{ n: string }>('SELECT count(*)::text AS n FROM edge_media'))[0]!
            .n,
        ) >= 51,
      120_000,
      200,
    );
    const times: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const id = media[i]!.media.id;
      const t0 = performance.now();
      await suspend(id);
      await until(`blocage ${i}`, async () => (await localStatus(id)) === 'SUSPENDED', 30_000, 20);
      times.push(performance.now() - t0);
    }
    const s = summarize(times);
    report('NFR-008 blocage', { ...s, cibleP95Ms: 5_000 });
    expect(times).toHaveLength(50);
    expect(percentile(times, 95)).toBeLessThan(5_000);
  }, 600_000);

  it('sensibilité : relais coupé, blocage au-delà de 5 s, appliqué au retour du lien', async () => {
    const id = media[50]!.media.id;
    bench.relay.pause();
    const t0 = performance.now();
    await suspend(id);
    await new Promise((r) => setTimeout(r, 5_500));
    expect(await localStatus(id)).not.toBe('SUSPENDED');
    expect(performance.now() - t0).toBeGreaterThan(5_000);
    bench.relay.resume();
    await until(
      'blocage au retour',
      async () => (await localStatus(id)) === 'SUSPENDED',
      120_000,
      200,
    );
  }, 300_000);
});
