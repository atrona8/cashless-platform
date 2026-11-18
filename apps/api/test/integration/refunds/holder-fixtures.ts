// Aides des tests du parcours du titulaire (mission 9a, WP03) : envoyeur d'enregistrement (les tests lisent les codes
// ici, jamais par un en-tête) et demandes de remboursement INSÉRÉES par le propriétaire (la création arrive avec WP04).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { HolderLink, OtpChannel, OtpSender } from '../../../src/customer-auth/otp-sender';
import { freshPhone } from '../../support/customer-auth';
import { createCustomerWallet, createTestCustomer } from '../../support/fake-customer';
import type { MediaWorld } from '../../support/media-fixtures';

/** Envoyeur d'enregistrement : garde les codes envoyés, dans l'ordre. N'est pas un faux (`isFake` absent). */
export class RecordingSender implements OtpSender {
  readonly sent: Array<{ phone: string; code: string; channel: OtpChannel; link?: HolderLink }> =
    [];
  send(phone: string, code: string, channel: OtpChannel, link?: HolderLink): Promise<void> {
    this.sent.push({ phone, code, channel, ...(link ? { link } : {}) });
    return Promise.resolve();
  }
  lastCode(phone: string): string {
    const found = [...this.sent].reverse().find((s) => s.phone === phone);
    if (!found) throw new Error(`aucun code envoyé à ${phone}`);
    return found.code;
  }
  count(phone: string): number {
    return this.sent.filter((s) => s.phone === phone).length;
  }
}

/**
 * Ramène l'échéance d'une demande `AWAITING_HOLDER` dans le passé (`hold_until` est immuable pour l'application,
 * OP-N130). Fixture seulement : le propriétaire désactive les déclencheurs le temps de l'`UPDATE`, jamais le code.
 */
export async function backdateHold(db: Client, id: string, sql: string): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL session_replication_role = 'replica'");
    await db.query(`UPDATE refund_request SET hold_until = ${sql} WHERE id = $1`, [id]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export const wrongCode = (code: string): string => (code === '000000' ? '000001' : '000000');

export interface Holder {
  customerId: string;
  phone: string;
}

/** Festivalier du prestataire A avec numéro vérifié (`customer_identity`). */
export async function createHolder(
  db: Client,
  w: MediaWorld,
  operatorId: string = w.ops.a,
): Promise<Holder> {
  const customer = await createTestCustomer(db, operatorId);
  const phone = freshPhone();
  await db.query(
    'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
    [customer.customerId, operatorId, phone],
  );
  return { customerId: customer.customerId, phone };
}

export interface InsertedRequest {
  id: string;
  walletId: string;
}

/** Demande ouverte pour un portefeuille neuf du festivalier, conforme aux CHECK de la base. */
export async function insertRequest(
  db: Client,
  w: MediaWorld,
  holder: Holder,
  options: {
    status?: 'AWAITING_HOLDER' | 'REQUESTED';
    holdSql?: string;
    msisdn?: string;
    operatorId?: string;
    ledgerId?: string;
    eventId?: string;
  } = {},
): Promise<InsertedRequest> {
  const operatorId = options.operatorId ?? w.ops.a;
  const ledgerId = options.ledgerId ?? w.ids.ledgerA;
  const eventId = options.eventId ?? w.ids.eventA;
  const { walletId } = await createCustomerWallet(db, {
    operatorId,
    ledgerId,
    customerId: holder.customerId,
  });
  const id = randomUUID();
  const status = options.status ?? 'AWAITING_HOLDER';
  await db.query(
    `INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn,
                                 new_number, status, estimated_amount, fee, currency, hold_until)
     VALUES ($1, $2, $3, $4, $5, $6, 'WAVE', $7, true, $8, 10000, 0, 'XOF',
             ${status === 'AWAITING_HOLDER' ? (options.holdSql ?? "clock_timestamp() + interval '1 hour'") : 'NULL'})`,
    [
      id,
      operatorId,
      ledgerId,
      eventId,
      walletId,
      holder.customerId,
      options.msisdn ?? freshPhone(),
      status,
    ],
  );
  return { id, walletId };
}
