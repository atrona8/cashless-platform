// Aides des tests de WP04 (création, listes, refus, `/me/wallets`) : monde de test avec règle de frais, festivaliers
// financés, application dont l'envoyeur de codes est d'enregistrement (aucun en-tête de test sur la création).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { createTestApp } from '../../support/app';
import { createPublicCode, freshPhone, requestOtp } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import {
  createCustomerWallet,
  createTestCustomer,
  type TestCustomer,
} from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';
import { RecordingSender } from './holder-fixtures';

export interface RefundWorld {
  w: MediaWorld;
  app: INestApplication;
  sender: RecordingSender;
  codeA: string;
}

/** Événement A en direct, frais de remboursement fixes de 500, date limite à +10 jours. */
export async function createRefundWorld(options: { feeRule?: boolean } = {}): Promise<RefundWorld> {
  const w = await createMediaWorld();
  await withOwner(async (db) => {
    await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
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
    if (options.feeRule !== false)
      await db.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
                             fixed_amount, trigger, valid_from)
       VALUES ($1, 'EVENT', $2, 'WALLET_PAID', 'ORG_FFEST', 'PER_REFUND', 500, 'REALTIME', '2026-01-01')`,
        [w.ops.a, w.ids.eventA],
      );
    await db.query("UPDATE event SET refund_deadline = now() + interval '10 days' WHERE id = $1", [
      w.ids.eventA,
    ]);
  });
  const sender = new RecordingSender();
  const app = await createTestApp({
    identity: w.idp,
    trustProxyHops: 1,
    overrides: [{ provide: OTP_SENDER, useValue: sender }],
  });
  const codeA = await createPublicCode(w.ops.a);
  return { w, app, sender, codeA };
}

export interface FundedCustomer {
  customer: TestCustomer;
  phone: string;
  walletId: string;
}

/** Festivalier du prestataire A, numéro vérifié, portefeuille crédité de `funds` (solde payé). */
export async function fundedCustomer(
  w: MediaWorld,
  funds = 10_000,
  operatorId: string = w.ops.a,
  ledgerId: string = w.ids.ledgerA,
): Promise<FundedCustomer> {
  return withOwner(async (db) => {
    const customer = await createTestCustomer(db, operatorId);
    const phone = freshPhone();
    await db.query(
      'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
      [customer.customerId, operatorId, phone],
    );
    const { walletId } = await createCustomerWallet(db, {
      operatorId,
      ledgerId,
      customerId: customer.customerId,
      funds,
    });
    return { customer, phone, walletId };
  });
}

export const setEvent = (w: MediaWorld, assignments: string) =>
  withOwner((db) => db.query(`UPDATE event SET ${assignments} WHERE id = $1`, [w.ids.eventA]));

/** Code envoyé à `phone` (usage connexion) : `{ otp_request_id, code }` pour `new_number_otp`. */
export async function codeFor(r: RefundWorld, phone: string, operatorCode = r.codeA) {
  const sent = await requestOtp(r.app, { phone, operator_code: operatorCode });
  if (sent.status !== 202) throw new Error(`demande de code : ${sent.status}`);
  return { otp_request_id: sent.body.otp_request_id as string, code: r.sender.lastCode(phone) };
}

export const postRefund = (
  app: INestApplication,
  who: TestCustomer,
  body: Record<string, unknown>,
  key: string = randomUUID(),
) =>
  request(app.getHttpServer())
    .post('/v1/me/refund-requests')
    .set(who.headers)
    .set('Idempotency-Key', key)
    .send(body);

/** Bracelet rattaché au portefeuille, puis passé à `status` (posé par le propriétaire de la base). */
export async function attachMedia(
  w: MediaWorld,
  walletId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'BLACKLISTED',
): Promise<string> {
  return withOwner(async (db) => {
    const batch = await createBatch(db, {
      operatorId: w.ops.a,
      organizerId: w.ids.organizerA,
      eventId: w.ids.eventA,
      status: 'ACTIVE',
    });
    const [m] = await seedPersonalizedMedia(db, {
      operatorId: w.ops.a,
      batchId: batch,
      kmsKeyRef: w.keyRef.a,
      count: 1,
    });
    await activateMedia(db, {
      operatorId: w.ops.a,
      eventId: w.ids.eventA,
      walletId,
      mediaIds: [m!.id],
    });
    if (status !== 'ACTIVE') {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query('UPDATE media SET status = $2 WHERE id = $1', [m!.id, status]);
    }
    return m!.id;
  });
}
