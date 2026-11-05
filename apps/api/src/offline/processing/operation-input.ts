// Lecture typée d'une opération de lot (mission 7, lot WP19 ; contracts/batches.md « Traitement d'une opération »).
// L'objet `raw` est l'opération TELLE QUE REÇUE : aucune valeur n'est crue sans contrôle de forme, et un champ
// d'état invalide devient « absent » (la conformité refuse alors l'opération : un fait absent REFUSE, jamais l'inverse).
// Un champ chaîné mal formé rend l'opération `MALFORMED_OPERATION` ; rien de ce que le terminal écrit n'est recopié
// dans un résultat ni dans une anomalie.
import { parseTap, type TapInput } from '../../media/taps/taps.dto';
import type { ParsedOperation } from '../batches/batch.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
export const ONLINE_STATUSES = ['NOT_ATTEMPTED', 'CONFIRMED', 'UNKNOWN', 'REJECTED'] as const;
export type OnlineStatus = (typeof ONLINE_STATUSES)[number];

/** Champs d'une opération utiles au traitement (tous facultatifs : chaque type n'en lit que quelques-uns). */
export interface OperationFields {
  /** `occurred_at` tel que reçu (chaîne), ou `null` s'il manque ou n'en est pas une. */
  occurredAt: string | null;
  /** Montant en plus petite unité, `null` si absent ou invalide. */
  amount: bigint | null;
  currency: string | null;
  /** Lecture embarquée lisible (`pack_verified` à part : un faux n'est PAS une erreur de forme, c'est un rejet). */
  tap: TapInput | null;
  /** `tap` présent mais illisible. */
  tapMalformed: boolean;
  packVerified: boolean;
  snapshotVersion: bigint | null;
  configId: bigint | null;
  onlineTapId: string | null;
  vendorSessionId: string | null;
  onlineStatus: OnlineStatus | null;
  onlineTransactionId: string | null;
  reversesSeq: bigint | null;
  reversesTransactionId: string | null;
  /** Lignes de la vente, telles que reçues (contrôlées par la base : `check_sale_lines`). */
  lines: unknown[] | null;
}

const safeInt = (value: unknown, min: number): bigint | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? BigInt(value) : null;

const uuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

/** Lit les champs d'une opération. Ne lève jamais. */
export function readFields(op: ParsedOperation): OperationFields {
  const raw = op.raw;
  let tap: TapInput | null = null;
  let tapMalformed = false;
  let packVerified = false;
  if (raw.tap !== undefined && raw.tap !== null) {
    const body = raw.tap;
    if (typeof body !== 'object' || Array.isArray(body)) {
      tapMalformed = true;
    } else {
      packVerified = (body as Record<string, unknown>).pack_verified === true;
      try {
        // `parseTap` refuse `pack_verified` faux (route en ligne) : hors ligne c'est un rejet de conformité
        // (`PACK_NOT_VERIFIED`, contrôle 9), pas une erreur de forme.
        tap = parseTap({ ...(body as Record<string, unknown>), pack_verified: true });
      } catch {
        tapMalformed = true;
      }
    }
  }
  const status = ONLINE_STATUSES.find((s) => s === raw.online_status) ?? null;
  const tapId = safeInt(raw.online_tap_id, 1);
  return {
    occurredAt: typeof raw.occurred_at === 'string' ? raw.occurred_at : null,
    amount: safeInt(raw.amount, 1),
    currency: typeof raw.currency === 'string' && CURRENCY.test(raw.currency) ? raw.currency : null,
    tap,
    tapMalformed,
    packVerified,
    snapshotVersion: safeInt(raw.snapshot_version, 1),
    configId: safeInt(raw.config_id, 1),
    onlineTapId: tapId === null ? null : tapId.toString(),
    vendorSessionId: uuid(raw.vendor_session_id),
    onlineStatus: status,
    onlineTransactionId: uuid(raw.online_transaction_id),
    reversesSeq: safeInt(raw.reverses_seq, 1),
    reversesTransactionId: uuid(raw.reverses_transaction_id),
    lines: Array.isArray(raw.lines) ? (raw.lines as unknown[]) : null,
  };
}

/** Montant à porter dans une anomalie : celui de l'opération s'il est lisible, sinon 0. */
export const anomalyAmount = (fields: OperationFields): bigint => fields.amount ?? 0n;
