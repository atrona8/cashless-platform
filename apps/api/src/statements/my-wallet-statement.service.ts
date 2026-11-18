// Relevé CSV du portefeuille d'un festivalier (route 17, FR-022) : un mouvement par transaction qui touche ses
// comptes « payé » ou « offert », montant signé (crédit positif) et solde courant. Lecture seule, sous la RLS du
// prestataire du compte, filtrée sur le compte : un portefeuille d'une autre personne ou inconnu répond `404`.
import { Injectable } from '@nestjs/common';
import { Csv, type CsvColumn } from '../common/csv';
import { amountJson } from '../closing/closing-steps.dto';
import type { CustomerContext } from '../customer-identity/customer-identity.port';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { WALLET_TYPE_LABELS } from './statement-categories';

const COLUMNS: readonly CsvColumn[] = [
  { key: 'occurred_at', header: 'occurred_at', kind: 'text' },
  { key: 'type', header: 'type', kind: 'text' },
  { key: 'label', header: 'label', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'balance', header: 'balance', kind: 'number' },
];

@Injectable()
export class MyWalletStatementService {
  constructor(private readonly tx: TenantTx) {}

  csv(customer: CustomerContext, walletId: string): Promise<string> {
    return this.tx.run(customer.operatorId, async (client) => {
      const owned = await client.query(
        `SELECT 1 FROM wallet w WHERE w.id = $1 AND w.customer_id = $2`,
        [walletId, customer.customerId],
      );
      // Portefeuille d'un autre compte ou inconnu : même réponse (aucun oracle d'existence).
      if (owned.rowCount !== 1) throw new ProblemException('NOT_FOUND');
      const { rows } = await client.query<{
        type: string;
        occurred_at: Date;
        amount: string;
        merchant: string | null;
      }>(
        `SELECT t.type::text, t.occurred_at, (-sum(p.amount))::text AS amount,
                (SELECT min(mp.legal_name) FROM posting q
                   JOIN account qa ON qa.id = q.account_id
                   JOIN merchant_participation pa ON pa.id = qa.participation_id
                   JOIN party mp ON mp.id = pa.merchant_id
                  WHERE q.transaction_id = t.id
                 HAVING count(DISTINCT pa.merchant_id) = 1) AS merchant
           FROM posting p
           JOIN account a ON a.id = p.account_id
           JOIN journal_transaction t ON t.id = p.transaction_id
          WHERE a.wallet_id = $1 AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
          GROUP BY t.id
         HAVING sum(p.amount) <> 0
          ORDER BY t.occurred_at, t.id`,
        [walletId],
      );
      let balance = 0n;
      return Csv.write(
        rows.map((row) => {
          balance += BigInt(row.amount);
          return {
            occurred_at: row.occurred_at.toISOString(),
            type: row.type,
            label:
              (row.type === 'PURCHASE' || row.type === 'REVERSAL') && row.merchant
                ? row.merchant
                : (WALLET_TYPE_LABELS[row.type] ?? row.type),
            amount: amountJson(BigInt(row.amount)),
            balance: amountJson(balance),
          };
        }),
        COLUMNS,
      );
    });
  }
}
