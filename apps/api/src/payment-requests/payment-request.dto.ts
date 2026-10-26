// Corps et réponses des demandes de paiement QR (mission 5b, lot WP13 ; contrats `createPaymentRequest`,
// `payPaymentRequest`, `createCustomerQrToken`, `PaymentRequestObject`).
//
// Règles tenues ici, avant toute écriture :
// - montants lus comme des entiers sûrs ; `lines` : `product_id` requis, `quantity` ≥ 1, `unit_price` ≥ 1 et
//   `amount` = Σ quantité × prix (la base revérifie : `check_sale_lines`) ;
// - le corps ne porte jamais le vendeur, le terminal ni le prestataire (FR-006) ;
// - aucun refus ne recopie un jeton dans `detail` (NFR-008).
import type { components } from '@cashless/contracts';
import { ProblemException } from '../errors/problem';
import { isUuid, objectBody, unprocessable, invalid } from '../organization/platform/platform.dto';
import type { SaleLineInput } from '../payments/payments.dto';

export type PaymentRequestObject = components['schemas']['PaymentRequestObject'];

export const DEFAULT_TTL_SECONDS = 60;
const MAX_LINES = 200;
const MAX_QUANTITY = 2_147_483_647;
const CURRENCY = /^[A-Z]{3}$/;
/** Jeton lu dans le QR : 12 à 64 caractères (contrat). */
const TOKEN_LENGTH = { min: 12, max: 64 };

export interface CreateRequestInput {
  amount: bigint;
  currency: string;
  ttlSeconds: number;
  /** `null` : absent du corps (refusé `409 VENDOR_SESSION_INVALID` par la garde de session). */
  vendorSessionId: string | null;
  /** `null` : le corps n'en porte pas. */
  lines: SaleLineInput[] | null;
}

export interface PayInput {
  token: string;
  walletId: string;
}

function safeInt(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw invalid(`${name} : entier attendu.`);
  if (!Number.isSafeInteger(value) || value < min)
    throw unprocessable(`${name} : entier d’au moins ${min}, au plus 9007199254740991.`);
  return value;
}

export function parseCreateRequest(raw: unknown): CreateRequestInput {
  const body = objectBody(raw);
  const amount = BigInt(safeInt(body.amount, 'amount', 1));
  if (typeof body.currency !== 'string' || !CURRENCY.test(body.currency))
    throw invalid('currency : code ISO 4217 en majuscules attendu.');
  let ttlSeconds = DEFAULT_TTL_SECONDS;
  if (body.ttl_seconds !== undefined) {
    ttlSeconds = safeInt(body.ttl_seconds, 'ttl_seconds', 15);
    if (ttlSeconds > 300) throw unprocessable('ttl_seconds : de 15 à 300 secondes attendues.');
  }
  let vendorSessionId: string | null = null;
  if (body.vendor_session_id !== undefined) {
    if (typeof body.vendor_session_id !== 'string' || !isUuid(body.vendor_session_id))
      throw unprocessable('vendor_session_id : identifiant attendu.');
    vendorSessionId = body.vendor_session_id;
  }
  const lines = body.lines === undefined ? null : parseLines(body.lines, amount);
  return { amount, currency: body.currency, ttlSeconds, vendorSessionId, lines };
}

function parseLines(raw: unknown, amount: bigint): SaleLineInput[] {
  if (!Array.isArray(raw)) throw invalid('lines : tableau attendu.');
  if (raw.length < 1 || raw.length > MAX_LINES)
    throw unprocessable(`lines : de 1 à ${MAX_LINES} lignes attendues.`);
  let sum = 0n;
  const lines = raw.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw invalid(`lines[${index}] : objet attendu.`);
    const line = entry as Record<string, unknown>;
    if (typeof line.product_id !== 'string' || !isUuid(line.product_id))
      throw unprocessable(`lines[${index}].product_id : identifiant d’article requis.`);
    const quantity = safeInt(line.quantity, `lines[${index}].quantity`, 1);
    if (quantity > MAX_QUANTITY) throw unprocessable(`lines[${index}].quantity : trop grande.`);
    const unitPrice = BigInt(safeInt(line.unit_price, `lines[${index}].unit_price`, 1));
    sum += BigInt(quantity) * unitPrice;
    return { productId: line.product_id, quantity, unitPrice };
  });
  if (sum !== amount)
    throw unprocessable(
      'amount : doit être égal à la somme des lignes (quantité × prix unitaire).',
    );
  return lines;
}

/** Jeton du corps : texte de 12 à 64 caractères ; jamais recopié dans un refus. */
export function tokenField(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length < TOKEN_LENGTH.min ||
    value.length > TOKEN_LENGTH.max
  )
    throw invalid(
      `${name} : texte de ${TOKEN_LENGTH.min} à ${TOKEN_LENGTH.max} caractères attendu.`,
    );
  return value;
}

export function parsePay(raw: unknown): PayInput {
  const body = objectBody(raw);
  const token = tokenField(body.token, 'token');
  if (typeof body.wallet_id !== 'string' || !isUuid(body.wallet_id))
    throw unprocessable('wallet_id : identifiant attendu.');
  return { token, walletId: body.wallet_id };
}

export function parseWalletBody(raw: unknown): string {
  const body = objectBody(raw);
  if (typeof body.wallet_id !== 'string' || !isUuid(body.wallet_id))
    throw unprocessable('wallet_id : identifiant attendu.');
  return body.wallet_id;
}

/** `?wait` : entier de 0 à 25 (secondes) ; absent : 0. */
export function parseWait(raw: unknown): number {
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !/^[0-9]{1,2}$/.test(raw) || Number(raw) > 25)
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'wait : entier de 0 à 25 secondes attendu.',
    });
  return Number(raw);
}

/** En-tête `X-Payment-Request-Token` : absent ou de forme fausse, `undefined` (traité comme un jeton faux). */
export function tokenHeader(raw: string | undefined): string | undefined {
  return raw !== undefined && raw.length >= TOKEN_LENGTH.min && raw.length <= TOKEN_LENGTH.max
    ? raw
    : undefined;
}
