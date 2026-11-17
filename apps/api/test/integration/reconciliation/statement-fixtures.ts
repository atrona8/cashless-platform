// Jeu d'essai des relevés (mission 9b, WP09) : monde de test des bracelets (prestataires A et B, événement A en
// direct), comptes PSP, grand livre d'un second prestataire, personnes, constructeurs de transactions rapprochables
// et de fichiers CSV. Écritures directes en base : amorçage seulement (les routes écrivent par les fonctions de WP02).
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, goLive, ownerRows, type MediaWorld } from '../../support/media-fixtures';

export interface StatementWorld {
  w: MediaWorld;
  app: INestApplication;
  ledgerA: string;
  ledgerB: string;
  acct: { wave: string; om: string; carte: string; bank: string; liab: string; waveB: string };
  /** Compte de caisse (famille ASSET, finalité CASH_DESK) et compte de droits, pour les refus. */
  cashDesk: string;
  operatorAdminB: TestPerson;
  otherOrganizerAdmin: TestPerson;
}

export async function createStatementWorld(): Promise<StatementWorld> {
  const w = await createMediaWorld();
  let world!: Omit<StatementWorld, 'w' | 'app'>;
  await withOwner(async (db) => {
    await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
    await db.query('SELECT open_psp_accounts($1)', [w.ids.ledgerA]);
    // Prestataire B : organisateur, événement, grand livre, comptes PSP.
    const orgB = w.ids.organizerB;
    const profile = (
      await db.query<{ id: string }>('SELECT id FROM jurisdiction_profile ORDER BY version LIMIT 1')
    ).rows[0]!.id;
    const eventB = randomUUID();
    await db.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
       VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
      [eventB, w.ops.b, orgB, profile],
    );
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
    const ledgerB = (await db.query<{ l: string }>('SELECT open_event_ledger($1) AS l', [eventB]))
      .rows[0]!.l;
    await db.query('SELECT open_psp_accounts($1)', [ledgerB]);
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
    const code = async (ledger: string, c: string) =>
      (
        await db.query<{ id: string }>(
          'SELECT id FROM account WHERE ledger_id = $1 AND code = $2',
          [ledger, c],
        )
      ).rows[0]!.id;
    const cashDesk = randomUUID();
    await db.query(
      `INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side)
       VALUES ($1, $2, $3, 'A-CAISSE-1', 'ASSET', 'CASH_DESK', 'D')`,
      [cashDesk, w.ops.a, w.ids.ledgerA],
    );
    const otherOrg = randomUUID();
    await db.query(
      "INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Autre organisateur', 'SN')",
      [otherOrg, w.ops.a],
    );
    world = {
      ledgerA: w.ids.ledgerA,
      ledgerB,
      acct: {
        wave: await code(w.ids.ledgerA, 'A-PSP-WAVE'),
        om: await code(w.ids.ledgerA, 'A-PSP-OM'),
        carte: await code(w.ids.ledgerA, 'A-PSP-CARTE'),
        bank: await code(w.ids.ledgerA, 'A-BANQUE'),
        liab: await code(w.ids.ledgerA, 'L-ORG-COM'),
        waveB: await code(ledgerB, 'A-PSP-WAVE'),
      },
      cashDesk,
      operatorAdminB: await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      }),
      otherOrganizerAdmin: await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: otherOrg }],
      }),
    };
  });
  const app = await createTestApp({ identity: w.idp });
  return { w, app, ...world };
}

/** Transaction à deux lignes : `account` débité de `amount`, `L-ORG-COM` crédité. Rend l'identifiant. */
export async function makeTx(
  db: Client,
  s: StatementWorld,
  account: string,
  amount: number,
  at = '2026-01-10 12:00+00',
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at,
                                      source, created_by, approved_by)
     VALUES ($1, $2, $3, 'ADJUSTMENT', $4, 'h', $5, 'BACKOFFICE', $6, $7)`,
    [id, s.w.ops.a, s.ledgerA, randomUUID(), at, s.w.operatorAdminA.userId, randomUUID()],
  );
  await db.query(
    `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
     VALUES ($1, $2, $3, 1, $4, $5), ($1, $2, $3, 2, $6, $7)`,
    [s.w.ops.a, s.ledgerA, id, account, amount, s.acct.liab, -amount],
  );
  return id;
}

/** Recharge PSP réussie de référence `ref`, rattachée à `tx` (les clés étrangères sont levées le temps de l'amorçage). */
export async function makePspTopup(
  db: Client,
  s: StatementWorld,
  ref: string,
  tx: string,
  amount = 1000,
): Promise<string> {
  const id = randomUUID();
  await db.query('SET session_replication_role = replica');
  await db.query(
    `INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id, method,
        provider, amount, currency, fee_amount, status, provider_payment_ref, expires_at, requested_by_kind,
        customer_id, topup_tx_id, succeeded_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'WAVE', 'WAVE', $7, 'XOF', 0, 'SUCCEEDED', $8, now() + interval '1 day',
             'CUSTOMER', $9, $10, now())`,
    [
      id,
      s.w.ops.a,
      s.ledgerA,
      s.w.ids.eventA,
      s.w.ids.walletA,
      randomUUID(),
      amount,
      ref,
      randomUUID(),
      tx,
    ],
  );
  await db.query('RESET session_replication_role');
  return id;
}

export async function makeAnomaly(
  db: Client,
  s: StatementWorld,
  kind: string,
  ledger = s.ledgerA,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, status)
     VALUES ($1, $2, $3, $4, 1000, 'OPEN')`,
    [id, ledger === s.ledgerA ? s.w.ops.a : s.w.ops.b, ledger, kind],
  );
  return id;
}

/** Contestation PSP de référence `dispute` sur `topup`, rattachée à `tx`. */
export async function makeChargeback(
  db: Client,
  s: StatementWorld,
  dispute: string,
  topup: string,
  tx: string,
  amount = 300,
): Promise<void> {
  await db.query('SET session_replication_role = replica');
  await db.query(
    `INSERT INTO psp_chargeback (operator_id, psp_configuration_id, provider_dispute_id, psp_topup_id, amount,
                                 chargeback_tx_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.w.ops.a, randomUUID(), dispute, topup, amount, tx],
  );
  await db.query('RESET session_replication_role');
}

/** Demande de remboursement de référence externe `ref`, rattachée à `tx`. */
export async function makeRefund(db: Client, s: StatementWorld, ref: string, tx: string) {
  await db.query('SET session_replication_role = replica');
  await db.query(
    `INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn, new_number, status,
                                 estimated_amount, fee, currency, transaction_id, approved_by, external_reference)
     VALUES ($1, $2, $3, $4, 'WAVE', '+221770000001', false, 'PROCESSING', 200, 0, 'XOF', $5, $6, $7)`,
    [s.w.ops.a, s.ledgerA, s.w.ids.eventA, s.w.ids.walletA, tx, randomUUID(), ref],
  );
  await db.query('RESET session_replication_role');
}

/** Versement confirmé de référence externe `ref`, réglé par `tx`. */
export async function makePayout(db: Client, s: StatementWorld, ref: string, tx: string) {
  await db.query('SET session_replication_role = replica');
  await db.query(
    `INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, external_ref, initiated_by,
                         approved_by, initiated_tx_id, settled_tx_id, settled_at, confirmed_by, confirmed_at, msisdn)
     VALUES ($1, $2, $3, 500, 'WAVE', 'CONFIRMED', $4, $5, $6, $7, $7, now(), $6, now(), '+221770000010')`,
    [s.w.ops.a, s.ledgerA, s.w.ids.organizerA, ref, randomUUID(), randomUUID(), tx],
  );
  await db.query('RESET session_replication_role');
}

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Fichier CSV du format des relevés (séparateur `;`). */
export const csvFile = (rows: Array<[string, string, number | string, string?]>, header = true) =>
  `${header ? 'external_ref;value_date;amount;currency\r\n' : ''}${rows
    .map(([ref, date, amount, cur]) => `${ref};${date};${amount};${cur ?? 'XOF'}`)
    .join('\r\n')}\r\n`;

export interface ImportOptions {
  ledger?: string;
  account?: string;
  source?: string;
  date?: string;
  closing?: number | string;
  key?: string;
  contentType?: string;
}

export function importStatement(
  s: StatementWorld,
  who: TestPerson | null,
  body: string,
  o: ImportOptions = {},
) {
  const query = new URLSearchParams({
    source: o.source ?? 'wave',
    statement_date: o.date ?? '2026-01-31',
    closing_balance: String(o.closing ?? 0),
  });
  const req = request(s.app.getHttpServer())
    .post(
      `/v1/ledgers/${o.ledger ?? s.ledgerA}/accounts/${o.account ?? s.acct.wave}/statements?${query}`,
    )
    .set('Idempotency-Key', o.key ?? randomUUID())
    .set('Content-Type', o.contentType ?? 'text/csv');
  return (who ? req.set('Authorization', `Bearer ${who.token}`) : req).send(body);
}

export const lineRows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  ownerRows<T>(sql, params);
