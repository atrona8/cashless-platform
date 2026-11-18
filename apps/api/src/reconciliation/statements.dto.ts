// Relevés de comptes d'argent : requêtes, fichier CSV et réponses (mission 9b, WP09 ; FR-013 à FR-015 ; contrat
// `StatementImportResult`, `StatementLine`, `StatementLineMatch`, `AccountReconciliation`).
//
// FORMAT du fichier : `external_ref;value_date;amount;currency`, séparateur point-virgule, une ligne d'en-tête.
// SIGNE des montants : celui du compte d'argent dans le grand livre. Positif = argent ENTRÉ sur le compte (recharge,
// versement reçu) ; négatif = argent SORTI (remboursement, versement émis) ; jamais zéro. Le solde de clôture
// (`closing_balance`) suit la même convention : positif = argent détenu. Un montant de signe contraire à celui de la
// transaction du grand livre n'est jamais rapproché automatiquement : la base compare le signe et le montant.
// Une ligne invalide fait refuser TOUT le fichier ; les messages citent le numéro de la ligne de données, jamais son
// contenu.
import type { components } from '@cashless/contracts';
import { Csv, CsvParseError, type CsvColumn } from '../common/csv';
import { ProblemException } from '../errors/problem';
import { isUuid, objectBody } from '../organization/platform/platform.dto';

export type StatementImportResult = components['schemas']['StatementImportResult'];
export type StatementLine = components['schemas']['StatementLine'];
export type AccountReconciliation = components['schemas']['AccountReconciliation'];

const bad = (detail: string) => new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const unprocessable = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

export const STATEMENT_COLUMNS: readonly CsvColumn[] = [
  { key: 'external_ref', header: 'external_ref', kind: 'text' },
  { key: 'value_date', header: 'value_date', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'currency', header: 'currency', kind: 'text' },
];

export interface StatementHeader {
  source: string;
  statement_date: string;
  closing_balance: number;
}

export interface ParsedLine {
  external_ref: string;
  value_date: string;
  amount: number;
  currency: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date ISO réelle (le 30 février est refusé). */
export function isIsoDate(raw: string): boolean {
  if (!ISO_DATE.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(raw);
}

/** Paramètres de requête de la route 10 : `400` avant toute lecture du fichier. */
export function parseStatementHeader(query: Record<string, unknown>): StatementHeader {
  const { source, statement_date: date, closing_balance: closing } = query;
  if (
    typeof source !== 'string' ||
    source.trim() === '' ||
    source.length > 64 ||
    // eslint-disable-next-line no-control-regex -- refuser les caractères de contrôle est le but du test
    /[\u0000-\u001f\u007f]/.test(source)
  )
    throw bad('source : texte de 1 à 64 caractères, sans caractère de contrôle, attendu.');
  if (typeof date !== 'string' || !isIsoDate(date))
    throw bad('statement_date : date ISO (AAAA-MM-JJ) attendue.');
  if (typeof closing !== 'string' || !/^-?[0-9]+$/.test(closing) || !Number.isSafeInteger(+closing))
    throw bad('closing_balance : entier signé attendu, en unités mineures.');
  return { source: source.trim(), statement_date: date, closing_balance: Number(closing) };
}

/**
 * Lit et valide le fichier ENTIER avant la base. Les montants de signe contraire sont acceptés (sorties) ; la devise
 * est comparée à celle du grand livre par le service. Une erreur cite le numéro de la ligne de données (1 = la
 * première sous l'en-tête), jamais son contenu.
 */
export function parseStatementFile(text: string): ParsedLine[] {
  let rows: ReturnType<typeof Csv.parse>;
  try {
    rows = Csv.parse(text, STATEMENT_COLUMNS, { delimiter: ';' });
  } catch (error) {
    if (error instanceof CsvParseError)
      throw unprocessable(
        `Fichier refusé (${error.message.replace(/^ligne \d+ : /, '')}), ligne ${error.line}. Format : ` +
          'external_ref;value_date;amount;currency, séparateur « ; ».',
      );
    throw error;
  }
  if (rows.length === 0) throw unprocessable('Fichier refusé : aucune ligne sous l’en-tête.');
  return rows.map((row, k) => {
    const n = k + 1;
    const ref = String(row.external_ref);
    // eslint-disable-next-line no-control-regex -- refuser les caractères de contrôle est le but du test
    if (ref.trim() === '' || ref.length > 255 || /[\u0000-\u001f\u007f]/.test(ref))
      throw unprocessable(
        `Ligne ${n} : external_ref de 1 à 255 caractères, sans caractère de contrôle, attendu.`,
      );
    const valueDate = String(row.value_date);
    if (!isIsoDate(valueDate)) throw unprocessable(`Ligne ${n} : value_date ISO attendue.`);
    const amount = Number(row.amount);
    if (amount === 0 || !Number.isSafeInteger(amount))
      throw unprocessable(`Ligne ${n} : amount entier non nul attendu (positif = entrée).`);
    const currency = String(row.currency);
    if (!/^[A-Z]{3}$/.test(currency)) throw unprocessable(`Ligne ${n} : currency ISO attendue.`);
    return { external_ref: ref.trim(), value_date: valueDate, amount, currency };
  });
}

/** Identifiant de ligne de relevé (entier positif) ; mal formé : même `404` qu'une ligne inconnue. */
export function parseLineId(raw: string): string {
  if (!/^[1-9][0-9]{0,17}$/.test(raw)) throw new ProblemException('NOT_FOUND');
  return raw;
}

export function parseMatchBody(raw: unknown): {
  transactionId: string | null;
  anomalyId: string | null;
} {
  const body = objectBody(raw);
  const foreign = Object.keys(body).filter((k) => k !== 'transaction_id' && k !== 'anomaly_id');
  if (foreign.length > 0) throw bad(`Champ inconnu : ${foreign.join(', ')}.`);
  const tx = body.transaction_id;
  const anomaly = body.anomaly_id;
  if ((tx === undefined) === (anomaly === undefined))
    throw bad('Exactement un champ attendu : transaction_id ou anomaly_id.');
  if (tx !== undefined && !isUuid(tx)) throw bad('transaction_id : identifiant attendu.');
  if (anomaly !== undefined && !isUuid(anomaly)) throw bad('anomaly_id : identifiant attendu.');
  return {
    transactionId: tx === undefined ? null : (tx as string),
    anomalyId: anomaly === undefined ? null : (anomaly as string),
  };
}

export interface ListFilters {
  accountId: string | null;
  matched: boolean | null;
}

export function parseListFilters(accountId: unknown, matched: unknown): ListFilters {
  if (accountId !== undefined && accountId !== '' && !isUuid(accountId))
    throw bad('account_id : identifiant attendu.');
  if (matched !== undefined && matched !== 'true' && matched !== 'false')
    throw bad('matched : true ou false attendu.');
  return {
    accountId: accountId === undefined || accountId === '' ? null : (accountId as string),
    matched: matched === undefined ? null : matched === 'true',
  };
}

export interface LineCursor {
  d: string;
  i: string;
}

export function parseLineCursor(raw: string | undefined): LineCursor | null {
  if (raw === undefined || raw === '') return null;
  if (raw.length > 256) throw bad('cursor : curseur invalide.');
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      typeof v.d === 'string' &&
      isIsoDate(v.d) &&
      typeof v.i === 'string' &&
      /^[0-9]{1,18}$/.test(v.i)
    )
      return { d: v.d, i: v.i };
  } catch {
    // illisible : refusé ci-dessous
  }
  throw bad('cursor : curseur invalide.');
}

export const encodeLineCursor = (row: { value_date: string; id: string }): string =>
  Buffer.from(JSON.stringify({ d: row.value_date, i: row.id })).toString('base64url');

/** Colonnes lues, dans l'ordre attendu par `toStatementLine` (alias `e`). */
export const LINE_COLUMNS = `e.id::text, e.ledger_id, e.account_id, e.statement_import_id, e.source,
  e.external_ref, e.value_date::text, e.amount::text, e.currency, e.matched_tx_id, e.matched_anomaly_id,
  e.matched_by, e.matched_at`;

export interface LineRow {
  id: string;
  ledger_id: string;
  account_id: string;
  statement_import_id: string | null;
  source: string;
  external_ref: string;
  value_date: string;
  amount: string;
  currency: string | null;
  matched_tx_id: string | null;
  matched_anomaly_id: string | null;
  matched_by: string | null;
  matched_at: Date | null;
}

/** UN mapper : jamais `operator_id`. `ledgerCurrency` couvre les lignes d'avant la colonne `currency`. */
export function toStatementLine(row: LineRow, ledgerCurrency: string): StatementLine {
  return {
    statement_line_id: Number(row.id),
    ledger_id: row.ledger_id,
    account_id: row.account_id,
    statement_import_id: row.statement_import_id,
    source: row.source,
    external_ref: row.external_ref,
    value_date: row.value_date,
    amount: Number(row.amount),
    currency: (row.currency ?? ledgerCurrency).trim() as StatementLine['currency'],
    matched: row.matched_tx_id !== null || row.matched_anomaly_id !== null,
    matched_transaction_id: row.matched_tx_id,
    matched_anomaly_id: row.matched_anomaly_id,
    matched_by: row.matched_by,
    matched_at: row.matched_at ? row.matched_at.toISOString() : null,
  };
}
