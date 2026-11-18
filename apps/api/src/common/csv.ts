// CSV commun (RFC 4180, UTF-8) : écriture avec neutralisation des formules, lecture stricte.
// Sans dépendance (R-15). Écriture : fin de ligne CRLF, champ entre guillemets s'il contient
// séparateur, guillemet ou saut de ligne. Lecture : même dialecte, CRLF ou LF, BOM toléré ;
// les en-têtes sont exigés, dans l'ordre des colonnes.

export interface CsvColumn {
  key: string;
  header: string;
  /** `number` : jamais neutralisé (un montant négatif reste `-500`). */
  kind: 'text' | 'number';
}

export interface CsvOptions {
  /** Séparateur (un caractère). Défaut `,` (RFC 4180) ; `;` pour les relevés de la zone. */
  delimiter?: string;
  /** Écriture : préfixe UTF-8 `EF BB BF` (Excel). Défaut `false`. */
  bom?: boolean;
}

export type CsvRow = Record<string, string | number | null | undefined>;

/** Erreur de lecture : `line` est la ligne physique (depuis 1) où commence l'enregistrement. */
export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`ligne ${line} : ${message}`);
    this.name = 'CsvParseError';
  }
}

/** Début de champ qu'un tableur interprète comme une formule. */
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

function delimiterOf(options: CsvOptions | undefined): string {
  const delimiter = options?.delimiter ?? ',';
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') {
    throw new Error('CSV : séparateur invalide');
  }
  return delimiter;
}

function quote(field: string, delimiter: string): string {
  if (field.includes(delimiter) || /["\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

function writeField(
  column: CsvColumn,
  value: string | number | null | undefined,
  d: string,
): string {
  if (value === null || value === undefined) return '';
  if (column.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`CSV : la colonne ${column.key} attend un nombre`);
    }
    return String(value);
  }
  const text = String(value);
  return quote(FORMULA_START.has(text.charAt(0)) ? `'${text}` : text, d);
}

function write(
  rows: readonly CsvRow[],
  columns: readonly CsvColumn[],
  options?: CsvOptions,
): string {
  const d = delimiterOf(options);
  const lines = [columns.map((c) => quote(c.header, d)).join(d)];
  for (const row of rows) {
    lines.push(columns.map((c) => writeField(c, row[c.key], d)).join(d));
  }
  return `${options?.bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

interface RawRecord {
  line: number;
  fields: string[];
}

function tokenize(input: string, d: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endRecord = (): void => {
    fields.push(field);
    // Un enregistrement réduit à un champ vide est une ligne vide : ignorée (finale ou non).
    if (!(fields.length === 1 && fields[0] === '')) records.push({ line: startLine, fields });
    fields = [];
    field = '';
  };
  while (i < input.length) {
    const c = input[i] as string;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        // Après le guillemet fermant : séparateur, fin de ligne ou fin de fichier seulement.
        const next = input[i + 1];
        if (next !== undefined && next !== d && next !== '\n' && next !== '\r') {
          throw new CsvParseError('caractère après un guillemet fermant', startLine);
        }
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
      i += 1;
      continue;
    }
    if (c === '"') {
      if (field !== '') throw new CsvParseError("guillemet au milieu d'un champ", startLine);
      quoted = true;
    } else if (c === d) {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) throw new CsvParseError('guillemet non fermé', startLine);
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

function parse(text: string, columns: readonly CsvColumn[], options?: CsvOptions): CsvRow[] {
  const d = delimiterOf(options);
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const [head, ...body] = tokenize(input, d);
  if (!head) throw new CsvParseError('en-têtes absents', 1);
  const expected = columns.map((c) => c.header);
  if (head.fields.length !== expected.length || head.fields.some((h, k) => h !== expected[k])) {
    throw new CsvParseError(`en-têtes attendus : ${expected.join(d)}`, head.line);
  }
  return body.map((record) => {
    if (record.fields.length !== columns.length) {
      throw new CsvParseError(
        `${record.fields.length} colonnes au lieu de ${columns.length}`,
        record.line,
      );
    }
    const row: CsvRow = {};
    columns.forEach((column, k) => {
      const raw = record.fields[k] as string;
      if (column.kind === 'text') {
        row[column.key] = raw;
        return;
      }
      if (!/^-?[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new CsvParseError(`${column.header} : entier attendu`, record.line);
      }
      row[column.key] = Number(raw);
    });
    return row;
  });
}

export const Csv = { write, parse };
