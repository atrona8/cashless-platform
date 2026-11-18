// Corps de `postLateClaim` (`LateClaimRequest`) et de `postLateAdjustment`
// (`LateAdjustmentRequest`) : champs fermés (un champ étranger est refusé `422`), types stricts.
// Rien n'est tenu de confiance : l'événement et le prestataire sont lus en base (mission 9b, WP10).
import { isValidIban, normalizeIban } from '../common/iban';
import { isUuid, objectBody, unprocessable } from '../organization/platform/platform.dto';
import type { LateClaimProof } from './late-claim-proof';

export const REASON_MIN = 10;
export const REASON_MAX = 2000;
const MSISDN = /^\+[1-9][0-9]{6,14}$/;
const CURRENCY = /^[A-Z]{3}$/;
export const METHODS = ['CASH', 'WAVE', 'ORANGE_MONEY', 'BANK_TRANSFER'] as const;
export type LateClaimMethod = (typeof METHODS)[number];

export interface LateClaimDestination {
  method: LateClaimMethod;
  msisdn?: string;
  iban?: string;
}

export interface LateClaimInput {
  walletId: string;
  amount: bigint;
  currency: string;
  proof: LateClaimProof;
  destination: LateClaimDestination;
  reason: string;
}

export interface LateAdjustmentInput {
  beneficiaryPartyId: string;
  amount: bigint;
  currency: string;
  reason: string;
}

function nested(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw unprocessable(`${name} : objet attendu.`);
  return value as Record<string, unknown>;
}

function onlyFields(raw: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const foreign = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de ${where} : ${foreign.join(', ')}.`);
}

/** Montant entier strictement positif (`Amount`), en `bigint`. */
export function parseAmount(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw unprocessable('amount : entier strictement positif attendu.');
  return BigInt(value);
}

export function parseCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY.test(value))
    throw unprocessable('currency : code à trois lettres majuscules attendu.');
  return value;
}

export function parseReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < REASON_MIN || value.length > REASON_MAX)
    throw unprocessable(`reason : de ${REASON_MIN} à ${REASON_MAX} caractères attendus.`);
  return value.trim();
}

function parseProof(value: unknown): LateClaimProof {
  const p = nested(value, 'proof');
  onlyFields(p, ['kind', 'tap_id'], 'la preuve');
  if (p.kind === 'CUSTOMER_ACCOUNT') {
    if (p.tap_id !== undefined) throw unprocessable('proof : tap_id n’a pas lieu d’être.');
    return { kind: 'CUSTOMER_ACCOUNT' };
  }
  if (p.kind !== 'MEDIA_TAP') throw unprocessable('proof.kind : MEDIA_TAP ou CUSTOMER_ACCOUNT.');
  if (typeof p.tap_id !== 'number' || !Number.isSafeInteger(p.tap_id) || p.tap_id <= 0)
    throw unprocessable('proof.tap_id : entier strictement positif attendu.');
  return { kind: 'MEDIA_TAP', tap_id: p.tap_id };
}

function parseDestination(value: unknown): LateClaimDestination {
  const d = nested(value, 'destination');
  onlyFields(d, ['method', 'msisdn', 'iban'], 'la destination');
  const method = METHODS.find((candidate) => candidate === d.method);
  if (!method) throw unprocessable(`destination.method : ${METHODS.join(', ')}.`);
  const out: LateClaimDestination = { method };
  if (method === 'WAVE' || method === 'ORANGE_MONEY') {
    if (typeof d.msisdn !== 'string' || !MSISDN.test(d.msisdn))
      throw unprocessable('destination.msisdn : numéro international attendu.');
    if (d.iban !== undefined) throw unprocessable('destination : iban n’a pas lieu d’être.');
    out.msisdn = d.msisdn;
  } else if (method === 'BANK_TRANSFER') {
    if (typeof d.iban !== 'string' || !isValidIban(d.iban))
      throw unprocessable('destination.iban : IBAN valide attendu.');
    if (d.msisdn !== undefined) throw unprocessable('destination : msisdn n’a pas lieu d’être.');
    out.iban = normalizeIban(d.iban);
  } else if (d.msisdn !== undefined || d.iban !== undefined) {
    throw unprocessable('destination : ni msisdn ni iban pour un remboursement en espèces.');
  }
  return out;
}

export function parseLateClaimBody(raw: unknown): LateClaimInput {
  const b = objectBody(raw);
  onlyFields(
    b,
    ['wallet_id', 'amount', 'currency', 'proof', 'destination', 'reason'],
    'la demande',
  );
  if (!isUuid(b.wallet_id)) throw unprocessable('wallet_id : identifiant attendu.');
  return {
    walletId: b.wallet_id,
    amount: parseAmount(b.amount),
    currency: parseCurrency(b.currency),
    proof: parseProof(b.proof),
    destination: parseDestination(b.destination),
    reason: parseReason(b.reason),
  };
}

export function parseLateAdjustmentBody(raw: unknown): LateAdjustmentInput {
  const b = objectBody(raw);
  onlyFields(b, ['beneficiary_party_id', 'amount', 'currency', 'reason'], 'la demande');
  if (!isUuid(b.beneficiary_party_id))
    throw unprocessable('beneficiary_party_id : identifiant attendu.');
  return {
    beneficiaryPartyId: b.beneficiary_party_id,
    amount: parseAmount(b.amount),
    currency: parseCurrency(b.currency),
    reason: parseReason(b.reason),
  };
}
