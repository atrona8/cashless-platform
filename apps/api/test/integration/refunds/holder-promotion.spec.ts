// Intégration (mission 9a, WP03 ; FR-013) : promotion des demandes échues par le processus `maintenance`, sous le rôle
// `cashless_maint` (aucune décision du titulaire n'est inventée).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  REFUND_PROMOTION_INTERVAL_MS,
  RefundPromotionWorker,
} from '../../../src/processes/maintenance-refund-promotion';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { MAINT_URL, withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { createHolder, insertRequest } from './holder-fixtures';

describe('promotion des demandes échues (processus maintenance)', () => {
  const saved = process.env.DATABASE_URL_MAINT;
  let w: MediaWorld;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let worker: RefundPromotionWorker;
  let eventB: { eventId: string; ledgerId: string };

  beforeAll(async () => {
    process.env.DATABASE_URL_MAINT = MAINT_URL;
    w = await createMediaWorld();
    // Événement et grand livre du prestataire B (la fixture n'en crée qu'un pour A).
    eventB = await withOwner(async (db) => {
      const eventId = randomUUID();
      const profile = (
        await db.query<{ id: string }>('SELECT id FROM jurisdiction_profile LIMIT 1')
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventId, w.ops.b, w.ids.organizerB, profile],
      );
      await db.query("SELECT set_config('app.operator_id', $1, false)", [w.ops.b]);
      const ledgerId = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventId])
      ).rows[0]!.ledger;
      return { eventId, ledgerId };
    });
    moduleRef = await Test.createTestingModule({ imports: [MaintenanceProcessModule] }).compile();
    await moduleRef.init();
    worker = moduleRef.get(RefundPromotionWorker, { strict: false });
  });
  afterAll(async () => {
    await moduleRef.close();
    if (saved === undefined) delete process.env.DATABASE_URL_MAINT;
    else process.env.DATABASE_URL_MAINT = saved;
  });

  const status = async (id: string) =>
    (
      await rows<{ status: string; holder_decision: string | null }>(
        'SELECT status, holder_decision FROM refund_request WHERE id = $1',
        [id],
      )
    )[0]!;
  let clock = Date.now() + 10 * REFUND_PROMOTION_INTERVAL_MS;
  const tick = () => {
    clock += REFUND_PROMOTION_INTERVAL_MS + 1;
    return clock;
  };

  it('le travailleur est enregistré et se décrit', async () => {
    const registry = moduleRef.get(WorkerRegistry, { strict: false });
    expect(registry).toBeDefined();
    const text = (await worker.describe()).join(' ');
    expect(text).toContain('refund-promotion');
    expect(text).toContain('60');
  });

  it('échue promue (deux prestataires), non échue intacte, décision jamais inventée, second passage = 0', async () => {
    const [ha, hb, hc] = await withOwner(async (db) => [
      await createHolder(db, w),
      await createHolder(db, w, w.ops.b),
      await createHolder(db, w),
    ]);
    const past = "clock_timestamp() - interval '1 minute'";
    const dueA = await withOwner((db) => insertRequest(db, w, ha, { holdSql: past }));
    const dueB = await withOwner((db) =>
      insertRequest(db, w, hb, {
        holdSql: past,
        operatorId: w.ops.b,
        ledgerId: eventB.ledgerId,
        eventId: eventB.eventId,
      }),
    );
    const future = await withOwner((db) => insertRequest(db, w, hc));
    const requested = await withOwner((db) => insertRequest(db, w, ha, { status: 'REQUESTED' }));
    const n = await worker.runOnce(tick());
    expect(n).toBeGreaterThanOrEqual(2);
    for (const r of [dueA, dueB]) {
      expect(await status(r.id)).toEqual({ status: 'REQUESTED', holder_decision: null });
    }
    expect((await status(future.id)).status).toBe('AWAITING_HOLDER');
    expect((await status(requested.id)).status).toBe('REQUESTED');
    // Second passage : plus rien à promouvoir.
    expect(await worker.runOnce(tick())).toBe(0);
  });

  it('cadence : rien avant l’échéance d’une minute, même s’il y a des demandes échues', async () => {
    const h = await withOwner((db) => createHolder(db, w));
    const due = await withOwner((db) =>
      insertRequest(db, w, h, { holdSql: "clock_timestamp() - interval '1 second'" }),
    );
    const t = tick();
    await worker.runOnce(t); // passe et reprogramme (la demande est peut-être déjà promue ici)
    const again = await withOwner((db) =>
      insertRequest(db, w, h, { holdSql: "clock_timestamp() - interval '1 second'" }),
    );
    expect(await worker.runOnce(t + REFUND_PROMOTION_INTERVAL_MS - 1)).toBe(0);
    expect((await status(again.id)).status).toBe('AWAITING_HOLDER');
    expect(await worker.runOnce(t + REFUND_PROMOTION_INTERVAL_MS)).toBeGreaterThanOrEqual(1);
    expect((await status(again.id)).status).toBe('REQUESTED');
    expect((await status(due.id)).status).toBe('REQUESTED');
  });
});
