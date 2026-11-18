// Soldes restants des portefeuilles d'un événement (route 4, FR-008) : totaux par nature (payé, espèces dues, offert)
// et une ligne par portefeuille en CSV. Lecture seule ; aucune donnée personnelle (identifiants et montants).
// Grand livre `LOCKED` : plus rien à restituer, liste vide.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';
import type { EventRow } from '../events/events.dto';
import { Csv, type CsvColumn } from '../common/csv';
import { amountJson } from './closing-steps.dto';

export interface WalletBalanceRow {
  wallet_id: string;
  paid: number;
  cash_due: number;
  promo: number;
}

export interface RemainingBalancesDto {
  event_id: string;
  currency: string;
  as_of: string;
  wallet_count: number;
  paid_total: number;
  cash_due_total: number;
  promo_total: number;
}

const COLUMNS: readonly CsvColumn[] = [
  { key: 'wallet_id', header: 'wallet_id', kind: 'text' },
  { key: 'paid', header: 'paid', kind: 'number' },
  { key: 'cash_due', header: 'cash_due', kind: 'number' },
  { key: 'promo', header: 'promo', kind: 'number' },
];

@Injectable()
export class RemainingBalancesService {
  /** Portefeuilles à solde non nul de l'événement, un solde par nature (positif = dû au festivalier). */
  async wallets(
    client: TxClient,
    event: EventRow,
  ): Promise<{ currency: string; rows: WalletBalanceRow[] }> {
    const { rows: ledgers } = await client.query<{ id: string; currency: string; status: string }>(
      `SELECT id, currency, status FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`,
      [event.id],
    );
    const ledger = ledgers[0];
    if (!ledger) return { currency: String(event.currency), rows: [] };
    if (ledger.status === 'LOCKED') return { currency: ledger.currency, rows: [] };
    const { rows } = await client.query<{
      wallet_id: string;
      paid: string;
      cash_due: string;
      promo: string;
    }>(
      `SELECT a.wallet_id,
              coalesce(sum(-ab.balance) FILTER (WHERE a.purpose = 'WALLET_PAID'), 0)::text AS paid,
              coalesce(sum(-ab.balance) FILTER (WHERE a.purpose = 'CUSTOMER_CASH_DUE'), 0)::text AS cash_due,
              coalesce(sum(-ab.balance) FILTER (WHERE a.purpose = 'WALLET_PROMO'), 0)::text AS promo
         FROM account a JOIN account_balance ab ON ab.account_id = a.id
        WHERE a.ledger_id = $1 AND a.wallet_id IS NOT NULL
          AND a.purpose IN ('WALLET_PAID', 'CUSTOMER_CASH_DUE', 'WALLET_PROMO') AND ab.balance <> 0
        GROUP BY a.wallet_id ORDER BY a.wallet_id`,
      [ledger.id],
    );
    return {
      currency: ledger.currency,
      rows: rows.map((row) => ({
        wallet_id: row.wallet_id,
        paid: amountJson(BigInt(row.paid)),
        cash_due: amountJson(BigInt(row.cash_due)),
        promo: amountJson(BigInt(row.promo)),
      })),
    };
  }

  async totals(client: TxClient, event: EventRow): Promise<RemainingBalancesDto> {
    const { currency, rows } = await this.wallets(client, event);
    const sum = (key: 'paid' | 'cash_due' | 'promo') =>
      rows.reduce((total, row) => total + row[key], 0);
    return {
      event_id: event.id,
      currency,
      as_of: new Date().toISOString(),
      wallet_count: rows.length,
      paid_total: sum('paid'),
      cash_due_total: sum('cash_due'),
      promo_total: sum('promo'),
    };
  }

  async csv(client: TxClient, event: EventRow): Promise<string> {
    const { rows } = await this.wallets(client, event);
    return Csv.write(rows as unknown as Record<string, string | number>[], COLUMNS);
  }
}
