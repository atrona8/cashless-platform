// Intégration : espèces dues d'un bracelet remplacé (mission remboursements 9a, WP02 corrigé, WP06 ; FR-018, OP-N55).
// `replace_media` fait suivre au bracelet neuf les espèces dues ouvertes de l'ancien : `refundCashDue` sur le neuf les
// rend une fois et une seule ; l'ancien bracelet n'en porte plus.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  createBatch,
  createMediaWorld,
  goLive,
  ledgerIsSound,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('espèces dues après remplacement du bracelet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let batch: string;
  let counter = 0;
  const next = () => (counter += 1);
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send(body);
  const fresh = () =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: w.ops.a,
            batchId: batch,
            kmsKeyRef: w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  const openAnomalies = (m: SeededMedia) =>
    rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN'`,
      [m.id],
    ).then((r) => r[0]!.n);
  const journal = () =>
    rows<{ n: number }>('SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1', [
      w.ids.ledgerA,
    ]).then((r) => r[0]!.n);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      session = await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: device.deviceId,
        userId: w.cashierA.userId,
      });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('le neuf rend les espèces dues de l’ancien une fois et une seule ; second appel : 409, rien d’écrit ; l’ancien n’en porte plus', async () => {
    const old = await fresh();
    const activated = await post('/v1/media/activations', {
      tap: tapBody(old, next()),
      channel: 'DESK',
      occurred_at: new Date().toISOString(),
    });
    expect(activated.status).toBe(201);
    // Espèces dues (recharge hors ligne au-delà d'un plafond) : écriture, puis anomalie ouverte.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 900::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -900::bigint)))`,
        [w.ids.ledgerA, `test-cash-over:${randomUUID()}`, session.accountId],
      );
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, 900)`,
        [w.ops.a, w.ids.ledgerA, old.id],
      );
    });
    const neu = await fresh();
    const replaced = await post(`/v1/media/${old.id}/replace`, {
      new_media_tap: tapBody(neu, next()),
      reason: 'Bracelet déchiré, identité vérifiée sur pièce.',
    });
    expect(replaced.status).toBe(200);
    expect(await openAnomalies(old)).toBe(0);
    expect(await openAnomalies(neu)).toBe(1);

    const refund = await post(`/v1/media/${neu.id}/cash-due-refunds`, {
      tap: tapBody(neu, next()),
    });
    expect(refund.status).toBe(201);
    expect(refund.body).toMatchObject({
      media_id: neu.id,
      amount: 900,
      cash_session_id: session.sessionId,
    });
    expect(await openAnomalies(neu)).toBe(0);
    expect(await openAnomalies(old)).toBe(0);

    const before = await journal();
    const second = await post(`/v1/media/${neu.id}/cash-due-refunds`, {
      tap: tapBody(neu, next()),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'MEDIA_STATE_INVALID', rule: 'cash_due.nothing' });
    expect(await journal()).toBe(before);
    // L'ancien bracelet (remplacé, sans portefeuille) ne rend rien non plus.
    const oldRefund = await post(`/v1/media/${old.id}/cash-due-refunds`, {
      tap_id: 0,
    });
    expect(oldRefund.status).toBeGreaterThanOrEqual(400);
    expect(await journal()).toBe(before);
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  });
});
