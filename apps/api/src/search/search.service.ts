// Recherches du back-office (mission routes-backoffice, WP08 ; FR-011 à FR-014, NFR-004, NFR-006) : un bracelet par
// UID ou code imprimé, un portefeuille, les portefeuilles d'un festivalier par numéro exact. Lecture seule : aucune
// écriture au grand livre. Portée dans la requête SQL ; hors portée ou autre prestataire = absent, sans indice.
// Le numéro n'est jamais écrit : ni en audit (D7), ni en journal, ni en réponse (masque seulement).
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { ClaimHasher } from '../kms/claim-hash';
import { maskPhone } from './phone-mask';
import { checkSearchLimit } from './search-rate-limit';
import {
  CUSTOMER_ROLES,
  MEDIA_ROLES,
  WALLET_ROLES,
  scopeSql,
  scopeSummary,
  searchScope,
  type SearchScope,
} from './search-scope';
import {
  parseMediaQuery,
  parsePhoneBody,
  type CustomerSearchResult,
  type MediaSearchResult,
  type WalletOverview,
} from './search.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WalletRow {
  wallet_id: string;
  customer_id: string | null;
  status: string;
  event_id: string;
  currency: string;
  paid: string;
  promo: string;
  deposit: string;
  media: WalletOverview['media'];
}

/** Référence opaque d'un festivalier : dérivée de son identifiant interne, jamais le numéro ni le nom. */
export function customerRef(customerId: string): string {
  return createHash('sha256')
    .update('CASHLESS/STAFF-CUSTOMER-REF/v1')
    .update(customerId)
    .digest('hex')
    .slice(0, 16);
}

const BALANCE = (purpose: string) =>
  `coalesce((SELECT -sum(b.balance) FROM account a JOIN account_balance b ON b.account_id = a.id
              WHERE a.wallet_id = w.id AND a.purpose = '${purpose}'), 0)::text`;

/** Construction unique d'un portefeuille (`getWalletOverview` et `wallets[]` de la recherche par numéro). */
async function loadWallets(
  client: TxClient,
  join: string,
  where: string,
  params: unknown[],
): Promise<WalletRow[]> {
  const { rows } = await client.query<WalletRow>(
    `SELECT w.id AS wallet_id, w.customer_id, w.status, e.id AS event_id, l.currency,
            ${BALANCE('WALLET_PAID')} AS paid, ${BALANCE('WALLET_PROMO')} AS promo,
            coalesce((SELECT sum(m.deposit_held) FROM media m
                       WHERE m.deposit_status = 'HELD' AND (m.wallet_id = w.id OR m.id IN
                         (SELECT ma.media_id FROM media_assignment ma
                           WHERE ma.wallet_id = w.id AND ma.released_at IS NULL))), 0)::text AS deposit,
            coalesce((SELECT json_agg(json_build_object('media_id', m.id, 'status', m.status,
                                                         'printed_number', m.printed_number)
                                      ORDER BY m.id)
                        FROM media m WHERE m.wallet_id = w.id OR m.id IN
                         (SELECT ma.media_id FROM media_assignment ma
                           WHERE ma.wallet_id = w.id AND ma.released_at IS NULL)), '[]'::json) AS media
       FROM wallet w
       JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
       JOIN event e ON e.id = l.scope_id
       ${join}
      WHERE ${where}
      ORDER BY e.name, w.id`,
    params,
  );
  return rows;
}

const toOverview = (row: WalletRow): WalletOverview => ({
  wallet_id: row.wallet_id,
  status: row.status,
  event_id: row.event_id,
  currency: row.currency.trim(),
  paid_balance: Number(row.paid),
  promo_balance: Number(row.promo),
  deposit: Number(row.deposit),
  media: row.media,
  customer_ref: row.customer_id ? customerRef(row.customer_id) : null,
});

@Injectable()
export class SearchService {
  private readonly perMinute: number;

  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly hasher: ClaimHasher,
    @Inject(APP_CONFIG) config: Pick<AppConfig, 'staffPhoneSearchPerMinute'>,
  ) {
    this.perMinute = config.staffPhoneSearchPerMinute;
  }

  /** `searchMedia` : zéro ou un bracelet ; hors portée = liste vide, identique à « inconnu ». */
  async searchMedia(
    req: Request,
    query: Record<string, unknown>,
  ): Promise<{ data: MediaSearchResult[] }> {
    const scope = searchScope(req, MEDIA_ROLES, { participations: true });
    const criterion = parseMediaQuery(query);
    const params: unknown[] = [];
    let match: string;
    if (criterion.kind === 'nfc_uid') {
      params.push(criterion.uid);
      match = `m.nfc_uid = decode($${params.length}, 'hex')`;
    } else {
      let hash: Buffer;
      try {
        hash = this.hasher.claimCodeHash(criterion.code);
      } catch {
        return { data: [] }; // code mal formé : ne peut correspondre à aucun bracelet
      }
      params.push(hash, this.hasher.keyVersion);
      match = `m.claim_code_hash = $${params.length - 1} AND m.claim_key_version = $${params.length}`;
    }
    const inScope = scopeSql(scope, params, 'coalesce(l.scope_id, b.event_id)', 'b.organizer_id');
    const rows = await this.tx.run(scope.operatorId, async (client) => {
      const res = await client.query<{
        media_id: string;
        status: string;
        printed_number: string | null;
        wallet_id: string | null;
        event_id: string | null;
        deposit: string;
        paid: string | null;
        promo: string | null;
      }>(
        `SELECT m.id AS media_id, m.status, m.printed_number, m.wallet_id,
                coalesce(l.scope_id, b.event_id) AS event_id, m.deposit_held::text AS deposit,
                CASE WHEN m.wallet_id IS NULL THEN NULL ELSE ${BALANCE('WALLET_PAID').replace(/w\.id/g, 'm.wallet_id')} END AS paid,
                CASE WHEN m.wallet_id IS NULL THEN NULL ELSE ${BALANCE('WALLET_PROMO').replace(/w\.id/g, 'm.wallet_id')} END AS promo
           FROM media m
           LEFT JOIN media_batch b ON b.id = m.batch_id
           LEFT JOIN wallet w ON w.id = m.wallet_id
           LEFT JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
          WHERE ${match} AND m.operator_id = current_setting('app.operator_id', true)::uuid AND ${inScope}
          LIMIT 1`,
        params,
      );
      return res.rows;
    });
    return {
      data: rows.map((r) => ({
        media_id: r.media_id,
        status: r.status,
        event_id: r.event_id,
        wallet_id: r.wallet_id,
        printed_number: r.printed_number,
        paid_balance: r.paid === null ? null : Number(r.paid),
        promo_balance: r.promo === null ? null : Number(r.promo),
        deposit: r.wallet_id === null ? null : Number(r.deposit),
      })),
    };
  }

  /** `getWalletOverview` : hors portée ou autre prestataire = `404`. */
  async walletOverview(req: Request, walletId: string): Promise<WalletOverview> {
    const scope = searchScope(req, WALLET_ROLES);
    if (!UUID.test(walletId)) throw new ProblemException('NOT_FOUND');
    const params: unknown[] = [walletId];
    const inScope = scopeSql(scope, params, 'e.id', 'e.organizer_id');
    const rows = await this.tx.run(scope.operatorId, (client) =>
      loadWallets(
        client,
        '',
        `w.id = $1 AND w.operator_id = current_setting('app.operator_id', true)::uuid AND ${inScope}`,
        params,
      ),
    );
    if (!rows[0]) throw new ProblemException('NOT_FOUND');
    return toOverview(rows[0]);
  }

  /** `searchCustomerByPhone` : égalité exacte, portée en SQL, audit sans numéro, limite par personne. */
  async searchCustomer(req: Request, body: unknown): Promise<CustomerSearchResult> {
    const scope = searchScope(req, CUSTOMER_ROLES);
    const phone = parsePhoneBody(body);
    const ctx = auditContext(req);
    const outcome = await this.tx.run(scope.operatorId, async (client) => {
      // Contrôle de débit AVANT toute lecture du client.
      const limit = await checkSearchLimit(client, scope.principal.userId, this.perMinute);
      if (limit.exceeded) {
        await this.audit.record(client, {
          ...ctx,
          operatorId: scope.operatorId,
          action: 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED',
          objectType: 'CUSTOMER_SEARCH',
          after: { limit: this.perMinute, window_seconds: 60, scope: scopeSummary(scope) },
        });
        return { limited: limit.retryAfterSeconds } as const;
      }
      const params: unknown[] = [phone];
      const inScope = scopeSql(scope, params, 'e.id', 'e.organizer_id');
      const rows = await loadWallets(
        client,
        'JOIN customer_identity ci ON ci.customer_id = w.customer_id',
        `ci.phone = $1 AND ci.operator_id = current_setting('app.operator_id', true)::uuid AND ${inScope}`,
        params,
      );
      const customers = [...new Set(rows.flatMap((r) => (r.customer_id ? [r.customer_id] : [])))];
      await this.audit.record(client, {
        ...ctx,
        operatorId: scope.operatorId,
        action: 'STAFF_CUSTOMER_SEARCH',
        objectType: 'CUSTOMER_SEARCH',
        after: { result_count: rows.length, customer_ids: customers, scope: scopeSummary(scope) },
      });
      return { rows } as const;
    });
    // Le refus se lève après le COMMIT de la ligne d'audit du refus.
    if ('limited' in outcome)
      throw new ProblemException('RATE_LIMITED', {
        headers: { 'Retry-After': String(outcome.limited) },
      });
    return { masked_phone: maskPhone(phone), wallets: outcome.rows.map(toOverview) };
  }
}

export type { SearchScope };
