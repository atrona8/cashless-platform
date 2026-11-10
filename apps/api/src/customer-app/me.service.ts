// Lectures de l'app festivalier (`getMe`, `listMyWallets`, `listMyWalletTransactions`, `listMyMedia`), servies avant
// la mission 10a à la demande du porteur (10/11/2026) pour l'équipe de l'app. Tout est lu sous la RLS du prestataire
// du compte (`TenantTx`) et filtré sur le compte : un festivalier ne voit jamais le portefeuille d'un autre.
//
// Limites connues jusqu'à la mission 10a (comptes par numéro) et la mission 9 (remboursements) :
//   - `phone` : aucun numéro vérifié n'est encore gardé pour un festivalier ; chaîne vide ;
//   - `refund.eligible` : toujours faux (aucun remboursement servi) ; `deadline` = `event.refund_deadline` ;
//   - `pending_offline_notice` : absent (facultatif au contrat).
import { Injectable } from '@nestjs/common';
import type { CustomerContext } from '../customer-identity/customer-identity.port';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

export const KYC_VERIFIED_SQL = `EXISTS (
  SELECT 1 FROM kyc_verification k
   WHERE k.status = 'VERIFIED' AND (k.id_expires_on IS NULL OR k.id_expires_on >= current_date)
     AND (k.customer_id = $1 OR k.wallet_id = w.id))`;

export interface CustomerMediaDto {
  media_id: string;
  printed_number: string | null;
  status: string;
  deposit_status: string;
  wallet_id: string | null;
}

export interface MovementCursor {
  /** `occurred_at` de la dernière ligne rendue (ISO, microsecondes perdues : départagé par `i`). */
  t: string;
  /** Identifiant de la dernière transaction rendue. */
  i: string;
}

/** Libellé lisible d'un mouvement : nom du commerçant pour une vente, sinon le type en clair. */
const TYPE_LABELS: Record<string, string> = {
  TOPUP: 'Recharge en ligne',
  TOPUP_CASH: 'Recharge en espèces',
  PROMO_CREDIT: 'Crédit offert',
  PROMO_EXPIRY: 'Expiration du crédit offert',
  ACTIVATION_FEE: 'Frais d’activation',
  DEPOSIT_TAKEN: 'Caution',
  DEPOSIT_REFUNDED: 'Caution rendue',
  DEPOSIT_FORFEITED: 'Caution retenue',
  PURCHASE: 'Achat',
  REVERSAL: 'Annulation',
  CHARGEBACK: 'Contestation de paiement',
  WALLET_REFUND: 'Remboursement',
  BREAKAGE: 'Solde non réclamé',
  BREAKAGE_REVERSAL: 'Solde non réclamé rétabli',
  ADJUSTMENT: 'Ajustement',
  ANOMALY_RESOLUTION: 'Régularisation',
};

@Injectable()
export class MeService {
  constructor(private readonly tx: TenantTx) {}

  private run<T>(customer: CustomerContext, fn: (client: TxClient) => Promise<T>): Promise<T> {
    return this.tx.run(customer.operatorId, fn);
  }

  profile(customer: CustomerContext) {
    return this.run(customer, async (client) => {
      const { rows } = await client.query<{ name: string | null; verified: boolean }>(
        `SELECT p.legal_name AS name,
                EXISTS (SELECT 1 FROM kyc_verification k
                         WHERE k.customer_id = p.id AND k.status = 'VERIFIED'
                           AND (k.id_expires_on IS NULL OR k.id_expires_on >= current_date)) AS verified
           FROM party p WHERE p.id = $1 AND p.kind = 'CUSTOMER'`,
        [customer.customerId],
      );
      const row = rows[0];
      if (!row) throw new ProblemException('UNAUTHENTICATED');
      return {
        customer_id: customer.customerId,
        phone: '',
        display_name: row.name,
        kyc_level: row.verified ? 'VERIFIED' : 'NONE',
      };
    });
  }

  wallets(customer: CustomerContext) {
    return this.run(customer, async (client) => {
      const { rows } = await client.query<{
        wallet_id: string;
        status: string;
        currency: string;
        event_id: string;
        event_name: string;
        event_status: string;
        refund_deadline: Date | null;
        paid: string;
        promo: string;
        verified: boolean;
        as_of: Date;
      }>(
        `SELECT w.id AS wallet_id, w.status, l.currency, e.id AS event_id, e.name AS event_name,
                e.status::text AS event_status, e.refund_deadline,
                coalesce((SELECT -sum(b.balance) FROM account a JOIN account_balance b ON b.account_id = a.id
                           WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID'), 0)::text AS paid,
                coalesce((SELECT -sum(b.balance) FROM account a JOIN account_balance b ON b.account_id = a.id
                           WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PROMO'), 0)::text AS promo,
                ${KYC_VERIFIED_SQL} AS verified,
                clock_timestamp() AS as_of
           FROM wallet w
           JOIN ledger l ON l.id = w.ledger_id
           JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
          WHERE w.customer_id = $1
          ORDER BY e.name, w.id`,
        [customer.customerId],
      );
      const media = await this.mediaRows(client, customer);
      return {
        data: rows.map((w) => {
          const paid = Number(w.paid);
          const promo = Number(w.promo);
          return {
            wallet_id: w.wallet_id,
            status: w.status,
            kyc_level: w.verified ? 'VERIFIED' : 'NONE',
            currency: w.currency.trim(),
            event: { event_id: w.event_id, name: w.event_name, status: w.event_status },
            balance: { spendable: paid + promo, paid, promo },
            balance_as_of: w.as_of.toISOString(),
            media: media.filter((m) => m.wallet_id === w.wallet_id),
            refund: {
              eligible: false,
              deadline: w.refund_deadline ? w.refund_deadline.toISOString() : null,
            },
          };
        }),
      };
    });
  }

  media(customer: CustomerContext) {
    return this.run(customer, async (client) => ({ data: await this.mediaRows(client, customer) }));
  }

  /** Bracelets rattachés aujourd'hui à un portefeuille du compte (rattachement non libéré). */
  private async mediaRows(
    client: TxClient,
    customer: CustomerContext,
  ): Promise<CustomerMediaDto[]> {
    const { rows } = await client.query<{
      media_id: string;
      status: string;
      deposit_status: string;
      wallet_id: string;
    }>(
      `SELECT m.id AS media_id, m.status::text, m.deposit_status::text, w.id AS wallet_id
         FROM media_assignment ma
         JOIN wallet w ON w.id = ma.wallet_id
         JOIN media m ON m.id = ma.media_id
        WHERE w.customer_id = $1 AND ma.released_at IS NULL
        ORDER BY ma.assigned_at, m.id`,
      [customer.customerId],
    );
    return rows.map((r) => ({ ...r, printed_number: null }));
  }

  transactions(
    customer: CustomerContext,
    walletId: string,
    page: { limit: number; after: MovementCursor | null },
  ) {
    return this.run(customer, async (client) => {
      const owned = await client.query<{ currency: string }>(
        `SELECT l.currency FROM wallet w JOIN ledger l ON l.id = w.ledger_id
          WHERE w.id = $1 AND w.customer_id = $2`,
        [walletId, customer.customerId],
      );
      // Portefeuille d'un autre compte ou inconnu : même réponse (aucun oracle d'existence).
      if (owned.rowCount !== 1) throw new ProblemException('NOT_FOUND');
      const currency = owned.rows[0]!.currency.trim();
      const { rows } = await client.query<{
        transaction_id: string;
        type: string;
        source: string;
        occurred_at: Date;
        amount: string;
        reverses_id: string | null;
        reversed_by_id: string | null;
        merchant: string | null;
      }>(
        `SELECT t.id AS transaction_id, t.type::text, t.source::text, t.occurred_at,
                (-sum(p.amount))::text AS amount, t.reverses_id,
                (SELECT r.id FROM journal_transaction r WHERE r.reverses_id = t.id
                  ORDER BY r.occurred_at LIMIT 1) AS reversed_by_id,
                (SELECT mp.legal_name FROM posting q JOIN account qa ON qa.id = q.account_id
                   JOIN merchant_participation pa ON pa.id = qa.participation_id
                   JOIN party mp ON mp.id = pa.merchant_id
                  WHERE q.transaction_id = t.id LIMIT 1) AS merchant
           FROM posting p
           JOIN account a ON a.id = p.account_id
           JOIN journal_transaction t ON t.id = p.transaction_id
          WHERE a.wallet_id = $1 AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
            AND ($2::timestamptz IS NULL OR (t.occurred_at, t.id) < ($2::timestamptz, $3::uuid))
          GROUP BY t.id
          HAVING sum(p.amount) <> 0
          ORDER BY t.occurred_at DESC, t.id DESC
          LIMIT $4`,
        [walletId, page.after?.t ?? null, page.after?.i ?? null, page.limit + 1],
      );
      const hasMore = rows.length > page.limit;
      const data = rows.slice(0, page.limit).map((r) => ({
        transaction_id: r.transaction_id,
        type: r.type,
        source: r.source,
        occurred_at: r.occurred_at.toISOString(),
        amount: Number(r.amount),
        currency,
        label:
          (r.type === 'PURCHASE' || r.type === 'REVERSAL') && r.merchant
            ? r.merchant
            : (TYPE_LABELS[r.type] ?? r.type),
        reverses_id: r.reverses_id,
        reversed_by_id: r.reversed_by_id,
      }));
      const last = rows[page.limit - 1];
      return {
        data,
        next_cursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({ t: last.occurred_at.toISOString(), i: last.transaction_id }),
              ).toString('base64url')
            : null,
        has_more: hasMore,
      };
    });
  }
}
