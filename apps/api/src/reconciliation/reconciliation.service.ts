// Route 13 : état du rapprochement par compte d'argent (mission 9b, WP09 ; FR-015). Une seule requête sur
// `account_reconciliation` : lecture cohérente, jamais un import à moitié écrit. Le calcul est en base (WP02).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';
import type { TenantActor } from '../organization/tenant/tenant-access';
import type { AccountReconciliation } from './statements.dto';
import { loadLedger } from './statements.service';

interface ReconciliationRow {
  account_id: string;
  lines: string;
  unmatched_lines: string;
  statement_closing_balance: string | null;
  statement_date: string | null;
  ledger_balance: string;
  reconciled: boolean;
}

@Injectable()
export class ReconciliationService {
  async state(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
  ): Promise<{ data: AccountReconciliation[] }> {
    const ledger = await loadLedger(client, actor, ledgerId, 'read');
    const { rows } = await client.query<ReconciliationRow>(
      `SELECT account_id, lines::text, unmatched_lines::text, statement_closing_balance::text,
              statement_date::text, ledger_balance::text, reconciled
         FROM account_reconciliation($1::uuid)`,
      [ledger.id],
    );
    return {
      data: rows.map((row) => ({
        account_id: row.account_id,
        currency: ledger.currency as AccountReconciliation['currency'],
        lines_total: Number(row.lines),
        lines_unmatched: Number(row.unmatched_lines),
        statement_date: row.statement_date,
        statement_balance:
          row.statement_closing_balance === null ? null : Number(row.statement_closing_balance),
        ledger_balance: Number(row.ledger_balance),
        reconciled: row.reconciled,
      })),
    };
  }
}
