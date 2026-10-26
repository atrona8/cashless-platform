// Lecture d'une vente (mission 5b, lot WP11, T053 ; FR-025, NFR-007 ; contracts/payments.md,
// « GET /payments/{transaction_id} ») : sert `getPayment` et assemble le `PaymentResult` de `createPayment`
// (même forme, même requête : vendeur d'après `sale_attribution`, lignes copiées de `sale_line`, canal).
//
// Périmètre de `getPayment` (garde exclusive de WP08, A13) :
//   - terminal : SES ventes seulement (`journal_transaction.device_id` = le terminal) ;
//   - personne : `OPERATOR_ADMIN` du prestataire, `ORGANIZER_ADMIN` de l'organisateur de l'événement,
//     `SUPERVISOR` de l'événement (ou de son organisateur), `MERCHANT_ADMIN` du commerçant de la participation ;
//   - hors périmètre, autre prestataire (RLS), vente inexistante, type autre que `PURCHASE` : `404`, le même.
//
// `balance_after` (requis par le schéma) : solde du portefeuille APRÈS cette écriture, relu des écritures du
// portefeuille jusqu'à la dernière ligne de la vente (ordre des écritures), donc stable quand la vente est
// consultée plus tard. Annulation éventuelle (FR-025) : suit le contrat de WP01 (aucun champ ajouté ici) ;
// l'annulation d'une vente est un `PaymentResult` distinct, rendu par WP12.
import { Injectable } from '@nestjs/common';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Language } from '../http/language';
import { exercisedRole, type ScopeLink } from '../identity/scope-resolver';
import type { Principal, Role } from '../identity/principal';
import type { PaymentResult } from './payments.dto';

interface SaleRow {
  transaction_id: string;
  type: string;
  idempotency_key: string;
  occurred_at: Date;
  recorded_at: Date;
  media_id: string | null;
  device_id: string | null;
  event_id: string | null;
  organizer_id: string | null;
  operator_id: string;
  currency: string;
  channel: 'NFC' | 'MERCHANT_QR' | 'CUSTOMER_QR' | null;
  vendor_id: string | null;
  vendor_name: string | null;
  wallet_id: string | null;
  amount: string;
  merchant_id: string | null;
  paid: string;
  promo: string;
  lines: Array<{
    product_id: string;
    label: string;
    quantity: number;
    unit_price: string;
    vat_rate_bps: number;
    line_total: string;
    catalog_version: number;
  }>;
}

const READ_SALE = `
WITH h AS (
  SELECT t.id, t.type, t.idempotency_key, t.occurred_at, t.recorded_at, t.media_id, t.device_id,
         t.event_id, t.operator_id, l.currency, ev.organizer_id, sa.channel, sa.vendor_id,
         (SELECT v.display_name FROM vendor_public v WHERE v.id = sa.vendor_id) AS vendor_name,
         (SELECT a.wallet_id FROM posting p JOIN account a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')
           LIMIT 1) AS wallet_id,
         (SELECT coalesce(sum(p.amount), 0) FROM posting p JOIN account a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND p.amount > 0
             AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) AS amount,
         (SELECT max(p.id) FROM posting p WHERE p.transaction_id = t.id) AS last_posting,
         (SELECT a.participation_id FROM posting p JOIN account a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND a.purpose = 'MERCHANT' LIMIT 1) AS participation_id
    FROM journal_transaction t
    JOIN ledger l ON l.id = t.ledger_id
    LEFT JOIN event ev ON ev.id = t.event_id
    LEFT JOIN sale_attribution sa ON sa.transaction_id = t.id
   WHERE t.id = $1 AND t.type = 'PURCHASE' AND ($2::uuid IS NULL OR t.device_id = $2)
)
SELECT h.id AS transaction_id, h.type, h.idempotency_key, h.occurred_at, h.recorded_at, h.media_id,
       h.device_id, h.event_id, h.organizer_id, h.operator_id, h.currency, h.channel, h.vendor_id,
       h.vendor_name, h.wallet_id, h.amount::text AS amount,
       (SELECT mp.merchant_id FROM merchant_participation mp WHERE mp.id = h.participation_id)
         AS merchant_id,
       (SELECT coalesce(-sum(p.amount), 0)::text FROM posting p JOIN account a ON a.id = p.account_id
         WHERE a.wallet_id = h.wallet_id AND a.purpose = 'WALLET_PAID' AND p.id <= h.last_posting)
         AS paid,
       (SELECT coalesce(-sum(p.amount), 0)::text FROM posting p JOIN account a ON a.id = p.account_id
         WHERE a.wallet_id = h.wallet_id AND a.purpose = 'WALLET_PROMO' AND p.id <= h.last_posting)
         AS promo,
       coalesce((SELECT json_agg(json_build_object(
                   'product_id', s.item_id,
                   'label', CASE WHEN $3 = 'en' THEN s.label_en ELSE s.label_fr END,
                   'quantity', s.quantity, 'unit_price', s.unit_price::text,
                   'vat_rate_bps', s.vat_rate_bps, 'line_total', s.line_total::text,
                   'catalog_version', s.catalog_version) ORDER BY s.line_no)
                  FROM sale_line s WHERE s.transaction_id = h.id), '[]'::json) AS lines
  FROM h`;

/** Rôles qui lisent une vente, sur la portée de l'événement, de son organisateur, du prestataire, du commerçant. */
const READ_ROLES: readonly Role[] = [
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'SUPERVISOR',
  'MERCHANT_ADMIN',
];

@Injectable()
export class PaymentReadService {
  constructor(private readonly tx: TenantTx) {}

  /**
   * `PaymentResult` d'une vente PURCHASE dans la transaction de l'appelant ; `deviceId` restreint aux ventes de ce
   * terminal. `null` : introuvable ou hors de la restriction.
   */
  async read(
    client: TxClient,
    input: { transactionId: string; language: Language; deviceId?: string },
  ): Promise<PaymentResult | null> {
    const row = await this.row(client, input);
    return row ? toResult(row) : null;
  }

  /** `getPayment` d'un terminal : ses propres ventes. */
  getForDevice(
    device: { deviceId: string; operatorId: string },
    transactionId: string,
    language: Language,
  ): Promise<PaymentResult> {
    return this.tx.run(device.operatorId, async (client) => {
      const result = await this.read(client, {
        transactionId,
        language,
        deviceId: device.deviceId,
      });
      if (!result) throw new ProblemException('NOT_FOUND');
      return result;
    });
  }

  /** `getPayment` d'une personne : la vente doit être dans la portée d'un de ses rôles, sinon `404`. */
  getForPerson(
    principal: Principal,
    transactionId: string,
    language: Language,
  ): Promise<PaymentResult> {
    // Personne de la plateforme (sans prestataire) : aucun rôle de lecture des ventes (contrat).
    if (principal.operatorId === null) throw new ProblemException('NOT_FOUND');
    return this.tx.run(principal.operatorId, async (client) => {
      const row = await this.row(client, { transactionId, language });
      if (!row) throw new ProblemException('NOT_FOUND');
      const chain: ScopeLink[] = [
        ...(row.event_id ? [{ scope: { type: 'EVENT', id: row.event_id } } as ScopeLink] : []),
        ...(row.organizer_id
          ? [{ scope: { type: 'ORGANIZER', id: row.organizer_id } } as ScopeLink]
          : []),
        { scope: { type: 'OPERATOR', id: row.operator_id } },
        ...(row.merchant_id
          ? [{ scope: { type: 'MERCHANT', id: row.merchant_id } } as ScopeLink]
          : []),
      ];
      if (!exercisedRole(principal, READ_ROLES, chain)) throw new ProblemException('NOT_FOUND');
      return toResult(row);
    });
  }

  private async row(
    client: TxClient,
    input: { transactionId: string; language: Language; deviceId?: string },
  ): Promise<SaleRow | null> {
    const { rows } = await client.query<SaleRow>(READ_SALE, [
      input.transactionId,
      input.deviceId ?? null,
      input.language,
    ]);
    return rows[0] ?? null;
  }
}

function toResult(row: SaleRow): PaymentResult {
  const paid = Number(row.paid);
  const promo = Number(row.promo);
  return {
    transaction_id: row.transaction_id,
    idempotency_key: row.idempotency_key,
    type: 'PURCHASE',
    status: 'SUCCEEDED',
    amount: Number(row.amount),
    currency: row.currency.trim(),
    occurred_at: row.occurred_at.toISOString(),
    recorded_at: row.recorded_at.toISOString(),
    media_id: row.media_id,
    ...(row.wallet_id ? { wallet_id: row.wallet_id } : {}),
    balance_after: { spendable: paid + promo, paid, promo },
    ...(row.vendor_id && row.vendor_name
      ? { vendor: { vendor_id: row.vendor_id, display_name: row.vendor_name } }
      : {}),
    ...(row.lines.length > 0
      ? {
          lines: row.lines.map((l) => ({
            product_id: l.product_id,
            label: l.label,
            quantity: l.quantity,
            unit_price: Number(l.unit_price),
            vat_rate_bps: l.vat_rate_bps,
            line_total: Number(l.line_total),
            catalog_version: l.catalog_version,
          })),
        }
      : {}),
    ...(row.channel ? { channel: row.channel } : {}),
  };
}
