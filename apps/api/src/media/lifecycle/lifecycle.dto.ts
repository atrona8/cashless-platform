// Guichet (contrat : `MediaActivationRequest`, `DepositRequest`, `MediaActivationResponse`,
// `DepositState`, `Media`).
import type { ProblemCode } from '@cashless/contracts';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import {
  dateTimeField,
  enumField,
  intField,
  invalid,
  isUuid,
  objectBody,
} from '../../organization/platform/platform.dto';
import { parseTap, type TapInput } from '../taps/taps.dto';

export const CHANNELS = ['DESK', 'FIRST_TOPUP'] as const;
export const PAYMENT_METHODS = ['CASH', 'WAVE', 'ORANGE_MONEY', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Payment {
  method: PaymentMethod;
}

export interface ActivationInput {
  tap: TapInput | null;
  channel: (typeof CHANNELS)[number];
  walletId: string | null;
  customerId: string | null;
  depositPayment: Payment | null;
  occurredAt: Date;
}

function payment(raw: unknown, name: string): Payment | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw invalid(`${name} : moyen de paiement attendu.`);
  return {
    method: enumField(raw as Record<string, unknown>, 'method', PAYMENT_METHODS, 'required')!,
  };
}

function optionalUuid(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw invalid(`${name} : identifiant attendu.`);
  return value;
}

export function parseActivation(raw: unknown): ActivationInput {
  const body = objectBody(raw);
  if (body.tap === undefined || body.tap === null)
    intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional');
  return {
    tap: body.tap === undefined || body.tap === null ? null : parseTap(body.tap),
    channel: enumField(body, 'channel', CHANNELS, 'required')!,
    walletId: optionalUuid(body, 'wallet_id'),
    customerId: optionalUuid(body, 'customer_id'),
    depositPayment: payment(body.deposit_payment, 'deposit_payment'),
    occurredAt: dateTimeField(body, 'occurred_at', 'required')!,
  };
}

export interface DepositInput {
  tapId: number | null;
  tap: TapInput | null;
  payment: Payment | null;
  /** Session de caisse indiquée (facultative) : doit être la session ouverte du terminal. */
  cashSessionId: string | null;
}

export function parseDeposit(raw: unknown): DepositInput {
  const body = raw === undefined || raw === null || raw === '' ? {} : objectBody(raw);
  return {
    tapId: intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional') ?? null,
    tap: body.tap === undefined || body.tap === null ? null : parseTap(body.tap),
    payment: payment(body.payment, 'payment'),
    cashSessionId: parseCashSessionId(body),
  };
}

export interface DepositState {
  status: 'NONE' | 'DUE' | 'HELD' | 'REFUNDED' | 'FORFEITED';
  amount: number;
  mode: 'FROM_BALANCE' | 'SEPARATE' | null;
  transaction_id: string | null;
}

// Refus de règle du guichet, en français et en anglais (NFR-005) ; `rule` est l'identifiant stable
// de la règle.
const RULES: Record<string, Record<Language, string>> = {
  'activation.tap_required': {
    fr: 'tap : l’activation porte la lecture du bracelet (un bracelet jamais activé n’a pas de tap_id).',
    en: 'tap: an activation carries the tap of the wristband (a wristband that was never activated has no tap_id).',
  },
  'activation.wallet_ledger': {
    fr: 'wallet_id : ce portefeuille n’appartient pas au grand livre de l’événement du terminal, ou n’est pas actif.',
    en: 'wallet_id: this wallet does not belong to the ledger of the terminal’s event, or is not active.',
  },
  'activation.customer_unknown': {
    fr: 'customer_id : compte festivalier inconnu.',
    en: 'customer_id: unknown customer account.',
  },
  'deposit.payment_required': {
    fr: 'Caution payée à part : le moyen de paiement est obligatoire.',
    en: 'Separately paid deposit: the payment method is required.',
  },
  'deposit.cash_only': {
    fr: 'Caution payée à part : seules les espèces (CASH) sont acceptées pour l’instant ; les autres moyens arrivent avec les recharges.',
    en: 'Separately paid deposit: only cash (CASH) is accepted for now; other methods come with top-ups.',
  },
  'deposit.tap_required': {
    fr: 'Une caution ne se rend pas sans le bracelet : tap ou tap_id obligatoire.',
    en: 'A deposit is not refunded without the wristband: tap or tap_id is required.',
  },
  'deposit.wrong_media': {
    fr: 'La lecture présentée ne concerne pas ce bracelet.',
    en: 'The presented tap does not belong to this wristband.',
  },
  // Guichet de retour (FR-025 à FR-028) : chaque refus nomme ce qui reste à faire.
  'return.wrong_media': {
    fr: 'La lecture présentée ne concerne pas ce bracelet.',
    en: 'The presented tap does not belong to this wristband.',
  },
  'release.no_chaining': {
    fr: 'refund_deposit_by, settle_balance : le serveur n’enchaîne pas le guichet de retour. Rendre la caution (refundDeposit), les espèces dues (refundCashDue), faire rembourser le solde, puis restituer.',
    en: 'refund_deposit_by, settle_balance: the server does not chain the return desk steps. Refund the deposit (refundDeposit), the cash due (refundCashDue), have the balance refunded, then release.',
  },
  'release.deposit_held': {
    fr: 'Restitution refusée : la caution est encore détenue. La rendre d’abord (refundDeposit).',
    en: 'Release refused: the deposit is still held. Refund it first (refundDeposit).',
  },
  'release.cash_due': {
    fr: 'Restitution refusée : des espèces sont dues au détenteur. Les rendre d’abord (refundCashDue).',
    en: 'Release refused: cash is owed to the holder. Hand it back first (refundCashDue).',
  },
  'release.balance': {
    fr: 'Restitution refusée : un portefeuille du bracelet n’est pas soldé. Faire rembourser ou passer en casse son solde d’abord.',
    en: 'Release refused: a wallet of this wristband still has a balance. Have it refunded or written off first.',
  },
  'reassign.not_pool': {
    fr: 'Remise en stock refusée : seul un bracelet d’un lot réattribuable (POOL) change de détenteur.',
    en: 'Restocking refused: only a wristband from a reassignable batch (POOL) can change holder.',
  },
  'reassign.not_released': {
    fr: 'Remise en stock refusée : le bracelet doit d’abord être restitué (releaseMedia).',
    en: 'Restocking refused: the wristband must be released first (releaseMedia).',
  },
  'reassign.identity_known': {
    fr: 'new_token_hash : cette identité est déjà connue (bracelet en service ou identité passée). Écrire une identité neuve.',
    en: 'new_token_hash: this identity is already known (wristband in service or past identity). Write a fresh identity.',
  },
  'replace.tap_required': {
    fr: 'new_media_tap : le remplacement porte la lecture du bracelet neuf (un bracelet jamais activé n’a pas de tap_id).',
    en: 'new_media_tap: a replacement carries the tap of the new wristband (a wristband that was never activated has no tap_id).',
  },
  'replace.same_media': {
    fr: 'Le bracelet neuf présenté est le bracelet à remplacer.',
    en: 'The new wristband presented is the wristband being replaced.',
  },
  'replace.old_state': {
    fr: 'Remplacement refusé : seul un bracelet actif ou suspendu (déclaré perdu) se remplace.',
    en: 'Replacement refused: only an active or suspended (reported lost) wristband can be replaced.',
  },
  'replace.new_not_fresh': {
    fr: 'Remplacement refusé : le bracelet de remplacement doit être neuf (personnalisé ou remis, jamais activé).',
    en: 'Replacement refused: the replacement wristband must be new (personalized or issued, never activated).',
  },
  'replace.new_deposit': {
    fr: 'Remplacement refusé : le bracelet de remplacement porte déjà une caution.',
    en: 'Replacement refused: the replacement wristband already carries a deposit.',
  },
  'replace.other_organizer': {
    fr: 'Remplacement refusé : le bracelet de remplacement doit appartenir au même organisateur.',
    en: 'Replacement refused: the replacement wristband must belong to the same organizer.',
  },
  'replace.deposit_mode': {
    fr: 'Remplacement refusé : la caution détenue passe au bracelet neuf, qui doit venir d’un lot de même mode de caution.',
    en: 'Replacement refused: the held deposit moves to the new wristband, which must come from a batch with the same deposit mode.',
  },
  'cash_due.nothing': {
    fr: 'Aucune somme en espèces n’est due au détenteur de ce bracelet.',
    en: 'No cash is owed to the holder of this wristband.',
  },
  'cash_due.media_blocked': {
    fr: 'Rendu refusé : ce bracelet n’est pas actif (déclaré perdu ou sur liste noire). Les espèces dues ne se rendent qu’au détenteur d’un bracelet actif.',
    en: 'Refund refused: this wristband is not active (reported lost or blacklisted). Cash due is only handed back to the holder of an active wristband.',
  },
  'cash_due.other_ledger': {
    fr: 'Rendu refusé : ces espèces sont dues au grand livre d’un autre événement que celui de ce terminal. Les rendre au guichet de cet événement.',
    en: 'Refund refused: this cash is owed on the ledger of another event than this terminal’s. Hand it back at a desk of that event.',
  },
  'replace.old_wrong_event': {
    fr: 'Remplacement refusé : le bracelet à remplacer sert un autre événement que celui de ce terminal. Le remplacer au guichet de son événement.',
    en: 'Replacement refused: the wristband being replaced serves another event than this terminal’s. Replace it at a desk of its event.',
  },
  'cash.session_mismatch': {
    fr: 'cash_session_id : ce n’est pas la session de caisse ouverte de ce terminal.',
    en: 'cash_session_id: this is not the open cash session of this terminal.',
  },
};

/** `cash_session_id` facultatif d'un corps : identifiant, sinon `422 VALIDATION_FAILED`. */
export function parseCashSessionId(body: Record<string, unknown>): string | null {
  const value = body.cash_session_id;
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw invalid('cash_session_id : identifiant attendu.');
  return value;
}

export type CounterRule = keyof typeof RULES & string;

/**
 * Refus de règle du guichet ; par défaut 422, ou le code et le statut du contrat pour un refus
 * d'état (409).
 */
export function counterRefusal(
  rule: CounterRule,
  language: Language,
  code: ProblemCode = 'VALIDATION_FAILED',
  status = 422,
  extensions: Record<string, unknown> = {},
): ProblemException {
  return new ProblemException(code, {
    status,
    detail: RULES[rule]![language],
    extensions: { rule, ...extensions },
  });
}
