// Lecture des ventes du back-office (mission routes-backoffice 11b, WP06 ; FR-005, FR-006, FR-007, D5, D6).
// Lecture seule dans `sale_overview` (vue `security_invoker`, RLS du prestataire de la transaction) : aucun droit
// nouveau, aucune écriture, aucun SQL de grand livre. La portée est TOUJOURS dans le `WHERE` :
//  - `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` tenus sur l'événement ou une portée englobante : toutes les
//    ventes de l'événement ;
//  - sinon `MERCHANT_ADMIN` d'un commerçant (attribution de portée MERCHANT seule) : `merchant_id` borné à ses
//    commerçants, quel que soit le filtre demandé (D6) ;
//  - sans aucun de ces rôles dans la personne : 403 ; avec un rôle mais hors portée : 404 (aucun indice).
// Le curseur porte l'instant en microsecondes (texte exact) : deux ventes de même `occurred_at` ne se perdent ni
// ne se doublent.
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { requestPrincipal, type Principal, type Role } from '../identity/principal';
import { exercisedRole, resolveChain, type ScopeLink } from '../identity/scope-resolver';
import { TENANT_CONTEXT, type TenantContextProvider } from '../tenancy/tenant-context';
import {
  encodeCursor,
  isUuid,
  parseSaleQuery,
  toLine,
  toSummary,
  type SaleFilters,
  type SaleLineRow,
  type SaleQuery,
  type SaleRow,
} from './sales.dto';

/** Rôles qui voient toutes les ventes de leur portée. */
const WIDE_ROLES: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR'];
const READ_ROLES: readonly Role[] = [...WIDE_ROLES, 'MERCHANT_ADMIN'];

const COLUMNS = `transaction_id, event_id, occurred_at,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_text,
  amount::text AS amount, currency, pos_id, merchant_id, vendor_id, device_id, source, channel,
  reversal_transaction_id`;

/** `null` : toutes les ventes de l'événement ; sinon commerçants dont la personne voit les ventes. */
type MerchantScope = readonly string[] | null;

@Injectable()
export class SalesService {
  constructor(
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  /** `listEventSales`. */
  async list(req: Request, eventId: string, query: SaleQuery) {
    const principal = requestPrincipal(req);
    requireStaffReadRole(principal);
    const filters = parseSaleQuery(query);
    const { operatorId } = this.tenant.current(req);
    return this.tx.run(operatorId, async (client) => {
      const chain = await resolveChain(client, { type: 'EVENT', id: eventId });
      const scope = await this.scopeOf(client, principal, chain, eventId);
      const { sql, params } = listQuery(eventId, scope, filters);
      if (walksSalesIndex(scope, filters)) await client.query('SET LOCAL enable_sort = off');
      const { rows } = await client.query<SaleRow>(sql, params);
      const page = rows.slice(0, filters.limit);
      const last = page[page.length - 1];
      const hasMore = rows.length > filters.limit;
      return {
        data: page.map(toSummary),
        next_cursor: hasMore && last ? encodeCursor(last.occurred_text, last.transaction_id) : null,
        has_more: hasMore,
      };
    });
  }

  /** `getSale`. */
  async get(req: Request, transactionId: string) {
    const principal = requestPrincipal(req);
    requireStaffReadRole(principal);
    if (!isUuid(transactionId)) throw new ProblemException('NOT_FOUND');
    const { operatorId } = this.tenant.current(req);
    return this.tx.run(operatorId, async (client) => {
      // Événement de la vente (sous la RLS : celle d'un autre prestataire n'existe pas), puis portée.
      const head = await client.query<{ event_id: string | null }>(
        'SELECT event_id FROM sale_overview WHERE transaction_id = $1',
        [transactionId],
      );
      if (!head.rows[0]) throw new ProblemException('NOT_FOUND');
      const eventId = head.rows[0].event_id;
      const chain = eventId
        ? await resolveChain(client, { type: 'EVENT', id: eventId })
        : await resolveChain(client, { type: 'OPERATOR', id: operatorId });
      const scope = await this.scopeOf(client, principal, chain, eventId);
      const params: unknown[] = [transactionId];
      // Vente sans attribution (`channel` nul) : 404 comme une vente absente (décision du porteur du 25/11).
      let where = 'transaction_id = $1 AND channel IS NOT NULL';
      if (scope !== null) {
        params.push(scope);
        where += ' AND merchant_id = ANY($2::uuid[])';
      }
      const sale = await client.query<SaleRow>(
        `SELECT ${COLUMNS} FROM sale_overview WHERE ${where}`,
        params,
      );
      const row = sale.rows[0];
      if (!row) throw new ProblemException('NOT_FOUND');
      const lines = await client.query<SaleLineRow>(
        `SELECT line_no, item_id, label_fr, label_en, quantity, unit_price::text AS unit_price,
                vat_rate_bps, line_total::text AS line_total
           FROM sale_line WHERE transaction_id = $1 ORDER BY line_no`,
        [transactionId],
      );
      return { ...toSummary(row), lines: lines.rows.map(toLine) };
    });
  }

  /**
   * Portée de la personne sur les ventes de la chaîne (événement, organisateur, prestataire). `404` hors portée.
   * `MERCHANT_ADMIN` : seules les attributions de portée MERCHANT comptent (une attribution plus large ne donne
   * pas la vue de tous les commerçants), et le commerçant doit participer à l'événement.
   */
  private async scopeOf(
    client: TxClient,
    principal: Principal,
    chain: readonly ScopeLink[],
    eventId: string | null,
  ): Promise<MerchantScope> {
    if (exercisedRole(principal, WIDE_ROLES, chain)) return null;
    const own = principal.assignments
      .filter((a) => a.role === 'MERCHANT_ADMIN' && a.scopeType === 'MERCHANT' && a.scopeId)
      .map((a) => a.scopeId as string);
    if (own.length === 0 || eventId === null) throw new ProblemException('NOT_FOUND');
    const { rows } = await client.query<{ merchant_id: string }>(
      `SELECT DISTINCT merchant_id FROM merchant_participation
        WHERE event_id = $1 AND merchant_id = ANY($2::uuid[])`,
      [eventId, own],
    );
    if (rows.length === 0) throw new ProblemException('NOT_FOUND');
    return rows.map((r) => r.merchant_id).sort();
  }
}

/**
 * Filtres sur une colonne DÉRIVÉE de la vue (`merchant_id`, `pos_id` : jointures, aucun index propre). Le
 * planificateur sous-estime alors le nombre de lignes (74 au lieu de 100 000), trie les 200 000 ventes de
 * l'événement sur disque (1,4 s) au lieu de parcourir `journal_transaction_sales_idx` dans l'ordre du tri et de
 * s'arrêter à la page (87 ms). `SET LOCAL enable_sort = off` (limité à la transaction ; aucun droit, aucun
 * changement de schéma) l'oriente vers l'index : il décourage le tri sans l'interdire. Pas pour `vendor_id`, que
 * `sale_attribution_vendor_idx` sert mieux (le parcours dans l'ordre y serait plus lent).
 */
function walksSalesIndex(scope: MerchantScope, f: SaleFilters): boolean {
  return f.vendorId === null && (scope !== null || f.merchantId !== null || f.posId !== null);
}

/** Aucun rôle de lecture des ventes dans la personne : 403 (les autres cas : 404). */
function requireStaffReadRole(principal: Principal): void {
  if (!principal.assignments.some((a) => READ_ROLES.includes(a.role)))
    throw new ProblemException('FORBIDDEN');
}

/** Requête de la liste : toute la portée et tous les filtres dans le `WHERE`, tri et borne du curseur identiques. */
function listQuery(
  eventId: string,
  scope: MerchantScope,
  f: SaleFilters,
): { sql: string; params: unknown[] } {
  if (f.status === 'REVERSED' && scope === null && !hasDerivedFilter(f))
    return reversedQuery(eventId, f);
  const params: unknown[] = [eventId];
  // Ventes sans attribution (`channel` nul : back-office, canal inconnu) exclues de la liste (décision du porteur
  // du 25/11 ; le contrat veut un canal non nul). Limite consignée en point ouvert par WP11.
  const where: string[] = ['event_id = $1', 'channel IS NOT NULL'];
  const add = (clause: (n: string) => string, value: unknown): void => {
    params.push(value);
    where.push(clause(`$${params.length}`));
  };
  if (scope !== null) add((n) => `merchant_id = ANY(${n}::uuid[])`, scope);
  if (f.merchantId !== null) add((n) => `merchant_id = ${n}::uuid`, f.merchantId);
  if (f.posId !== null) add((n) => `pos_id = ${n}::uuid`, f.posId);
  if (f.vendorId !== null) add((n) => `vendor_id = ${n}::uuid`, f.vendorId);
  if (f.from !== null) add((n) => `occurred_at >= ${n}::timestamptz`, f.from);
  if (f.to !== null) add((n) => `occurred_at < ${n}::timestamptz`, f.to);
  if (f.status === 'VALID') where.push('reversal_transaction_id IS NULL');
  if (f.status === 'REVERSED') where.push('reversal_transaction_id IS NOT NULL');
  if (f.cursor !== null) {
    params.push(f.cursor.occurredAt, f.cursor.transactionId);
    where.push(
      `(occurred_at, transaction_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(f.limit + 1);
  return {
    sql: `SELECT ${COLUMNS} FROM sale_overview WHERE ${where.join(' AND ')}
           ORDER BY occurred_at DESC, transaction_id DESC LIMIT $${params.length}`,
    params,
  };
}

/** Filtre sur une colonne dérivée de la vue (jointures coûteuses) : `merchant_id`, `pos_id`, `vendor_id`. */
function hasDerivedFilter(f: SaleFilters): boolean {
  return f.merchantId !== null || f.posId !== null || f.vendorId !== null;
}

/**
 * Liste des ventes annulées sans filtre dérivé : les annulées sont rares (2 %) et dispersées dans le temps ; lire la
 * vue dans l'ordre du tri ferait payer ses jointures à chaque vente parcourue (plus de 2 000 pour une page,
 * 475 à 630 ms p95 sur 200 000 ventes). On choisit d'abord la page d'identifiants sur `journal_transaction` seule
 * (index `journal_transaction_sales_idx`, sonde de `journal_transaction_reverses_once`), puis la vue ne joint que
 * ces lignes (`= ANY(ARRAY(...))` : avec `IN (sous-requête)` le planificateur joint les 200 000 ventes, 900 ms).
 * Mêmes lignes, même tri, même borne de curseur que la requête générale ; aucune migration.
 */
function reversedQuery(eventId: string, f: SaleFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [eventId];
  const where: string[] = [
    't.event_id = $1',
    "t.type = 'PURCHASE'",
    'EXISTS (SELECT 1 FROM journal_transaction r WHERE r.reverses_id = t.id)',
    'EXISTS (SELECT 1 FROM sale_attribution a WHERE a.transaction_id = t.id)',
  ];
  if (f.from !== null) {
    params.push(f.from);
    where.push(`t.occurred_at >= $${params.length}::timestamptz`);
  }
  if (f.to !== null) {
    params.push(f.to);
    where.push(`t.occurred_at < $${params.length}::timestamptz`);
  }
  if (f.cursor !== null) {
    params.push(f.cursor.occurredAt, f.cursor.transactionId);
    where.push(
      `(t.occurred_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(f.limit + 1);
  const n = params.length;
  return {
    sql: `WITH page AS MATERIALIZED (
            SELECT t.id FROM journal_transaction t WHERE ${where.join(' AND ')}
             ORDER BY t.occurred_at DESC, t.id DESC LIMIT $${n})
          SELECT ${COLUMNS} FROM sale_overview
           WHERE event_id = $1 AND channel IS NOT NULL
             AND transaction_id = ANY(ARRAY(SELECT id FROM page))
           ORDER BY occurred_at DESC, transaction_id DESC LIMIT $${n}`,
    params,
  };
}
