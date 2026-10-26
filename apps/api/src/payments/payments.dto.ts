// Corps de `createPayment` et réponse `PaymentResult` (mission 5b, lot WP11, T048 à T050 ; contrat
// `PaymentRequestBody`, `PaymentResult`, `SaleLine` ; contracts/payments.md).
//
// Règles tenues ici (avant toute écriture) :
// - exactement un moyen parmi `tap`, `tap_id`, `customer_qr_token`, `payment_intent_id` ; ce dernier est V2
//   (C-007) : `422 DEVICE_MODE_NOT_ALLOWED` ;
// - montants lus comme des entiers sûrs puis tenus en `bigint` (aucun flottant, aucun montant fractionnaire) ;
// - `lines`, si présentes : `product_id` requis, `quantity` ≥ 1, `unit_price` ≥ 1 et `amount` = Σ quantity ×
//   unit_price, sinon `422 VALIDATION_FAILED` (la base revérifie : `check_sale_lines`) ;
// - le corps ne porte jamais le vendeur, le canal, le terminal ni le prestataire : ils viennent de la session
//   et de l'identité prouvée (FR-006). Un champ de ce genre reçu est ignoré.
// - aucun refus ne recopie un jeton QR dans `detail` (NFR-008).
import type { components } from '@cashless/contracts';
import { ProblemException } from '../errors/problem';
import { parseTap, type TapInput } from '../media/taps/taps.dto';
import {
  dateTimeField,
  invalid,
  isUuid,
  objectBody,
  unprocessable,
} from '../organization/platform/platform.dto';

export type PaymentResult = components['schemas']['PaymentResult'];

/** Moyen de paiement présenté (exactement un). */
export type PaymentMeans =
  | { kind: 'tap'; tap: TapInput }
  | { kind: 'tap_id'; tapId: bigint }
  | { kind: 'customer_qr'; token: string };

export interface SaleLineInput {
  productId: string;
  quantity: number;
  unitPrice: bigint;
}

export interface PaymentInput {
  amount: bigint;
  currency: string;
  occurredAt: Date;
  /** `null` : absent du corps (le contrat le refuse en `409 VENDOR_SESSION_INVALID`, par la garde de session). */
  vendorSessionId: string | null;
  means: PaymentMeans;
  /** `null` : le corps n'en porte pas. */
  lines: SaleLineInput[] | null;
}

const MEANS_FIELDS = ['tap', 'tap_id', 'customer_qr_token', 'payment_intent_id'] as const;
const MAX_LINES = 200;
const MAX_QUANTITY = 2_147_483_647;
const CURRENCY = /^[A-Z]{3}$/;

/** Entier sûr ≥ min : le JSON ne porte pas de grand entier exact au-delà de 2^53 − 1. */
function safeInt(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw invalid(`${name} : entier attendu.`);
  if (!Number.isSafeInteger(value) || value < min)
    throw unprocessable(`${name} : entier d’au moins ${min}, au plus 9007199254740991.`);
  return value;
}

export function parsePayment(raw: unknown): PaymentInput {
  const body = objectBody(raw);
  const presented = MEANS_FIELDS.filter((field) => body[field] !== undefined);
  if (presented.length === 1 && presented[0] === 'payment_intent_id')
    throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
      detail: 'payment_intent_id : paiement par intention d’un POS tiers non disponible (V2).',
    });
  if (presented.length !== 1)
    throw unprocessable(
      'Exactement un moyen de paiement attendu parmi tap, tap_id et customer_qr_token.',
    );

  const amount = BigInt(safeInt(body.amount, 'amount', 1));
  if (typeof body.currency !== 'string' || !CURRENCY.test(body.currency))
    throw invalid('currency : code ISO 4217 en majuscules attendu.');
  const occurredAt = dateTimeField(body, 'occurred_at', 'required')!;

  let vendorSessionId: string | null = null;
  if (body.vendor_session_id !== undefined) {
    if (typeof body.vendor_session_id !== 'string' || !isUuid(body.vendor_session_id))
      throw unprocessable('vendor_session_id : identifiant attendu.');
    vendorSessionId = body.vendor_session_id;
  }

  let means: PaymentMeans;
  if (presented[0] === 'tap') means = { kind: 'tap', tap: parseTap(body.tap) };
  else if (presented[0] === 'tap_id')
    means = { kind: 'tap_id', tapId: BigInt(safeInt(body.tap_id, 'tap_id', 1)) };
  else {
    const token = body.customer_qr_token;
    // Aucun écho du jeton dans le refus (NFR-008).
    if (typeof token !== 'string' || token.length < 12 || token.length > 64)
      throw invalid('customer_qr_token : texte de 12 à 64 caractères attendu.');
    means = { kind: 'customer_qr', token };
  }

  const lines = body.lines === undefined ? null : parseLines(body.lines, amount);
  return { amount, currency: body.currency, occurredAt, vendorSessionId, means, lines };
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

/** Lignes pour `record_sale_lines` : les trois champs lus par la base, en un seul `jsonb` (aucune requête par ligne). */
export function linesJson(lines: readonly SaleLineInput[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      product_id: l.productId,
      quantity: l.quantity,
      unit_price: Number(l.unitPrice),
    })),
  );
}
