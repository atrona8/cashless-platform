// Import et rapprochement des relevés (mission 9b, WP09 ; FR-013, FR-014, FR-024, NFR-003). Ce service ne calcule
// rien de comptable : il valide, appelle `import_statement_lines` et `match_statement_line` (WP02), présente. Toute
// écriture passe par ces deux fonctions ; la garde de portée de la base reste la vraie, la portée contrôlée ici sert
// à répondre `403` / `404` proprement.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { canReadEvent, settingRolesOn } from '../events/events.controller';
import type { TenantActor } from '../organization/tenant/tenant-access';
import {
  encodeLineCursor,
  LINE_COLUMNS,
  toStatementLine,
  type LineCursor,
  type LineRow,
  type ListFilters,
  type ParsedLine,
  type StatementHeader,
  type StatementImportResult,
  type StatementLine,
} from './statements.dto';

export interface LedgerScope {
  id: string;
  currency: string;
}

export interface LinePage {
  data: StatementLine[];
  next_cursor: string | null;
  has_more: boolean;
}

const notFound = () => new ProblemException('NOT_FOUND');
const unprocessable = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

/**
 * Grand livre visible du prestataire (la RLS cache les autres : `404`) puis portée de la personne sur son
 * événement : écriture = rôle de réglage (OPERATOR_ADMIN, ORGANIZER_ADMIN de l'organisateur), lecture = `canReadEvent`.
 * Un grand livre hors événement n'est ouvert qu'à l'OPERATOR_ADMIN.
 */
export async function loadLedger(
  client: TxClient,
  actor: TenantActor,
  ledgerId: string,
  mode: 'read' | 'write',
): Promise<LedgerScope> {
  const { rows } = await client.query<{
    id: string;
    currency: string;
    scope_type: string;
    scope_id: string;
    organizer_id: string | null;
  }>(
    `SELECT l.id, l.currency, l.scope_type, l.scope_id, e.organizer_id
       FROM ledger l LEFT JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
      WHERE l.id = $1`,
    [ledgerId],
  );
  const ledger = rows[0];
  if (!ledger) throw notFound();
  const operatorWide = actor.principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN');
  let allowed = operatorWide;
  if (ledger.scope_type === 'EVENT' && ledger.organizer_id) {
    allowed =
      mode === 'write'
        ? settingRolesOn(actor, ledger.organizer_id).length > 0
        : canReadEvent(actor, { id: ledger.scope_id, organizer_id: ledger.organizer_id });
  }
  if (!allowed) throw new ProblemException('FORBIDDEN');
  return { id: ledger.id, currency: ledger.currency.trim() };
}

@Injectable()
export class StatementsService {
  constructor(private readonly audit: AuditService) {}

  /** Route 10, dans la transaction idempotente de l'appelant. */
  async import(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
    accountId: string,
    header: StatementHeader,
    csv: string,
    lines: ParsedLine[],
  ): Promise<StatementImportResult> {
    const ledger = await loadLedger(client, actor, ledgerId, 'write');
    const account = (
      await client.query<{ family: string; purpose: string }>(
        'SELECT family::text, purpose FROM account WHERE id = $1 AND ledger_id = $2',
        [accountId, ledger.id],
      )
    ).rows[0];
    if (!account) throw notFound();
    // Compte d'argent : ASSET, hors caisses (une caisse se compte, elle ne reçoit pas de relevé).
    if (account.family !== 'ASSET' || account.purpose === 'CASH_DESK')
      throw unprocessable('Compte refusé : un relevé ne s’importe que sur un compte d’argent.');
    const foreign = lines.findIndex((line) => line.currency !== ledger.currency);
    if (foreign >= 0)
      throw unprocessable(`Ligne ${foreign + 1} : devise différente de celle du grand livre.`);
    const sha = createHash('sha256').update(csv, 'utf8').digest('hex');
    const { rows } = await client.query<{
      r: { import_id: string; created: number; matched: number; existing: number };
    }>('SELECT import_statement_lines($1::jsonb, $2::jsonb) AS r', [
      JSON.stringify({
        ledger_id: ledger.id,
        account_id: accountId,
        source: header.source,
        file_sha256: sha,
        statement_date: header.statement_date,
        closing_balance: header.closing_balance,
        currency: ledger.currency,
        imported_by: actor.principal.userId,
      }),
      JSON.stringify(lines),
    ]);
    const result = rows[0]!.r;
    // Même fichier déjà importé sur ce compte avec d'autres paramètres : 409, jamais une correction ignorée en silence.
    // Relu APRÈS la fonction (qui prend le verrou du couple compte/empreinte) : sûr même en imports parallèles. Un
    // import existant n'écrit rien ; sinon la transaction de la requête est annulée par l'exception.
    const stored = (
      await client.query<{ source: string; statement_date: string; closing_balance: string }>(
        'SELECT source, statement_date::text, closing_balance::text FROM statement_import WHERE id = $1',
        [result.import_id],
      )
    ).rows[0]!;
    if (
      stored.source !== header.source ||
      stored.statement_date !== header.statement_date ||
      Number(stored.closing_balance) !== header.closing_balance
    )
      throw new ProblemException('CONFLICT_STATE', {
        detail:
          'Ce fichier a déjà été importé sur ce compte avec une autre source, date ou solde de clôture.',
      });
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'STATEMENT_IMPORTED',
      objectType: 'statement_import',
      objectId: result.import_id,
      // Jamais le contenu du relevé : compte, empreinte, compteurs.
      after: {
        account_id: accountId,
        file_sha256: sha,
        lines_created: result.created,
        lines_matched: result.matched,
        lines_existing: result.existing,
      },
    });
    return {
      statement_import_id: result.import_id,
      account_id: accountId,
      lines_created: result.created,
      lines_matched: result.matched,
      lines_existing: result.existing,
    };
  }

  /** Route 11 : une requête par page, tri stable (date de valeur, puis `id`). */
  async list(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
    filters: ListFilters,
    page: { limit: number; after: LineCursor | null },
  ): Promise<LinePage> {
    const ledger = await loadLedger(client, actor, ledgerId, 'write');
    const { rows } = await client.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM external_statement_line e
        WHERE e.ledger_id = $1
          AND ($2::uuid IS NULL OR e.account_id = $2)
          AND ($3::boolean IS NULL
               OR ((e.matched_tx_id IS NOT NULL OR e.matched_anomaly_id IS NOT NULL) = $3))
          AND ($4::date IS NULL OR (e.value_date, e.id) > ($4::date, $5::bigint))
        ORDER BY e.value_date, e.id
        LIMIT $6`,
      [
        ledger.id,
        filters.accountId,
        filters.matched,
        page.after?.d ?? null,
        page.after?.i ?? null,
        page.limit + 1,
      ],
    );
    const hasMore = rows.length > page.limit;
    const kept = rows.slice(0, page.limit);
    const last = kept[kept.length - 1];
    return {
      data: kept.map((row) => toStatementLine(row, ledger.currency)),
      next_cursor: hasMore && last ? encodeLineCursor(last) : null,
      has_more: hasMore,
    };
  }

  /** Route 12 : rapprochement manuel par `match_statement_line` ; un rapprochement posé ne se défait pas. */
  async match(
    client: TxClient,
    actor: TenantActor,
    lineId: string,
    target: { transactionId: string | null; anomalyId: string | null },
  ): Promise<StatementLine> {
    // La RLS cache les lignes des autres prestataires : `404`, comme une ligne inconnue.
    const found = (
      await client.query<{ ledger_id: string }>(
        'SELECT ledger_id FROM external_statement_line WHERE id = $1',
        [lineId],
      )
    ).rows[0];
    if (!found) throw notFound();
    const ledger = await loadLedger(client, actor, found.ledger_id, 'write');
    const { rows } = await client.query<LineRow>(
      `SELECT ${LINE_COLUMNS.replace(/e\./g, 'm.')}
         FROM match_statement_line($1::bigint, $2::uuid, $3::uuid, $4::uuid) m`,
      [lineId, target.transactionId, target.anomalyId, actor.principal.userId],
    );
    const row = rows[0]!;
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'STATEMENT_LINE_MATCHED',
      objectType: 'external_statement_line',
      objectId: lineId,
      after: {
        account_id: row.account_id,
        transaction_id: row.matched_tx_id,
        anomaly_id: row.matched_anomaly_id,
      },
    });
    return toStatementLine(row, ledger.currency);
  }
}
