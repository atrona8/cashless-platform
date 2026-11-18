// Intégration (mission 9b, WP11 ; FR-019, OP-N128) : (a) sous le seuil de la seconde personne, `DEPOSIT_REFUNDED` garde
// un valideur nul ; (b) le solde payé est verrouillé AVANT la lecture du cumul : une écriture concurrente qui tient le
// verrou est attendue, puis le cumul lu est le cumul réel et le jeton est exigé s'il dépasse le seuil.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { createTestApp } from '../../support/app';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
} from '../../support/media-fixtures';

jest.setTimeout(300_000);

describe('restitution : valideur de la caution et cumul sous verrou (OP-N128)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let supervisor: { subject: string; userId: string };
  let seq = 200;

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
    await withOwner(async (db) => {
      const contract = await db.query<{ id: string }>(
        `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                               cash_diff_bearer, breakage_organizer_bps)
         VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
        [w.ops.a, w.ids.organizerA],
      );
      await db.query(
        'UPDATE event SET contract_id = $2, cash_refund_single_max = 2000 WHERE id = $1',
        [w.ids.eventA, contract.rows[0]!.id],
      );
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           fixed_amount, trigger, valid_from, version)
         VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', 0, 'REALTIME', now() - interval '1 day', 1)`,
        [w.ops.a, w.ids.eventA],
      );
      supervisor = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
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
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 100000::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -100000::bigint)))`,
        [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, session.accountId],
      );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  /** Bracelet activé (caution 1000 en espèces) sur un portefeuille crédité de `funds`. */
  const activated = async (funds: number) => {
    const batch = await withOwner((db) =>
      createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        depositAmount: 1000,
        depositMode: 'SEPARATE',
      }),
    );
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
    const act = await request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({
        tap: tapBody(m, (seq += 1)),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
        deposit_payment: { method: 'CASH' },
      });
    expect(act.status).toBe(201);
    const walletId = act.body.wallet.wallet_id as string;
    if (funds > 0)
      await withOwner((db) =>
        creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: funds }),
      );
    return { m, walletId };
  };
  const release = (m: Awaited<ReturnType<typeof activated>>['m'], body: object, token?: string) => {
    const req = request(app.getHttpServer())
      .post(`/v1/media/${m.id}/release`)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`);
    return (token ? req.set('X-Approval-Token', token) : req).send(body);
  };
  const tokenFor = (m: { id: string }, body: object) =>
    w.idp.approvalToken({
      subject: supervisor.subject,
      act: 'releaseMedia',
      actHash: actHash('POST', `/v1/media/${m.id}/release`, body),
    });

  it('(a) sous le seuil : DEPOSIT_REFUNDED sans valideur, auteur = le caissier', async () => {
    const { m } = await activated(0);
    const ok = await release(m, {
      refund_deposit_by: { method: 'CASH' },
      cash_session_id: session.sessionId,
    });
    expect(ok.status).toBe(200);
    const [tx] = await rows<{ approved_by: string | null; created_by: string | null }>(
      'SELECT approved_by, created_by FROM journal_transaction WHERE id = $1',
      [ok.body.deposit_refund_transaction_id],
    );
    expect(tx).toEqual({ approved_by: null, created_by: w.cashierA.userId });
  });

  it('(b) fenêtre de course : une dépense ou une recharge concurrente qui tient le verrou du solde est attendue ; le cumul lu est réel, le jeton est exigé', async () => {
    const { m, walletId } = await activated(500); // 1000 + 500 = 1500 <= 2000 : sans jeton si rien ne bouge
    const body = (() => ({
      settle_balance: { method: 'CASH' },
      cash_session_id: session.sessionId,
    }))();
    // L'écriture concurrente prend le verrou du solde payé (comme `post_transaction`) et recharge de 1500 ; elle n'est
    // validée qu'une fois la restitution en attente sur ce verrou.
    const res = await commitWhileWaiting(
      {
        sql: `SELECT set_config('app.operator_id', $1, true), wallet_topup_headroom($2::uuid, now()),
                     post_transaction($3, 'TOPUP', $4, now(), 'PSP_WEBHOOK', jsonb_build_array(
                       jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $3 AND purpose = 'BANK'), 'amount', 1500::bigint),
                       jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $2 AND purpose = 'WALLET_PAID'), 'amount', -1500::bigint)))`,
        params: [w.ops.a, walletId, w.ids.ledgerA, `test-topup:${randomUUID()}`],
      },
      { role: 'cashless_app', statement: 'wallet_topup_headroom' },
      () => release(m, { ...body, tap: tapBody(m, (seq += 1)) }),
    );
    // Cumul réel : 1000 + 2000 = 3000 > 2000 : sans jeton, refus ; rien n'a été écrit.
    expect([res.status, res.body.code]).toEqual([403, 'APPROVAL_REQUIRED']);
    const written = await rows(
      `SELECT 1 FROM journal_transaction WHERE type IN ('DEPOSIT_REFUNDED', 'WALLET_REFUND') AND media_id = $1`,
      [m.id],
    );
    expect(written).toHaveLength(0);
    // Avec le jeton : la restitution passe et la caution porte le valideur.
    const full = { ...body, tap: tapBody(m, (seq += 1)) };
    const ok = await release(m, full, await tokenFor(m, full));
    expect(ok.status).toBe(200);
    const [tx] = await rows<{ approved_by: string | null }>(
      'SELECT approved_by FROM journal_transaction WHERE id = $1',
      [ok.body.deposit_refund_transaction_id],
    );
    expect(tx!.approved_by).toBe(supervisor.userId);
  });
});
