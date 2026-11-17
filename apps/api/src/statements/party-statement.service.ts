// Relevé d'une partie pour un événement (route 16, FR-022). Source de vérité : les écritures (`posting`) ; jamais
// `closing_step.summary`. Lecture seule, sous la RLS du prestataire. Convention de signe : montant du point de vue de
// la partie, crédit positif (`-posting.amount`) ; le solde est la somme des montants (colonne `balance` du CSV).
// `closing_balance` (facultatif au contrat) n'est PAS servi en JSON : sur les comptes chauds (commissions, taxes,
// commerçants) il exige de sommer toutes les écritures (35 à 45 ms par compte de 100 000 écritures, 2,2 s au 95e
// centile pour l'organisateur à 20 relevés simultanés), ce que NFR-004 ne permet pas sans index couvrant
// (`posting (account_id) INCLUDE (amount)`, une migration hors de ce lot) : point soumis au porteur.
// Une ligne = une écriture sur un compte de la partie. Le libellé est la catégorie (`statement-categories.ts`), jamais
// la note libre de l'écriture (elle peut nommer un festivalier) ; pour l'organisateur, le prestataire et la plateforme,
// le nom du commerçant s'ajoute quand la transaction n'en concerne qu'un.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { Csv, type CsvColumn } from '../common/csv';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { amountJson } from '../closing/closing-steps.dto';
import { categoryOf } from './statement-categories';
import type { PartyKind } from './party-statement-scope';

export interface StatementEventRow {
  id: string;
  operator_id: string;
  organizer_id: string;
  currency: string;
}

export interface StatementLineDto {
  transaction_id: string;
  occurred_at: string;
  type: string;
  label: string;
  amount: number;
}

export interface PartyStatementDto {
  party_kind: PartyKind;
  party_id?: string;
  event_id: string;
  currency: string;
  data: StatementLineDto[];
  next_cursor: string | null;
  has_more: boolean;
}

interface PartyAccount {
  id: string;
  purpose: string;
  /** Grand livre à portée organisateur : les écritures sont filtrées sur l'événement de la transaction. */
  org_scope: boolean;
  /** Compte d'un commerçant interne : seules les ventes et annulations sans règle de frais (« Ventes internes »). */
  sales_only?: boolean;
}

interface LineRow {
  posting_id: string;
  transaction_id: string;
  occurred_at: Date;
  type: string;
  purpose: string;
  fee: boolean;
  amount: string;
  counterparty: string | null;
}

const CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'occurred_at', header: 'occurred_at', kind: 'text' },
  { key: 'type', header: 'type', kind: 'text' },
  { key: 'label', header: 'label', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'balance', header: 'balance', kind: 'number' },
];

/** Curseur : numéro de la dernière écriture rendue (ordre d'écriture au grand livre, croissant). */
interface Cursor {
  i: string;
}

export function parseCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw === '') return null;
  const bad = () =>
    new ProblemException('VALIDATION_FAILED', {
      status: 400,
      detail: 'cursor : curseur invalide.',
    });
  if (raw.length > 128) throw bad();
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof value.i === 'string' && /^[0-9]{1,18}$/.test(value.i)) return { i: value.i };
  } catch {
    // illisible : refusé ci-dessous
  }
  throw bad();
}

const encodeCursor = (row: LineRow): string =>
  Buffer.from(JSON.stringify({ i: row.posting_id })).toString('base64url');

@Injectable()
export class PartyStatementService {
  constructor(private readonly audit: AuditService) {}

  /** Événement du prestataire (RLS) ; inconnu ou d'un autre prestataire : `404`. */
  async event(client: TxClient, eventId: string): Promise<StatementEventRow> {
    const { rows } = await client.query<StatementEventRow>(
      `SELECT id, operator_id, organizer_id, currency::text AS currency FROM event WHERE id = $1`,
      [eventId],
    );
    if (!rows[0]) throw new ProblemException('NOT_FOUND');
    return { ...rows[0], currency: rows[0].currency.trim() };
  }

  async participates(client: TxClient, eventId: string, merchantId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM merchant_participation WHERE event_id = $1 AND merchant_id = $2`,
      [eventId, merchantId],
    );
    return rowCount === 1;
  }

  private async accounts(
    client: TxClient,
    kind: PartyKind,
    event: StatementEventRow,
    partyId: string | null,
  ): Promise<PartyAccount[]> {
    // Comptes de la partie dans le grand livre de l'événement (ou, à portée organisateur, de l'organisateur : les
    // écritures sont alors filtrées sur l'événement de la transaction, `org_scope`).
    const head = `SELECT a.id, a.purpose, (l.scope_type = 'ORGANIZER') AS org_scope FROM account a
        JOIN ledger l ON l.id = a.ledger_id
         AND ((l.scope_type = 'EVENT' AND l.scope_id = $1)
           OR (l.scope_type = 'ORGANIZER' AND l.scope_id = $2))`;
    const values: unknown[] = [event.id, event.organizer_id];
    let where: string;
    switch (kind) {
      case 'MERCHANT':
        values.push(partyId);
        where = `a.purpose = 'MERCHANT' AND a.participation_id IN
          (SELECT mp.id FROM merchant_participation mp WHERE mp.event_id = $1 AND mp.merchant_id = $3)`;
        break;
      case 'ORGANIZER':
        values.push(partyId);
        where = `a.owner_party_id = $3 AND left(a.purpose, 4) = 'ORG_'`;
        break;
      case 'OPERATOR':
        values.push(event.operator_id);
        where = `a.owner_party_id = $3 AND left(a.purpose, 4) = 'OPE_'`;
        break;
      case 'PLATFORM':
        where = `left(a.purpose, 4) = 'PLT_'`;
        break;
    }
    const { rows } = await client.query<PartyAccount>(
      `${head} WHERE ${where} ORDER BY a.id`,
      values,
    );
    if (kind !== 'ORGANIZER') return rows;
    // « Ventes internes » : comptes des participations INTERNAL des commerçants de CET événement (donc de cet
    // organisateur, l'événement étant le sien) ; jamais un commerçant EXTERNAL ni un autre événement.
    const internal = await client.query<PartyAccount>(
      `SELECT a.id, a.purpose, false AS org_scope, true AS sales_only FROM account a
         JOIN ledger l ON l.id = a.ledger_id AND l.scope_type = 'EVENT' AND l.scope_id = $1
         JOIN merchant_participation mp ON mp.id = a.participation_id
        WHERE a.purpose = 'MERCHANT' AND mp.event_id = $1 AND mp.link_type = 'INTERNAL'
          AND mp.payout_to = $2
        ORDER BY a.id`,
      [event.id, event.organizer_id],
    );
    return [...rows, ...internal.rows];
  }

  /**
   * Lignes dans l'ordre d'écriture après `after` ; `limit` absent : toutes. Une requête par compte, avec le numéro de
   * compte en valeur (le plan suit l'index (compte, écriture) même pour un compte sans écriture : une requête
   * unique en jointure latérale parcourait toute la table des écritures pour ces comptes), puis fusion par numéro.
   */
  private async lines(
    client: TxClient,
    kind: PartyKind,
    event: StatementEventRow,
    partyId: string | null,
    after: Cursor | null,
    limit: number | null,
  ): Promise<LineRow[]> {
    const merged: LineRow[] = [];
    for (const account of await this.accounts(client, kind, event, partyId)) {
      const { rows } = await client.query<LineRow>(
        `SELECT p.id::text AS posting_id, p.transaction_id, t.occurred_at, t.type::text AS type,
                $1::text AS purpose, (p.fee_rule_id IS NOT NULL) AS fee, (-p.amount)::text AS amount,
                NULL::text AS counterparty
           FROM posting p
           JOIN journal_transaction t ON t.id = p.transaction_id AND t.ledger_id = p.ledger_id
          WHERE p.account_id = $2 AND p.id > $3::bigint AND ($4::boolean IS NOT TRUE OR t.event_id = $5)
            AND ($7::boolean IS NOT TRUE
                 OR (p.fee_rule_id IS NULL AND t.type::text IN ('PURCHASE', 'REVERSAL')))
          ORDER BY p.id LIMIT $6::bigint`,
        [
          account.purpose,
          account.id,
          after?.i ?? '0',
          account.org_scope,
          event.id,
          limit,
          account.sales_only === true,
        ],
      );
      merged.push(...rows);
    }
    merged.sort((x, y) => (BigInt(x.posting_id) < BigInt(y.posting_id) ? -1 : 1));
    const rows = limit === null ? merged : merged.slice(0, limit);
    if (kind !== 'MERCHANT') await this.counterparties(client, rows);
    return rows;
  }

  /** Nom du commerçant quand la transaction n'en concerne qu'un (organisateur, prestataire, plateforme). */
  private async counterparties(client: TxClient, rows: LineRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { rows: names } = await client.query<{ transaction_id: string; name: string }>(
      `SELECT q.transaction_id, min(mp.legal_name) AS name
         FROM posting q
         JOIN account qa ON qa.id = q.account_id
         JOIN merchant_participation pa ON pa.id = qa.participation_id
         JOIN party mp ON mp.id = pa.merchant_id
        WHERE q.transaction_id = ANY($1::uuid[])
        GROUP BY q.transaction_id HAVING count(DISTINCT pa.merchant_id) = 1`,
      [[...new Set(rows.map((r) => r.transaction_id))]],
    );
    const byTransaction = new Map(names.map((n) => [n.transaction_id, n.name]));
    for (const row of rows) row.counterparty = byTransaction.get(row.transaction_id) ?? null;
  }

  private label(kind: PartyKind, row: LineRow): string {
    const category = categoryOf(kind, { purpose: row.purpose, type: row.type, fee: row.fee });
    return row.counterparty ? `${category} — ${row.counterparty}` : category;
  }

  private dto(kind: PartyKind, row: LineRow): StatementLineDto {
    return {
      transaction_id: row.transaction_id,
      occurred_at: row.occurred_at.toISOString(),
      type: row.type,
      label: this.label(kind, row),
      amount: amountJson(BigInt(row.amount)),
    };
  }

  /** JSON paginé (`limit` lignes, curseur stable sur (écriture) : ni doublon ni trou). */
  async page(
    client: TxClient,
    kind: PartyKind,
    event: StatementEventRow,
    partyId: string | null,
    page: { after: Cursor | null; limit: number },
  ): Promise<PartyStatementDto> {
    const rows = await this.lines(client, kind, event, partyId, page.after, page.limit + 1);
    const hasMore = rows.length > page.limit;
    const shown = rows.slice(0, page.limit);
    const last = shown[shown.length - 1];
    return {
      party_kind: kind,
      ...(partyId ? { party_id: partyId } : {}),
      event_id: event.id,
      currency: event.currency,
      data: shown.map((row) => this.dto(kind, row)),
      next_cursor: hasMore && last ? encodeCursor(last) : null,
      has_more: hasMore,
    };
  }

  /** CSV complet (toutes les lignes) avec le solde courant ; mêmes montants que le JSON. */
  async csv(
    client: TxClient,
    kind: PartyKind,
    event: StatementEventRow,
    partyId: string | null,
  ): Promise<{ text: string; lines: number }> {
    const rows = await this.lines(client, kind, event, partyId, null, null);
    let balance = 0n;
    const out = rows.map((row) => {
      balance += BigInt(row.amount);
      return {
        occurred_at: row.occurred_at.toISOString(),
        type: row.type,
        label: this.label(kind, row),
        amount: amountJson(BigInt(row.amount)),
        balance: amountJson(balance),
      };
    });
    return { text: Csv.write(out, CSV_COLUMNS), lines: out.length };
  }

  /** Trace d'un relevé exporté en CSV (FR-024) : auteur, partie, événement, nombre de lignes ; aucun montant. */
  recordCsvExport(
    client: TxClient,
    audit: AuditContext,
    event: StatementEventRow,
    kind: PartyKind,
    partyId: string | null,
    lines: number,
  ): Promise<void> {
    return this.audit.record(client, {
      ...audit,
      operatorId: event.operator_id,
      action: 'PARTY_STATEMENT_EXPORTED',
      objectType: 'event',
      objectId: event.id,
      after: { party_kind: kind, party_id: partyId, lines },
    });
  }
}
