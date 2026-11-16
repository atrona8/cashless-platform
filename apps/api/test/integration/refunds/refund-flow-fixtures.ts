// Aides des tests de WP05 (approbation à deux, confirmation, concurrence) : demandes `REQUESTED` financées,
// personnes du back-office, appels HTTP, lectures du grand livre.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { createRefundWorld, fundedCustomer, type RefundWorld } from './create-fixtures';

export { createRefundWorld, type RefundWorld };

export interface Staff {
  adminA: TestPerson;
  adminB: TestPerson;
  adminC: TestPerson;
  orgAdmin: TestPerson;
}

/** Trois `OPERATOR_ADMIN` du prestataire A (auteur, valideur, tiers) et l'`ORGANIZER_ADMIN` de l'événement A. */
export async function createStaff(w: MediaWorld): Promise<Staff> {
  return withOwner(async (db) => {
    const operatorAdmin = () =>
      w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.a }],
      });
    return {
      adminA: w.operatorAdminA,
      adminB: await operatorAdmin(),
      adminC: await operatorAdmin(),
      orgAdmin: w.organizerAdminA,
    };
  });
}

export interface OpenRequest {
  id: string;
  walletId: string;
}

/** Demande `REQUESTED` (canal Wave) sur un portefeuille crédité de `funds` ; `extra` pose le contrôle renforcé. */
export async function openRequest(
  w: MediaWorld,
  options: { funds?: number; extra?: boolean; method?: string; psp?: boolean } = {},
): Promise<OpenRequest> {
  // Comptes A-PSP-* du grand livre (ouverts à la sélection du PSP en production ; idempotent).
  if (options.psp !== false)
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query('SELECT open_psp_accounts($1)', [w.ids.ledgerA]);
    });
  const funded = await fundedCustomer(w, options.funds ?? 25_000);
  const id = randomUUID();
  await withOwner((db) =>
    db.query(
      `INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn,
                                   new_number, status, estimated_amount, fee, currency, extra_check_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '+221770000099', $8, 'REQUESTED', 24500, 500, 'XOF', $8)`,
      [
        id,
        w.ops.a,
        w.ids.ledgerA,
        w.ids.eventA,
        funded.walletId,
        funded.customer.customerId,
        options.method ?? 'WAVE',
        options.extra === true,
      ],
    ),
  );
  return { id, walletId: funded.walletId };
}

export const call = (
  app: INestApplication,
  who: TestPerson | null,
  path: string,
  body: unknown = {},
  key: string = randomUUID(),
) => {
  const req = request(app.getHttpServer()).post(`/v1${path}`).set('Idempotency-Key', key);
  return (who ? req.set('Authorization', `Bearer ${who.token}`) : req).send(body as object);
};

export const proposeApproval = (r: RefundWorld, who: TestPerson, id: string, body: unknown = {}) =>
  call(r.app, who, `/refund-requests/${id}/approve`, body);

export const executeApproval = (r: RefundWorld, who: TestPerson, approvalId: string) =>
  call(r.app, who, `/approval-requests/${approvalId}/approve`, {});

export const confirm = (r: RefundWorld, who: TestPerson, id: string, body: unknown, key?: string) =>
  call(r.app, who, `/refund-requests/${id}/confirm`, body, key);

/** Demande proposée par `author`, puis exécutée par `validator` : renvoie la réponse de l'exécution. */
export async function proposeAndExecute(
  r: RefundWorld,
  author: TestPerson,
  validator: TestPerson,
  id: string,
  body: unknown = {},
) {
  const proposed = await proposeApproval(r, author, id, body);
  if (proposed.status !== 202) throw new Error(`proposition : ${proposed.status}`);
  return executeApproval(r, validator, proposed.body.approval_request_id as string);
}

export const requestState = async (id: string) =>
  (
    await rows<{
      status: string;
      transaction_id: string | null;
      reversal_transaction_id: string | null;
      approved_by: string | null;
      external_reference: string | null;
      failure_reason: string | null;
      confirmed_by: string | null;
    }>(
      `SELECT status, transaction_id, reversal_transaction_id, approved_by, external_reference,
              failure_reason, confirmed_by FROM refund_request WHERE id = $1`,
      [id],
    )
  )[0]!;

export const journalCount = async (ledgerId: string) =>
  (
    await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1',
      [ledgerId],
    )
  )[0]!.n;

export const countOfType = async (ledgerId: string, type: string) =>
  (
    await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND type = $2',
      [ledgerId, type],
    )
  )[0]!.n;

/** Solde payé du portefeuille (positif = dû au festivalier). */
export const paidBalance = async (walletId: string) =>
  Number(
    (
      await rows<{ p: string }>(
        `SELECT coalesce(-sum(b.balance), 0)::text AS p FROM account a
           JOIN account_balance b ON b.account_id = a.id
          WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'`,
        [walletId],
      )
    )[0]!.p,
  );

/** Somme des lignes de chaque transaction du grand livre : doit être nulle partout. */
export const unbalanced = async (ledgerId: string) =>
  (
    await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT t.id FROM journal_transaction t JOIN posting l ON l.transaction_id = t.id
          WHERE t.ledger_id = $1 GROUP BY t.id HAVING sum(l.amount) <> 0) x`,
      [ledgerId],
    )
  )[0]!.n;

export const setAuthority = (ledgerId: string, value: 'EDGE' | 'CENTRAL') =>
  withOwner((db) =>
    db.query(`UPDATE ledger SET debit_authority = $2 WHERE id = $1`, [ledgerId, value]),
  );
