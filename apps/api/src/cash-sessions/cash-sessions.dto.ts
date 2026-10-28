// Corps et réponses des sessions de caisse (mission 6, lot WP08, T037 à T040 ; contrat `CashSession`).
// Comptage à l'aveugle : la vue `AGENT` n'a JAMAIS `expected_amount` ni `difference` (clés présentes, valeur
// `null`, forme du contrat) ; la vue `MANAGER` ne les rend qu'une fois la session `CLOSED`.
import { isUuid, objectBody, unprocessable } from '../organization/platform/platform.dto';

/** Vue d'une session : `AGENT` = `CASHIER` ; `MANAGER` = `SUPERVISOR` ou `ORGANIZER_ADMIN` de l'événement. */
export type CashSessionView = 'AGENT' | 'MANAGER';

/** Note d'un comptage : la base accepte 200 caractères au plus (contrat : 500, la plus stricte l'emporte). */
export const NOTE_MAX = 200;

export interface CashSessionRow {
  cash_session_id: string;
  cash_account_id: string;
  event_id: string;
  device_id: string;
  opened_by: string;
  opened_at: Date;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  closed_by: string | null;
  closed_at: Date | null;
  counted_amount: string | null;
  expected_amount: string | null;
  close_tx_id: string | null;
  cash_diff_anomaly_id: string | null;
  last_count_amount: string | null;
  last_count_at: Date | null;
  last_count_by: string | null;
}

export interface CashSessionDto {
  cash_session_id: string;
  cash_account_id: string;
  device_id: string;
  status: 'OPEN' | 'CLOSED';
  opened_by: string;
  opened_at: string;
  last_count: { counted_amount: number; counted_at: string; counted_by: string } | null;
  closed_at: string | null;
  closed_by: string | null;
  counted_amount: number | null;
  expected_amount: number | null;
  cash_close_transaction_id: string | null;
  difference: number | null;
  cash_diff_anomaly_id: string | null;
}

const num = (value: string | null): number | null => (value === null ? null : Number(value));

export function toDto(row: CashSessionRow, view: CashSessionView): CashSessionDto {
  // `CLOSING` n'existe que dans la transaction de fermeture : jamais visible après validation.
  const closed = row.status === 'CLOSED';
  const revealed = view === 'MANAGER' && closed;
  const counted = num(row.counted_amount);
  const expected = num(row.expected_amount);
  return {
    cash_session_id: row.cash_session_id,
    cash_account_id: row.cash_account_id,
    device_id: row.device_id,
    status: closed ? 'CLOSED' : 'OPEN',
    opened_by: row.opened_by,
    opened_at: row.opened_at.toISOString(),
    last_count:
      row.last_count_amount === null
        ? null
        : {
            counted_amount: Number(row.last_count_amount),
            counted_at: row.last_count_at!.toISOString(),
            counted_by: row.last_count_by!,
          },
    closed_at: closed && row.closed_at ? row.closed_at.toISOString() : null,
    closed_by: closed ? row.closed_by : null,
    counted_amount: closed ? counted : null,
    expected_amount: revealed ? expected : null,
    cash_close_transaction_id: closed ? row.close_tx_id : null,
    difference: revealed && counted !== null && expected !== null ? counted - expected : null,
    cash_diff_anomaly_id: closed ? row.cash_diff_anomaly_id : null,
  };
}

/** Corps d'ouverture : seul `cash_account_id` (facultatif) ; tout autre champ, `device_id` compris : 422. */
export function parseOpen(raw: unknown): { cashAccountId: string | null } {
  const body = bodyOf(raw);
  const foreign = Object.keys(body).filter((key) => key !== 'cash_account_id');
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const id = body.cash_account_id;
  if (id === undefined) return { cashAccountId: null };
  if (!isUuid(id)) throw unprocessable('cash_account_id : UUID attendu.');
  return { cashAccountId: id };
}

export interface CountInput {
  amount: bigint;
  note: string | null;
}

/** Corps de comptage : `counted_amount` entier ≥ 0, `counted_at` ISO (validé, non retenu), `note` facultative. */
export function parseCount(raw: unknown): CountInput {
  const body = bodyOf(raw);
  const foreign = Object.keys(body).filter(
    (key) => !['counted_amount', 'counted_at', 'note'].includes(key),
  );
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const amount = body.counted_amount;
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    Object.is(amount, -0)
  )
    throw unprocessable('counted_amount : entier positif ou nul attendu.');
  const at = body.counted_at;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at)))
    throw unprocessable('counted_at : date-heure ISO 8601 attendue.');
  let note: string | null = null;
  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || body.note.length > NOTE_MAX)
      throw unprocessable(`note : texte de ${NOTE_MAX} caractères au plus.`);
    note = body.note;
  }
  return { amount: BigInt(amount), note };
}

function bodyOf(raw: unknown): Record<string, unknown> {
  // Corps absent (`undefined`/vide) pour l'ouverture : objet vide.
  if (raw === undefined || raw === null) return {};
  try {
    return objectBody(raw);
  } catch {
    throw unprocessable('Corps JSON (objet) attendu.');
  }
}

export interface ListFilter {
  status: 'OPEN' | 'CLOSED' | null;
}

export function parseListStatus(raw: unknown): ListFilter['status'] {
  if (raw === undefined || raw === '') return null;
  if (raw === 'OPEN' || raw === 'CLOSED') return raw;
  throw unprocessable('status : OPEN ou CLOSED attendu.');
}
