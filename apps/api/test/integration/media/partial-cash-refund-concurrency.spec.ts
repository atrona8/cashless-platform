// Intégration : rendu partiel en espèces, concurrence et latence (mission 9c, WP05 ; NFR-001, NFR-002). 20 envois
// simultanés (clés différentes) sur un même portefeuille : le solde payé n'est jamais dépassé, le cumul du jour et le
// seuil de la seconde personne tiennent sous concurrence (verrou du solde payé, ADR-195), aucune écriture en trop.
// Suite écartée de la passe parallèle (`SKIP_LATENCY`, jest.config.cjs) : 20 connexions simultanées et une mesure de
// temps ; la CI la lance seule, en série.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { TxClient } from '../../../src/db/tenant-tx';
import { partialRefundDayTotal } from '../../../src/media/lifecycle/partial-refund-threshold';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ledgerIsSound,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

jest.setTimeout(300_000);

describe('rendu partiel en espèces : concurrence et latence', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let batch: string;
  let counter = 0;
  const next = () => (counter += 1);
  const staff = () => ({ 'X-Staff-Authorization': `Bearer ${w.cashierA.token}` });

  const prepare = async (paid: number) => {
    const m = await withOwner(
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
    const res = await request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(device.headers)
      .set(staff())
      .set('Idempotency-Key', randomUUID())
      .send({ tap: tapBody(m, next()), channel: 'DESK', occurred_at: new Date().toISOString() });
    expect(res.status).toBe(201);
    const walletId = res.body.wallet.wallet_id as string;
    if (paid > 0)
      await withOwner((db) =>
        creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: paid }),
      );
    return { m, walletId };
  };
  const refund = (m: SeededMedia, payload: object) =>
    request(app.getHttpServer())
      .post(`/v1/media/${m.id}/partial-cash-refunds`)
      .set(device.headers)
      .set(staff())
      .set('Idempotency-Key', randomUUID())
      .send(payload);
  /** Passages enregistrés d'avance (un compteur par lecture) : les envois simultanés citent chacun le leur. */
  const taps = async (m: SeededMedia, count: number) => {
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()));
      ids.push(res.body.tap_id as number);
    }
    return ids;
  };
  const refunds = (walletId: string) =>
    rows<{ id: string }>(
      `SELECT DISTINCT t.id FROM journal_transaction t JOIN posting p ON p.transaction_id = t.id
         AND p.ledger_id = t.ledger_id JOIN account a ON a.id = p.account_id
        WHERE a.wallet_id = $1 AND t.type = 'WALLET_REFUND'`,
      [walletId],
    );
  const paidBalance = (walletId: string) =>
    rows<{ b: string }>(
      `SELECT coalesce(-sum(ab.balance), 0)::text AS b FROM account a
         JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'`,
      [walletId],
    ).then((r) => Number(r[0]!.b));
  const dayTotal = (walletId: string) =>
    withOwner((db) =>
      partialRefundDayTotal(db as unknown as TxClient, walletId, new Date(), w.ids.ledgerA),
    );
  const setSingleMax = (value: number) =>
    rows('UPDATE event SET cash_refund_single_max = $2 WHERE id = $1', [w.ids.eventA, value]);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      const contract = await db.query<{ id: string }>(
        `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                               cash_diff_bearer, breakage_organizer_bps)
         VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
        [w.ops.a, w.ids.organizerA],
      );
      await db.query('UPDATE event SET contract_id = $2 WHERE id = $1', [
        w.ids.eventA,
        contract.rows[0]!.id,
      ]);
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
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 9000000::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -9000000::bigint)))`,
        [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, session.accountId],
      );
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           fixed_amount, trigger, valid_from, version)
         VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', 0, 'REALTIME', now() - interval '1 day', 1)`,
        [w.ops.a, w.ids.eventA],
      );
      await db.query(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, 'OPERATOR', $1, 1, clock_timestamp() - interval '1 second', '{"cash_partial_refund_allowed": true}')`,
        [w.ops.a],
      );
      await db.query('UPDATE event SET cash_partial_refund_enabled = true WHERE id = $1', [
        w.ids.eventA,
      ]);
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('NFR-002 : 20 rendus simultanés de 1 000 sur un solde de 10 000 : exactement 10 passent, la somme rendue ne dépasse pas le solde, cumul exact', async () => {
    await setSingleMax(10_000_000);
    const { m, walletId } = await prepare(10_000);
    const ids = await taps(m, 20);
    const results = await Promise.all(ids.map((tap_id) => refund(m, { tap_id, amount: 1000 })));
    const ok = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status !== 201);
    expect(ok).toHaveLength(10);
    expect(refused.every((r) => r.status === 422 && r.body.code === 'INSUFFICIENT_FUNDS')).toBe(
      true,
    );
    const handed = ok.reduce((sum, r) => sum + (r.body.cash_handed as number), 0);
    expect(handed).toBeLessThanOrEqual(10_000);
    expect(handed).toBe(10_000);
    expect(await paidBalance(walletId)).toBe(0);
    expect(await refunds(walletId)).toHaveLength(10);
    expect(await dayTotal(walletId)).toBe(10_000n);
    // Les cumuls annoncés sont 1 000, 2 000, … 10 000, chacun une fois (aucune lecture périmée).
    expect(ok.map((r) => r.body.day_cumulative as number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1) * 1000),
    );
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  });

  it('NFR-002 : 20 rendus simultanés de 1 000 répartis sur deux bracelets du même portefeuille, maximum 5 000, sans jeton : le cumul du portefeuille ne dépasse jamais le maximum', async () => {
    await setSingleMax(5000);
    try {
      const a = await prepare(100_000);
      const b = await prepare(0);
      // Second bracelet actif sur le même portefeuille : le verrou du bracelet ne sérialise plus les deux files.
      await rows(
        'UPDATE media_assignment SET wallet_id = $2 WHERE media_id = $1 AND released_at IS NULL',
        [b.m.id, a.walletId],
      );
      const idsA = await taps(a.m, 10);
      const idsB = await taps(b.m, 10);
      const results = await Promise.all([
        ...idsA.map((tap_id) => refund(a.m, { tap_id, amount: 1000 })),
        ...idsB.map((tap_id) => refund(b.m, { tap_id, amount: 1000 })),
      ]);
      const ok = results.filter((r) => r.status === 201);
      expect(ok).toHaveLength(5);
      expect(
        results
          .filter((r) => r.status !== 201)
          .every((r) => r.status === 403 && r.body.code === 'APPROVAL_REQUIRED'),
      ).toBe(true);
      expect(await dayTotal(a.walletId)).toBe(5000n);
      expect(await paidBalance(a.walletId)).toBe(95_000);
      expect(await refunds(a.walletId)).toHaveLength(5);
    } finally {
      await setSingleMax(10_000_000);
    }
  });

  // NFR-001 : p95 < 300 ms sur 50 rendus. Mesure écartée de la passe parallèle (`SKIP_LATENCY`), lancée seule.
  const latency = process.env.SKIP_LATENCY ? it.skip : it;
  latency('NFR-001 : p95 du rendu partiel sous 300 ms sur 50 rendus', async () => {
    await setSingleMax(10_000_000);
    const { m } = await prepare(500_000);
    const durations: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const started = process.hrtime.bigint();
      const res = await refund(m, { tap: tapBody(m, next()), amount: 1000 });
      durations.push(Number(process.hrtime.bigint() - started) / 1e6);
      expect(res.status).toBe(201);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    console.log(
      `partial-cash-refund latence : p50=${durations[24]!.toFixed(0)} ms, p95=${p95.toFixed(0)} ms, max=${durations[49]!.toFixed(0)} ms`,
    );
    expect(p95).toBeLessThan(300);
  });
});
