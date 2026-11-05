// Vérification d'un brouillon READY avant toute signature (WP13, T054 ; contracts/snapshots.md « En-tête signé » et
// « Contenu »). Fonction PURE : aucune base, aucun service de clés, aucune horloge cachée. Elle recalcule
// `content_sha256` PAR ELLE-MÊME (RFC 8785, `canonicalize`), sans importer l'empreinte du producteur (WP11) : deux
// codes distincts qui doivent s'accorder sur les mêmes vecteurs fixes.
// Le résultat `ok: true` est la SEULE valeur que `header-signer.ts` accepte (type marqué `VerifiedDraft`).
// Une raison de rejet est un code court : elle ne cite jamais une valeur d'entrée (jeton, empreinte, identifiant).
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { SLICE_ROWS, yieldToLoop } from '../processes/cooperative';

export const SNAPSHOT_FORMAT = 'CASHLESS-SNAPSHOT/v1';

export const HEADER_FIELDS = [
  'authority_epoch',
  'base_version',
  'content_sha256',
  'currency',
  'entries',
  'event_id',
  'format',
  'generated_at',
  'key_id',
  'kind',
  'ledger_id',
  'operator_id',
  'removed',
  'valid_until',
  'version',
] as const;

export const ENTRY_KEYS = [
  'batch_event_id',
  'batch_status',
  'key_index',
  'last_counter',
  'nfc_uid',
  'originality_sig_sha256',
  'pwd_pack_sha256',
  'spendable',
  'status',
  'token_hash',
  'wallet_status',
] as const;

/** Brouillon lu par `offline_snapshot_drafts_ready()` (colonnes de la base, entiers en `bigint`). */
export interface DraftRow {
  id: bigint;
  operatorId: string;
  ledgerId: string;
  kind: string;
  baseVersion: bigint | null;
  version: bigint;
  header: unknown;
}

/** Ligne de `offline_snapshot_draft_content()` : `tokenHash` en hex minuscule (converti depuis `bytea`). */
export interface ContentRow {
  tokenHash: string;
  entry: unknown;
  removed: boolean;
}

declare const VERIFIED: unique symbol;

export type SnapshotHeader = Record<(typeof HEADER_FIELDS)[number], unknown>;

/** Brouillon vérifié : seul `verifyDraft` en produit. `header-signer.ts` n'accepte rien d'autre. */
export interface VerifiedDraft {
  readonly [VERIFIED]: true;
  readonly draftId: bigint;
  readonly operatorId: string;
  readonly keyId: string;
  readonly header: Readonly<SnapshotHeader>;
}

export type Verdict = { ok: true; verified: VerifiedDraft } | { ok: false; reason: string };

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** `SHA-256(JCS({"entries": [...], "removed_token_hashes": [...]}))`, en hex minuscule. */
export function contentSha256(entries: unknown[], removedTokenHashes: string[]): string {
  const canonical = canonicalize({ entries, removed_token_hashes: removedTokenHashes });
  if (canonical === undefined) throw new Error('Contenu non canonicalisable');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Même empreinte que `contentSha256`, par tranches (voir `verifyDraftCooperative`). Volontairement recopiée ici et non
 * importée du producteur (WP11) : le signataire recalcule PAR LUI-MÊME. Les entrées arrivent déjà triées (ORDER vérifié).
 */
async function contentSha256Sliced(
  entries: unknown[],
  removedTokenHashes: string[],
): Promise<string> {
  const removed = canonicalize(removedTokenHashes);
  if (removed === undefined) throw new Error('Contenu non canonicalisable');
  const hash = createHash('sha256');
  hash.update('{"entries":[', 'utf8');
  for (let from = 0; from < entries.length; from += SLICE_ROWS) {
    const texts = entries.slice(from, from + SLICE_ROWS).map((entry) => {
      const text = canonicalize(entry);
      if (text === undefined) throw new Error('Contenu non canonicalisable');
      return text;
    });
    hash.update((from > 0 ? ',' : '') + texts.join(','), 'utf8');
    await yieldToLoop();
  }
  hash.update(`],"removed_token_hashes":${removed}}`, 'utf8');
  return hash.digest('hex');
}

const fail = (reason: string): Verdict => ({ ok: false, reason });

function headerReason(header: unknown, draft: DraftRow, now: Date): string | null {
  if (!isObject(header)) return 'HEADER_NOT_OBJECT';
  for (const field of HEADER_FIELDS) if (!(field in header)) return `HEADER_MISSING:${field}`;
  for (const field of Object.keys(header))
    if (!(HEADER_FIELDS as readonly string[]).includes(field)) return 'HEADER_EXTRA_FIELD';
  if (header.format !== SNAPSHOT_FORMAT) return 'HEADER_FORMAT';
  if (header.kind !== 'FULL' && header.kind !== 'DELTA') return 'HEADER_KIND';
  if (header.kind !== draft.kind) return 'HEADER_KIND_MISMATCH';
  for (const field of ['operator_id', 'ledger_id', 'event_id'] as const)
    if (typeof header[field] !== 'string' || !UUID.test(header[field]))
      return `HEADER_TYPE:${field}`;
  if (header.operator_id !== draft.operatorId) return 'HEADER_OPERATOR_MISMATCH';
  if (header.ledger_id !== draft.ledgerId) return 'HEADER_LEDGER_MISMATCH';
  if (typeof header.currency !== 'string' || header.currency === '') return 'HEADER_TYPE:currency';
  if (typeof header.key_id !== 'string' || header.key_id === '') return 'HEADER_TYPE:key_id';
  for (const field of ['version', 'authority_epoch', 'entries', 'removed'] as const)
    if (!isCount(header[field])) return `HEADER_TYPE:${field}`;
  if (BigInt(header.version as number) !== draft.version) return 'HEADER_VERSION_MISMATCH';
  if ((header.version as number) < 1) return 'HEADER_VERSION';
  if (header.kind === 'FULL') {
    if (header.base_version !== null || draft.baseVersion !== null) return 'BASE_VERSION_FULL';
  } else if (
    !isCount(header.base_version) ||
    BigInt(header.base_version) !== draft.version - 1n ||
    draft.baseVersion !== draft.version - 1n
  ) {
    return 'BASE_VERSION_DELTA';
  }
  for (const field of ['generated_at', 'valid_until'] as const)
    if (typeof header[field] !== 'string' || !TIMESTAMP.test(header[field]))
      return `HEADER_TYPE:${field}`;
  const generated = Date.parse(header.generated_at as string);
  const validUntil = Date.parse(header.valid_until as string);
  if (Number.isNaN(generated) || Number.isNaN(validUntil)) return 'HEADER_DATE';
  if (validUntil <= generated) return 'VALIDITY_ORDER';
  if (validUntil <= now.getTime()) return 'VALIDITY_EXPIRED';
  if (typeof header.content_sha256 !== 'string' || !HEX64.test(header.content_sha256))
    return 'HEADER_TYPE:content_sha256';
  return null;
}

interface Scan {
  entries: unknown[];
  removed: string[];
  seen: Set<string>;
  previous: string;
}

const newScan = (): Scan => ({ entries: [], removed: [], seen: new Set(), previous: '' });

/** Vérifie des lignes à la suite de celles déjà vues (`scan`) ; rend la raison du rejet, ou null. */
function scanRows(rows: readonly ContentRow[], scan: Scan): string | null {
  for (const row of rows) {
    if (!HEX64.test(row.tokenHash)) return 'TOKEN_HASH_SHAPE';
    if (scan.seen.has(row.tokenHash)) return 'DUPLICATE_TOKEN';
    if (row.tokenHash <= scan.previous) return 'ORDER';
    scan.seen.add(row.tokenHash);
    scan.previous = row.tokenHash;
    if (row.removed) {
      if (row.entry !== null && row.entry !== undefined) return 'REMOVED_WITH_ENTRY';
      scan.removed.push(row.tokenHash);
      continue;
    }
    if (!isObject(row.entry)) return 'ENTRY_SHAPE';
    const keys = Object.keys(row.entry).sort();
    if (keys.length !== ENTRY_KEYS.length || keys.some((key, i) => key !== ENTRY_KEYS[i]))
      return 'ENTRY_KEYS';
    if (row.entry.token_hash !== row.tokenHash) return 'ENTRY_TOKEN_MISMATCH';
    for (const value of Object.values(row.entry))
      if (typeof value === 'number' && !Number.isSafeInteger(value)) return 'ENTRY_NUMBER';
    scan.entries.push(row.entry);
  }
  return null;
}

function countsReason(scan: Scan, header: Record<string, unknown>): string | null {
  if (scan.entries.length !== header.entries) return 'COUNT_ENTRIES';
  if (scan.removed.length !== header.removed) return 'COUNT_REMOVED';
  return null;
}

function contentReason(
  rows: ContentRow[],
  header: Record<string, unknown>,
): { reason: string } | { entries: unknown[]; removed: string[] } {
  const scan = newScan();
  const reason = scanRows(rows, scan) ?? countsReason(scan, header);
  return reason === null ? { entries: scan.entries, removed: scan.removed } : { reason };
}

const verdictOf = (draft: DraftRow, header: Record<string, unknown>): Verdict => ({
  ok: true,
  verified: Object.freeze({
    draftId: draft.id,
    operatorId: draft.operatorId,
    keyId: header.key_id as string,
    header: Object.freeze({ ...header }) as SnapshotHeader,
  }) as unknown as VerifiedDraft,
});

/**
 * Vérifie un brouillon `READY` : l'en-tête (quinze champs, format, genre, base, validité, accord avec les colonnes
 * du brouillon), le contenu (onze clés exactes, ordre, doublons, comptes) et l'empreinte recalculée. `now` sert à
 * refuser un en-tête déjà périmé : un snapshot périmé signé n'est jamais servi.
 */
export function verifyDraft(draft: DraftRow, rows: ContentRow[], now: Date): Verdict {
  const bad = headerReason(draft.header, draft, now);
  if (bad !== null) return fail(bad);
  const header = draft.header as Record<string, unknown>;
  const content = contentReason(rows, header);
  if ('reason' in content) return fail(content.reason);
  if (contentSha256(content.entries, content.removed) !== header.content_sha256)
    return fail('CONTENT_SHA256');
  return verdictOf(draft, header);
}

/**
 * Mêmes contrôles et même verdict que `verifyDraft`, en rendant la main à la boucle d'événements entre deux
 * tranches de lignes (NFR-005 : un FULL de 50 000 entrées ne doit pas retarder la signature d'un blocage d'un autre
 * grand livre). Seul l'ordonnancement change.
 */
export async function verifyDraftCooperative(
  draft: DraftRow,
  rows: ContentRow[],
  now: Date,
): Promise<Verdict> {
  const bad = headerReason(draft.header, draft, now);
  if (bad !== null) return fail(bad);
  const header = draft.header as Record<string, unknown>;
  const scan = newScan();
  for (let from = 0; from < rows.length; from += SLICE_ROWS) {
    const reason = scanRows(rows.slice(from, from + SLICE_ROWS), scan);
    if (reason !== null) return fail(reason);
    await yieldToLoop();
  }
  const counts = countsReason(scan, header);
  if (counts !== null) return fail(counts);
  if ((await contentSha256Sliced(scan.entries, scan.removed)) !== header.content_sha256)
    return fail('CONTENT_SHA256');
  return verdictOf(draft, header);
}
