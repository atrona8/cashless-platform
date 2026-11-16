// Preuve de bout en bout de la mission 9a (WP07 ; SC-001 à SC-005, NFR-003, négatif d'ADR-189). Un `describe` par
// critère. Les routes sont appelées comme le feront l'application festivalier et le back-office ; les fixtures de
// `test/support/*` et des lots précédents sont lues sans être modifiées.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER, LedgerModule } from '../../../src/ledger/ledger.module';
import { EVENT_STATUSES, isAccepted, type LedgerStatus } from '../../../src/ledger/status-matrix';
import type { LedgerCommand } from '../../../src/ledger/types';
import { createTestApp } from '../../support/app';
import { bearer, exchange, requestOtp } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
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
import {
  createMiniFixture,
  inMemoryConfigResolver,
  type MiniFixture,
} from '../engine/mini-fixture';
import { codeFor, fundedCustomer, postRefund, type FundedCustomer } from './create-fixtures';
import {
  call,
  confirm,
  countOfType,
  createRefundWorld,
  createStaff,
  executeApproval,
  journalCount,
  paidBalance,
  proposeApproval,
  requestState,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';
import {
  balanceOfCode,
  expectRefundInvariants,
  holderLinkFor,
  ledgerBalances,
} from './refund-invariants';

jest.setTimeout(300_000);

const wave = (walletId: string) => ({ wallet_id: walletId, destination: { method: 'WAVE' } });

describe('SC-001 à SC-003, SC-005 : parcours du festivalier et du back-office', () => {
  let r: RefundWorld;
  let s: Staff;

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
    // Comptes A-PSP-* : ouverts à la sélection du PSP en production (idempotent).
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [r.w.ops.a]);
      await db.query('SELECT open_psp_accounts($1)', [r.w.ids.ledgerA]);
    });
  });
  afterAll(async () => {
    await r.app.close();
  });

  /** Demande créée par la ROUTE du festivalier (jamais insérée en base). */
  const created = async (c: FundedCustomer) => {
    const res = await postRefund(r.app, c.customer, wave(c.walletId));
    expect(res.status).toBe(201);
    return res.body.refund_request_id as string;
  };
  const decide = (id: string, body: object) =>
    request(r.app.getHttpServer()).post(`/v1/refund-requests/${id}/holder-decision`).send(body);

  it('SC-001 : connexion par code, /me/wallets (refund.eligible), création, liste, décision : aucune route en 404', async () => {
    const c = await fundedCustomer(r.w, 20_000);
    const sent = await requestOtp(r.app, { phone: c.phone, operator_code: r.codeA });
    expect(sent.status).toBe(202);
    const done = await exchange(r.app, {
      otp_request_id: sent.body.otp_request_id,
      code: r.sender.lastCode(c.phone),
    });
    expect(done.status).toBe(200);
    const auth = bearer(done.body.access_token as string);
    const wallets = await request(r.app.getHttpServer()).get('/v1/me/wallets').set(auth);
    expect(wallets.status).toBe(200);
    const mine = wallets.body.data.find((x: { wallet_id: string }) => x.wallet_id === c.walletId);
    expect(mine.refund.eligible).toBe(true);
    const make = await request(r.app.getHttpServer())
      .post('/v1/me/refund-requests')
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send(wave(c.walletId));
    expect(make.status).toBe(201);
    const list = await request(r.app.getHttpServer()).get('/v1/me/refund-requests').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { refund_request_id: string }) => x.refund_request_id)).toContain(
      make.body.refund_request_id,
    );
    // Décision du titulaire : route servie (code absent => refus 4xx, jamais 404 ; la route est publique).
    const holder = await decide(make.body.refund_request_id, {
      decision: 'CONFIRM',
      otp_request_id: `otp_${randomUUID()}`,
      code: '000000',
    });
    expect(holder.status).not.toBe(404);
    expect(holder.status).toBeLessThan(500);
  });

  it('SC-002 (a) parcours payé : le festivalier perd son solde payé, le PSP reçoit solde moins frais, les frais vont à ORG_FFEST/ORG_TAX', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const ledger = r.w.ids.ledgerA;
    const psp0 = await balanceOfCode(ledger, 'A-PSP-WAVE');
    const fees0 =
      (await balanceOfCode(ledger, 'L-ORG-FFEST')) + (await balanceOfCode(ledger, 'L-ORG-TAX'));
    const id = await created(c);
    const proposed = await proposeApproval(r, s.adminA, id);
    expect(proposed.status).toBe(202);
    const done = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    expect(await paidBalance(c.walletId)).toBe(0);
    // Convention du grand livre : sortie du passif positive, entrées des comptes de contrepartie négatives.
    expect((await balanceOfCode(ledger, 'A-PSP-WAVE')) - psp0).toBe(-24_500);
    const fees1 =
      (await balanceOfCode(ledger, 'L-ORG-FFEST')) + (await balanceOfCode(ledger, 'L-ORG-TAX'));
    expect(fees1 - fees0).toBe(-500);
    const snapshot = await ledgerBalances(ledger);
    const paid = await confirm(r, s.adminC, id, {
      outcome: 'PAID',
      external_reference: 'WAVE-J-1',
    });
    expect(paid.body.status).toBe('PAID');
    // NFR-003 : PAID n'écrit rien ; aucun compte L-* ni autre n'a bougé.
    await expectRefundInvariants({
      ledgerId: ledger,
      walletId: c.walletId,
      initialPaid: 25_000,
      refundedPaid: 25_000,
      unchangedSince: snapshot,
    });
  });

  it('SC-002 (b) parcours échoué : FAILED rend TOUT le solde payé, nouvelle demande possible', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const id = await created(c);
    const proposed = await proposeApproval(r, s.adminA, id);
    await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(await paidBalance(c.walletId)).toBe(0);
    const failed = await confirm(r, s.adminC, id, {
      outcome: 'FAILED',
      failure_reason: 'Numéro clos.',
    });
    expect(failed.status).toBe(200);
    await expectRefundInvariants({
      ledgerId: r.w.ids.ledgerA,
      walletId: c.walletId,
      initialPaid: 25_000,
      refundedPaid: 0,
    });
    expect((await postRefund(r.app, c.customer, wave(c.walletId))).status).toBe(201);
  });

  it('SC-002 (c) refusé et bloqué : aucune écriture au grand livre', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const rejectedId = await created(c);
    const rej = await call(r.app, s.adminA, `/refund-requests/${rejectedId}/reject`, {
      reason: 'Contrôle négatif.',
    });
    expect(rej.status).toBe(200);
    expect((await requestState(rejectedId)).status).toBe('REJECTED');
    // BLOCKED : autre numéro, le titulaire bloque.
    const other = await fundedCustomer(r.w, 25_000);
    const phone = `+2217${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const res = await postRefund(r.app, other.customer, {
      wallet_id: other.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect(res.status).toBe(201);
    const before = await journalCount(r.w.ids.ledgerA);
    const blocked = await decide(res.body.refund_request_id, {
      decision: 'BLOCK',
      ...holderLinkFor(r.sender, other.phone, res.body.refund_request_id),
    });
    expect(blocked.body.status).toBe('BLOCKED');
    expect(await journalCount(r.w.ids.ledgerA)).toBe(before);
    expect(await paidBalance(c.walletId)).toBe(25_000);
    expect(await paidBalance(other.walletId)).toBe(25_000);
    await expectRefundInvariants({ ledgerId: r.w.ids.ledgerA });
  });

  it('SC-003 : 20 tentatives de validation par l’auteur de la proposition : 20 refus, 0 WALLET_REFUND', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const id = await created(c);
    const proposed = await proposeApproval(r, s.adminA, id);
    const before = await countOfType(r.w.ids.ledgerA, 'WALLET_REFUND');
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        executeApproval(r, s.adminA, proposed.body.approval_request_id),
      ),
    );
    expect(attempts.filter((x) => x.status >= 400 && x.status < 500)).toHaveLength(20);
    expect(await countOfType(r.w.ids.ledgerA, 'WALLET_REFUND')).toBe(before);
    expect((await requestState(id)).status).toBe('REQUESTED');
    // Le même acte validé par une autre personne passe : le refus tenait bien à l'identité.
    expect(
      (await executeApproval(r, s.adminB, proposed.body.approval_request_id)).body.status,
    ).toBe('EXECUTED');
  });

  it('décision 14 : la réponse de la création vers un autre numéro ne contient pas le code du titulaire (corps, en-têtes, X-Test-Otp-Code compris)', async () => {
    const c = await fundedCustomer(r.w, 25_000);
    const phone = `+2217${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const res = await postRefund(r.app, c.customer, {
      wallet_id: c.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect(res.status).toBe(201);
    const id = res.body.refund_request_id as string;
    // Le code réellement envoyé au titulaire, tel que reçu par l'envoyeur.
    const sent = holderLinkFor(r.sender, c.phone, id);
    expect(sent.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify([res.body, res.headers])).not.toContain(sent.code);
    expect(res.headers['x-test-otp-code']).toBeUndefined();
    // Le lien reçu suffit à décider, sans lecture en base.
    const done = await decide(id, { decision: 'CONFIRM', ...sent });
    expect(done.status).toBe(200);
  });

  it('SC-005 : autre numéro avec titulaire vérifié : non approuvable avant CONFIRM ou échéance ; BLOCK jamais approuvable', async () => {
    const newRequest = async () => {
      const c = await fundedCustomer(r.w, 25_000);
      const phone = `+2217${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      const res = await postRefund(r.app, c.customer, {
        wallet_id: c.walletId,
        destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
      });
      expect(res.body.status).toBe('AWAITING_HOLDER');
      return { c, id: res.body.refund_request_id as string };
    };
    // CONFIRM.
    const a = await newRequest();
    expect((await proposeApproval(r, s.adminA, a.id)).status).toBe(409);
    const confirmed = await decide(a.id, {
      decision: 'CONFIRM',
      ...holderLinkFor(r.sender, a.c.phone, a.id),
    });
    expect(confirmed.body.status).toBe('REQUESTED');
    expect((await proposeApproval(r, s.adminA, a.id)).status).toBe(202);
    // BLOCK.
    const b = await newRequest();
    const blocked = await decide(b.id, {
      decision: 'BLOCK',
      ...holderLinkFor(r.sender, b.c.phone, b.id),
    });
    expect(blocked.body.status).toBe('BLOCKED');
    expect((await proposeApproval(r, s.adminA, b.id)).status).toBe(409);
    // Échéance : l'horloge de la base (jamais celle de Node) ; la promotion rend la demande approuvable.
    const d = await newRequest();
    await withOwner((db) =>
      db.query(
        `UPDATE refund_request SET hold_until = clock_timestamp() - interval '1 minute' WHERE id = $1`,
        [d.id],
      ),
    );
    await withOwner((db) => db.query('SELECT promote_due_refund_requests()'));
    expect((await requestState(d.id)).status).toBe('REQUESTED');
    expect((await proposeApproval(r, s.adminA, d.id)).status).toBe(202);
  });
});

describe('SC-004 : guichet enchaîné, de l’activation à la restitution', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let seq = 0;

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
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', $3::uuid, 'amount', 500000::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -500000::bigint)))`,
        [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, session.accountId],
      );
      await db.query('UPDATE event SET cash_refund_single_max = 100000 WHERE id = $1', [
        w.ids.eventA,
      ]);
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           fixed_amount, trigger, valid_from, version)
         VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', 0, 'REALTIME', now() - interval '1 day', 1)`,
        [w.ops.a, w.ids.eventA],
      );
    });
    app = await createTestApp({ identity: w.idp });
  });
  afterAll(async () => {
    await app.close();
  });

  it('caution, crédits offerts, solde payé et espèces dues rendus par UN appel, dans l’ordre de §7.9', async () => {
    const batch = await withOwner((db) =>
      createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        depositAmount: 1000,
        depositMode: 'SEPARATE',
        preloadPromoAmount: 300,
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
    await withOwner((db) =>
      creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: 2500 }),
    );
    // Espèces dues : excédent de recharge en espèces hors plafond, consigné comme anomalie ouverte.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', 700::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -700::bigint)))`,
        [w.ids.ledgerA, `test-cash-over:${randomUUID()}`, session.code],
      );
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, 700)`,
        [w.ops.a, w.ids.ledgerA, m.id],
      );
    });
    const res = await request(app.getHttpServer())
      .post(`/v1/media/${m.id}/release`)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({
        tap: tapBody(m, (seq += 1)),
        settle_balance: { method: 'CASH' },
        cash_session_id: session.sessionId,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      media_status: 'RELEASED',
      cash_to_hand_back: 1000 + 2500 + 700,
    });
    const written = await rows<{ type: string }>(
      `SELECT type FROM journal_transaction WHERE media_id = $1 OR idempotency_key LIKE '%' || $1::text || '%'
        ORDER BY recorded_at, id`,
      [m.id],
    );
    // Ordre de §7.9 : caution, expiration des crédits offerts, solde payé, espèces dues.
    expect(
      written
        .map((t) => t.type)
        .filter((t) => ['DEPOSIT_REFUNDED', 'PROMO_EXPIRY', 'WALLET_REFUND'].includes(t)),
    ).toEqual(['DEPOSIT_REFUNDED', 'PROMO_EXPIRY', 'WALLET_REFUND', 'WALLET_REFUND']);
    await expectRefundInvariants({ ledgerId: w.ids.ledgerA });
  });
});

describe('OP-N128 (a) : caution seule au-dessus du seuil rendue avec jeton, sans approbateur sur l’écriture', () => {
  it('DEPOSIT_REFUNDED porte approved_by nul ; l’approbateur n’est que dans l’audit du jeton (limite consignée)', async () => {
    const w = await createMediaWorld();
    const app = await createTestApp({ identity: w.idp });
    try {
      let seq = 100;
      const supervisor = await withOwner(async (db) => {
        const contract = await db.query<{ id: string }>(
          `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                                 cash_diff_bearer, breakage_organizer_bps)
           VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
          [w.ops.a, w.ids.organizerA],
        );
        await db.query(
          'UPDATE event SET contract_id = $2, cash_refund_single_max = 500 WHERE id = $1',
          [w.ids.eventA, contract.rows[0]!.id],
        );
        await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
        return w.idp.createPerson(db, {
          operatorId: w.ops.a,
          roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
        });
      });
      const { device, session } = await withOwner(async (db) => {
        const d = await createTestDevice(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          kind: 'TOPUP',
        });
        const sess = await openCashSession(db, {
          operatorId: w.ops.a,
          deviceId: d.deviceId,
          userId: w.cashierA.userId,
        });
        await db.query(
          `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
             jsonb_build_object('account_id', $3::uuid, 'amount', 100000::bigint),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -100000::bigint)))`,
          [w.ids.ledgerA, `test-desk-float:${randomUUID()}`, sess.accountId],
        );
        return { device: d, session: sess };
      });
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
      const path = `/v1/media/${m.id}/release`;
      const body = { refund_deposit_by: { method: 'CASH' }, cash_session_id: session.sessionId };
      const send = (token?: string) => {
        const req = request(app.getHttpServer())
          .post(path)
          .set(device.headers)
          .set('Idempotency-Key', randomUUID())
          .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`);
        return (token ? req.set('X-Approval-Token', token) : req).send(body);
      };
      expect((await send()).status).toBe(403);
      const token = await w.idp.approvalToken({
        subject: supervisor.subject,
        act: 'releaseMedia',
        actHash: actHash('POST', path, body),
      });
      const ok = await send(token);
      expect(ok.status).toBe(200);
      const [tx] = await rows<{ approved_by: string | null }>(
        `SELECT approved_by FROM journal_transaction WHERE id = $1`,
        [ok.body.deposit_refund_transaction_id],
      );
      // Limite : l'approbateur n'est pas porté par l'écriture de la caution.
      expect(tx!.approved_by).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe('négatif d’ADR-189 : seul le REVERSAL d’un WALLET_REFUND de source BACKOFFICE est élargi', () => {
  let app: INestApplication;
  let fx: MiniFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  let seq = 0;
  const author = randomUUID();
  const approver = randomUUID();

  const command = (
    type: LedgerCommand['type'],
    key: string,
    payload: unknown,
    source: LedgerCommand['source'] = 'BACKOFFICE',
  ): LedgerCommand => ({
    type,
    idempotencyKey: key,
    occurredAt: new Date(),
    source,
    ...(source === 'BACKOFFICE' ? { createdBy: author, approvedBy: approver } : {}),
    ledgerId: fx.ledgerId,
    eventId: fx.eventId,
    currency: 'XOF',
    payload,
  });
  const run = (cmd: LedgerCommand) =>
    tx.run(fx.operatorId, (client) => engine.execute(client, cmd));
  const caught = (cmd: LedgerCommand): Promise<unknown> =>
    run(cmd).then(
      () => undefined,
      (error: unknown) => error,
    );
  const setStates = (event: string, ledger: string) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.event_status_change', 'on', false)`);
      await db.query('UPDATE event SET status = $2 WHERE id = $1', [fx.eventId, event]);
      await db.query(`SELECT set_config('app.event_status_change', 'off', false)`);
      await db.query('UPDATE ledger SET status = $2 WHERE id = $1', [fx.ledgerId, ledger]);
    });
  const reversal = (id: string, key: string, source: LedgerCommand['source'] = 'BACKOFFICE') => ({
    ...command('REVERSAL', key, {}, source),
    reversesId: id,
  });

  beforeAll(async () => {
    fx = await createMiniFixture();
    app = await createTestApp({
      imports: [
        LedgerModule.register({
          provide: CONFIG_RESOLVER,
          useValue: inMemoryConfigResolver(() => fx.config),
        }),
      ],
    });
    await withOwner(async (db) => {
      for (const [id, name] of [
        [author, 'auteur'],
        [approver, 'valideur'],
      ] as const)
        await db.query(
          `INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
           VALUES ($1, $2, 'https://idp.test', $5, $3, $4)`,
          [id, fx.operatorId, `${name}-${id}@j.test`, name, `j-${id}`],
        );
    });
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
    await run(
      command(
        'TOPUP',
        'wave:j-seed',
        { walletId: fx.wallet1, channel: 'WAVE', amount: 50_000n },
        'PSP_WEBHOOK',
      ),
    );
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => setStates('LIVE', 'OPEN'));

  const refund = (key: string) =>
    run(
      command('WALLET_REFUND', key, {
        walletId: fx.wallet1,
        amount: 700n,
        moneyAccount: 'A-PSP-WAVE',
      }),
    );

  it('matrice : aucun autre REVERSAL n’est élargi (tous types, statuts d’événement, sources, grands livres)', () => {
    const types = [
      'TOPUP',
      'PURCHASE',
      'TRANSFER',
      'ADJUSTMENT',
      'CHARGEBACK',
      'DEPOSIT_REFUNDED',
      'PROMO_EXPIRY',
      'TOPUP_CASH',
      'BREAKAGE_REVERSAL',
      'REVERSAL',
    ] as const;
    const sources = [
      'BACKOFFICE',
      'ONLINE',
      'OFFLINE_SYNC',
      'EDGE_SYNC',
      'PSP_WEBHOOK',
      'BATCH',
    ] as const;
    let widened = 0;
    let wallet = 0;
    for (const eventStatus of EVENT_STATUSES)
      for (const ledgerStatus of ['OPEN', 'CLOSING', 'LOCKED'] as LedgerStatus[])
        for (const source of sources) {
          const base = { eventStatus, ledgerStatus, type: 'REVERSAL', source } as never;
          const baseline = isAccepted(base).ok;
          for (const reversesType of types)
            if (isAccepted({ ...(base as object), reversesType } as never).ok !== baseline)
              widened += 1;
          const forRefund = isAccepted({
            ...(base as object),
            reversesType: 'WALLET_REFUND',
          } as never).ok;
          if (forRefund !== baseline) {
            wallet += 1;
            expect(source).toBe('BACKOFFICE');
          }
        }
    expect(widened).toBe(0);
    expect(wallet).toBeGreaterThan(0);
  });

  it('moteur : REVERSAL d’un PURCHASE en SETTLING refusé ; d’un WALLET_REFUND de toute autre source refusé ; BACKOFFICE accepté en RECONCILING', async () => {
    const sale = await run(
      command(
        'PURCHASE',
        `TPE-FOOD:j-${++seq}`,
        { walletId: fx.wallet1, participationId: fx.participationId, amount: 1_000n },
        'ONLINE',
      ),
    );
    const refunded = await refund(`bo:j-refund-${++seq}`);
    await setStates('SETTLING', 'OPEN');
    const purchase = await caught(reversal(sale.transactionId!, `bo:j-rp-${++seq}`));
    expect(purchase).toBeInstanceOf(ProblemException);
    for (const source of ['ONLINE', 'OFFLINE_SYNC', 'EDGE_SYNC', 'PSP_WEBHOOK', 'BATCH'] as const)
      expect(
        await caught(reversal(refunded.transactionId!, `bo:j-rs-${source}-${++seq}`, source)),
      ).toBeInstanceOf(ProblemException);
    await setStates('RECONCILING', 'OPEN');
    const ok = await run(reversal(refunded.transactionId!, `bo:j-ok-${++seq}`));
    expect(ok.replayed).toBe(false);
  });

  it('base : le grand livre LOCKED refuse toujours la contre-passation d’un WALLET_REFUND (CL003)', async () => {
    const refunded = await refund(`bo:j-refund-${++seq}`);
    await withOwner((db) =>
      db.query(
        `UPDATE ledger SET status = 'LOCKED', late_claims_until = clock_timestamp() + interval '1 hour' WHERE id = $1`,
        [fx.ledgerId],
      ),
    );
    const error = await caught(reversal(refunded.transactionId!, `bo:j-locked-${++seq}`));
    expect((error as { code?: string }).code).toBe('CL003');
  });
});
