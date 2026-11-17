// Export comptable d'une entité sur une période (route 19, FR-023, C-007). Format (CSV, une ligne par écriture) :
//   ligne,date,transaction_id,transaction_type,purpose,sens,debit_account,credit_account,amount,currency
// - `ECRITURE` : une écriture (`posting`) sur un compte de l'entité, avec les comptes légaux de la version de
//   correspondance en vigueur à la date de l'écriture (`valid_from` <= instant de l'écriture, version la plus haute).
//   `amount` est la valeur absolue de l'écriture, `sens` son côté (`D` débit, `C` crédit) sur le compte de l'application.
//   Un couple (purpose, type) sans correspondance garde sa ligne `ECRITURE` avec des comptes légaux vides : rien n'est
//   omis en silence.
// - `NON_MAPPE` : EN TÊTE du fichier, une ligne par couple sans correspondance (`transaction_type`, `purpose`, `amount`
//   = total des valeurs absolues, `date` et `transaction_id` vides). Le nombre de ces lignes est l'en-tête
//   `X-Unmapped-Count`.
// Comptes de l'entité : ceux qu'elle possède (`owner_party_id`), plus, pour le titulaire des fonds du grand livre,
// les comptes sans titulaire (portefeuilles, commerçants, versements en cours). Aucun jeu de comptes légaux n'est livré.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { Csv, type CsvColumn } from '../common/csv';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { amountJson } from '../closing/closing-steps.dto';

const COLUMNS: readonly CsvColumn[] = [
  { key: 'ligne', header: 'ligne', kind: 'text' },
  { key: 'date', header: 'date', kind: 'text' },
  { key: 'transaction_id', header: 'transaction_id', kind: 'text' },
  { key: 'transaction_type', header: 'transaction_type', kind: 'text' },
  { key: 'purpose', header: 'purpose', kind: 'text' },
  { key: 'sens', header: 'sens', kind: 'text' },
  { key: 'debit_account', header: 'debit_account', kind: 'text' },
  { key: 'credit_account', header: 'credit_account', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'currency', header: 'currency', kind: 'text' },
];

interface EntryRow {
  transaction_id: string;
  day: string;
  type: string;
  purpose: string;
  amount: string;
  sens: string;
  currency: string;
  mapped: boolean;
  debit_account: string | null;
  credit_account: string | null;
}

export interface AccountingExport {
  text: string;
  unmapped: number;
  lines: number;
}

@Injectable()
export class AccountingExportService {
  constructor(private readonly audit: AuditService) {}

  /** L'entité est un organisateur ou le prestataire du chemin (RLS) ; autre : `404`. */
  async assertEntity(client: TxClient, operatorId: string, entity: string): Promise<void> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM party WHERE id = $1 AND kind IN ('ORGANIZER', 'OPERATOR')
          AND (id = $2 OR operator_id = $2)`,
      [entity, operatorId],
    );
    if (rowCount !== 1) throw new ProblemException('NOT_FOUND');
  }

  async build(
    client: TxClient,
    operatorId: string,
    entity: string,
    from: string,
    to: string,
  ): Promise<AccountingExport> {
    await this.assertEntity(client, operatorId, entity);
    const { rows } = await client.query<EntryRow>(
      `SELECT t.id AS transaction_id, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              t.type::text AS type, a.purpose, abs(p.amount)::text AS amount,
              CASE WHEN p.amount > 0 THEN 'D' ELSE 'C' END AS sens, l.currency::text AS currency,
              (m.debit_account IS NOT NULL) AS mapped, m.debit_account, m.credit_account
         FROM posting p
         JOIN account a ON a.id = p.account_id
         JOIN ledger l ON l.id = p.ledger_id
         JOIN journal_transaction t ON t.id = p.transaction_id AND t.ledger_id = p.ledger_id
         LEFT JOIN LATERAL (
           SELECT max(v.version) AS version FROM account_mapping v
            WHERE v.operator_id = $1 AND v.entity_party_id = $2 AND v.valid_from <= t.occurred_at
         ) ver ON true
         LEFT JOIN LATERAL (
           SELECT x.debit_account, x.credit_account FROM account_mapping x
            WHERE x.operator_id = $1 AND x.entity_party_id = $2 AND x.version = ver.version
              AND x.purpose = a.purpose AND (x.transaction_type = t.type OR x.transaction_type IS NULL)
            ORDER BY (x.transaction_type IS NULL) LIMIT 1
         ) m ON true
        WHERE (a.owner_party_id = $2 OR (a.owner_party_id IS NULL AND l.funds_holder_id = $2))
          AND t.occurred_at >= ($3::date)::timestamp AT TIME ZONE 'UTC'
          AND t.occurred_at < (($4::date) + 1)::timestamp AT TIME ZONE 'UTC'
        ORDER BY t.occurred_at, p.id`,
      [operatorId, entity, from, to],
    );
    const unmapped = new Map<
      string,
      { type: string; purpose: string; total: bigint; currency: string }
    >();
    for (const row of rows) {
      if (row.mapped) continue;
      const key = `${row.purpose}|${row.type}`;
      const hit = unmapped.get(key) ?? {
        type: row.type,
        purpose: row.purpose,
        total: 0n,
        currency: row.currency.trim(),
      };
      hit.total += BigInt(row.amount);
      unmapped.set(key, hit);
    }
    const head = [...unmapped.values()]
      .sort((a, b) => `${a.purpose}|${a.type}`.localeCompare(`${b.purpose}|${b.type}`))
      .map((u) => ({
        ligne: 'NON_MAPPE',
        transaction_type: u.type,
        purpose: u.purpose,
        amount: amountJson(u.total),
        currency: u.currency,
      }));
    const entries = rows.map((row) => ({
      ligne: 'ECRITURE',
      date: row.day,
      transaction_id: row.transaction_id,
      transaction_type: row.type,
      purpose: row.purpose,
      sens: row.sens,
      debit_account: row.debit_account,
      credit_account: row.credit_account,
      amount: amountJson(BigInt(row.amount)),
      currency: row.currency.trim(),
    }));
    return {
      text: Csv.write([...head, ...entries], COLUMNS),
      unmapped: head.length,
      lines: entries.length,
    };
  }

  recordExport(
    client: TxClient,
    audit: AuditContext,
    operatorId: string,
    entity: string,
    period: { from: string; to: string },
    result: Pick<AccountingExport, 'lines' | 'unmapped'>,
  ): Promise<void> {
    return this.audit.record(client, {
      ...audit,
      operatorId,
      action: 'ACCOUNTING_EXPORTED',
      objectType: 'party',
      objectId: entity,
      after: { ...period, lines: result.lines, unmapped: result.unmapped },
    });
  }
}
