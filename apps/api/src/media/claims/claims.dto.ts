// Corps des routes de rattachement (contrat `claimMedia`, `confirmMediaClaim`,
// `lookupBalanceByClaimCode`). Un code mal formé est refusé ici, en 400, avant toute recherche :
// il ne compte pas comme un essai.
import { normalizeClaimCode } from '@cashless/tag-format';
import type { Language } from '../../http/language';
import { CommittedProblem } from '../../idempotency/committed-problem';
import { intField, invalid, isUuid, objectBody } from '../../organization/platform/platform.dto';

const DIGITS = /^[0-9]{6}$/;

/** Code imprimé, normalisé (tirets, espaces et casse ignorés) ; mal formé : 400. */
export function claimCodeField(body: Record<string, unknown>): string {
  if (typeof body.claim_code !== 'string') throw invalid('claim_code : texte attendu.');
  try {
    return normalizeClaimCode(body.claim_code);
  } catch {
    throw invalid(
      'claim_code : 10 caractères de l’alphabet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ attendus.',
    );
  }
}

export interface ClaimInput {
  code: string;
  walletId: string | null;
}

export function parseClaim(raw: unknown): ClaimInput {
  const body = objectBody(raw);
  const walletId = body.wallet_id ?? null;
  if (walletId !== null && !isUuid(walletId)) throw invalid('wallet_id : identifiant attendu.');
  return { code: claimCodeField(body), walletId };
}

export interface ConfirmInput {
  tapId: number;
  code: string;
  digits: string;
}

export function parseConfirm(raw: unknown): ConfirmInput {
  const body = objectBody(raw);
  const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'required')!;
  const digits = body.confirmation_code;
  if (typeof digits !== 'string' || !DIGITS.test(digits)) {
    throw invalid('confirmation_code : 6 chiffres attendus.');
  }
  return { tapId, code: claimCodeField(body), digits };
}

/** Bracelet vu par son festivalier (contrat `CustomerMedia`). */
export interface CustomerMedia {
  media_id: string;
  printed_number: null;
  status: string;
  deposit_status: string;
  wallet_id: string | null;
}

// Refus du rattachement par l'app d'un bracelet pas encore activé, en français et en anglais
// (NFR-005).
const RULES: Record<string, Record<Language, string>> = {
  'claim.event_required': {
    fr: 'Ce bracelet sert à plusieurs événements : il s’active au guichet de l’événement.',
    en: 'This wristband serves several events: it is activated at the event desk.',
  },
  'claim.deposit_at_desk': {
    fr: 'Ce bracelet porte une caution payée à part : il s’active au guichet.',
    en: 'This wristband carries a separately paid deposit: it is activated at the desk.',
  },
  'claim.wallet': {
    fr: 'wallet_id : portefeuille d’un autre compte, d’un autre événement, ou inactif.',
    en: 'wallet_id: wallet of another account, of another event, or inactive.',
  },
};

export type ClaimRule = keyof typeof RULES & string;

export function claimRule(
  rule: ClaimRule,
  language: Language,
): { detail: string; extensions: { rule: string } } {
  return { detail: RULES[rule]![language], extensions: { rule } };
}

/**
 * Réponse unique d'un code refusé : inconnu, utilisé, invalidé, lot `POOL` déjà rattaché
 * (NFR-007). Validée avec l'essai que la base vient d'inscrire : sans cela, un refus ne
 * compterait jamais dans les limites.
 */
export const claimInvalid = (): CommittedProblem =>
  new CommittedProblem('MEDIA_CLAIM_INVALID', { status: 422 });
