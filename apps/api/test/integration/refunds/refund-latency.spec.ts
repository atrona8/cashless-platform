// Mesures de la mission 9a (WP07 ; NFR-004, NFR-005). NFR-004 (latence) est ISOLÉE : ignorée sous `SKIP_LATENCY`,
// à lancer seule (la VM Docker ralentit). NFR-005 (promotion des demandes échues) ne dépend d'aucune mesure de Node :
// l'écart est calculé par la base, jamais par l'horloge de Node (décalage de Docker).
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  REFUND_PROMOTION_INTERVAL_MS,
  RefundPromotionWorker,
} from '../../../src/processes/maintenance-refund-promotion';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { MAINT_URL, withOwner } from '../../support/db';
import { freshPhone } from '../../support/customer-auth';
import { ownerRows as rows } from '../../support/media-fixtures';
import { backdateHold } from './holder-fixtures';
import { holderLinkFor } from './refund-invariants';
import { codeFor, fundedCustomer, postRefund, type FundedCustomer } from './create-fixtures';
import {
  createRefundWorld,
  createStaff,
  proposeApproval,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';

jest.setTimeout(300_000);
const latency = process.env.SKIP_LATENCY ? it.skip : it;

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
/** Chronomètre `n` requêtes simultanées ; rend les durées (ms) et les statuts. */
async function timed(n: number, make: (i: number) => PromiseLike<{ status: number }>) {
  const durations: number[] = [];
  const statuses = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const t0 = process.hrtime.bigint();
      const res = await make(i);
      durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
      return res.status;
    }),
  );
  return { durations, statuses };
}
const report = (label: string, d: number[]) => {
  const stats = {
    min: Math.round(Math.min(...d)),
    median: Math.round(percentile(d, 50)),
    p95: Math.round(percentile(d, 95)),
    max: Math.round(Math.max(...d)),
  };
  console.log(`NFR-004 ${label} (ms) : ${JSON.stringify(stats)}`);
  return stats;
};

describe('NFR-004 : latence des routes de remboursement (20 requêtes simultanées)', () => {
  let r: RefundWorld;
  let s: Staff;
  let customers: FundedCustomer[];

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
    // Portefeuilles DISTINCTS : sinon on mesurerait des 409.
    customers = [];
    for (let i = 0; i < 20; i += 1) customers.push(await fundedCustomer(r.w, 10_000));
  });
  afterAll(async () => {
    await r.app.close();
  });

  latency(
    'création, lecture du festivalier et liste du back-office : p95 sous 500 ms',
    async () => {
      const created = await timed(20, (i) =>
        postRefund(r.app, customers[i]!.customer, {
          wallet_id: customers[i]!.walletId,
          destination: { method: 'WAVE' },
        }),
      );
      expect(created.statuses.every((x) => x === 201)).toBe(true);
      const mine = await timed(20, (i) =>
        request(r.app.getHttpServer())
          .get('/v1/me/refund-requests')
          .set(customers[i]!.customer.headers),
      );
      expect(mine.statuses.every((x) => x === 200)).toBe(true);
      const staff = await timed(20, () =>
        request(r.app.getHttpServer())
          .get('/v1/refund-requests?status=REQUESTED')
          .set('Authorization', `Bearer ${s.adminA.token}`),
      );
      expect(staff.statuses.every((x) => x === 200)).toBe(true);
      for (const [label, run] of [
        ['création', created],
        ['GET /me/refund-requests', mine],
        ['GET /refund-requests', staff],
      ] as const)
        expect(report(label, run.durations).p95).toBeLessThan(500);
    },
  );
});

describe('NFR-005 : promotion des demandes échues', () => {
  const saved = process.env.DATABASE_URL_MAINT;
  let r: RefundWorld;
  let s: Staff;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let worker: RefundPromotionWorker;
  let clock = Date.now() + 10 * REFUND_PROMOTION_INTERVAL_MS;
  const tick = () => (clock += REFUND_PROMOTION_INTERVAL_MS + 1);

  beforeAll(async () => {
    process.env.DATABASE_URL_MAINT = MAINT_URL;
    r = await createRefundWorld();
    s = await createStaff(r.w);
    moduleRef = await Test.createTestingModule({ imports: [MaintenanceProcessModule] }).compile();
    await moduleRef.init();
    worker = moduleRef.get(RefundPromotionWorker, { strict: false });
  });
  afterAll(async () => {
    await moduleRef.close();
    await r.app.close();
    if (saved === undefined) delete process.env.DATABASE_URL_MAINT;
    else process.env.DATABASE_URL_MAINT = saved;
  });

  /** Demande d'un autre numéro (AWAITING_HOLDER) créée par la route. */
  const awaiting = async () => {
    const c = await fundedCustomer(r.w, 10_000);
    const phone = freshPhone();
    const res = await postRefund(r.app, c.customer, {
      wallet_id: c.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect(res.body.status).toBe('AWAITING_HOLDER');
    return { c, id: res.body.refund_request_id as string };
  };
  const setHold = (id: string, sql: string) => withOwner((db) => backdateHold(db, id, sql));
  const state = async (id: string) =>
    (
      await rows<{ status: string; lag: number }>(
        `SELECT status, extract(epoch FROM clock_timestamp() - hold_until)::float8 AS lag
           FROM refund_request WHERE id = $1`,
        [id],
      )
    )[0]!;

  it('test statique : l’intervalle de la tâche de maintenance est d’au plus 60 s', () => {
    expect(REFUND_PROMOTION_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it('échue depuis 4 min (horloge de la base) : REQUESTED en une itération, écart sous 5 min ; non échue : intacte', async () => {
    const due = await awaiting();
    const notDue = await awaiting();
    await setHold(due.id, "clock_timestamp() - interval '4 minutes'");
    expect(await worker.runOnce(tick())).toBeGreaterThanOrEqual(1);
    const promoted = await state(due.id);
    expect(promoted.status).toBe('REQUESTED');
    expect(promoted.lag).toBeLessThan(300);
    expect((await state(notDue.id)).status).toBe('AWAITING_HOLDER');
  });

  it('la décision du titulaire après l’échéance est refusée (409), la demande reste approuvable', async () => {
    const late = await awaiting();
    const link = holderLinkFor(r.sender, late.c.phone, late.id);
    await setHold(late.id, "clock_timestamp() - interval '1 minute'");
    await worker.runOnce(tick());
    const res = await request(r.app.getHttpServer())
      .post(`/v1/refund-requests/${late.id}/holder-decision`)
      .send({
        decision: 'BLOCK',
        ...link,
      });
    expect(res.status).toBe(409);
    expect((await state(late.id)).status).toBe('REQUESTED');
    expect((await proposeApproval(r, s.adminA, late.id)).status).toBe(202);
  });
});
