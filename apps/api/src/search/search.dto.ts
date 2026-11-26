// Entrées et sorties des trois recherches du back-office (mission routes-backoffice, WP08 ; contrat `searchMedia`,
// `getWalletOverview`, `searchCustomerByPhone`). Aucun message d'erreur ne reprend la valeur reçue : le numéro et
// le code imprimé n'apparaissent dans aucune réponse d'erreur ni journal.
import { ProblemException } from '../errors/problem';

const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const unprocessable = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

/** E.164 strict : `+`, un chiffre de 1 à 9, puis 7 à 14 chiffres. Ni espace, ni préfixe, ni joker. */
const E164 = /^\+[1-9][0-9]{7,14}$/;
const NFC_UID = /^[0-9a-f]{14}$/i;

export type MediaCriterion =
  | { kind: 'nfc_uid'; uid: string }
  | { kind: 'printed_code'; code: string };

/** Un seul des deux critères, exact : aucun ou les deux, une valeur mal formée ou répétée : `400`. */
export function parseMediaQuery(query: Record<string, unknown>): MediaCriterion {
  const { nfc_uid: uid, printed_code: code } = query;
  if ((uid === undefined) === (code === undefined))
    throw invalid('Un seul critère attendu : nfc_uid ou printed_code.');
  if (uid !== undefined) {
    if (typeof uid !== 'string' || !NFC_UID.test(uid))
      throw invalid('nfc_uid : 7 octets en hexadécimal attendus.');
    return { kind: 'nfc_uid', uid: uid.toLowerCase() };
  }
  if (typeof code !== 'string' || code.length < 1 || code.length > 64)
    throw invalid('printed_code : texte de 1 à 64 caractères attendu.');
  return { kind: 'printed_code', code };
}

/** Corps de `searchCustomerByPhone` : `{ phone }`, E.164 strict, rien d'autre. */
export function parsePhoneBody(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON attendu.');
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'phone')) throw invalid('Champ inconnu.');
  if (body.phone === undefined) throw invalid('Champ obligatoire : phone.');
  if (typeof body.phone !== 'string' || !E164.test(body.phone))
    throw unprocessable('phone : numéro E.164 exact attendu.');
  return body.phone;
}

export interface WalletOverview {
  wallet_id: string;
  status: string;
  event_id: string;
  currency: string;
  paid_balance: number;
  promo_balance: number;
  deposit: number;
  media: Array<{ media_id: string; status: string; printed_number: string | null }>;
  customer_ref: string | null;
}

export interface MediaSearchResult {
  media_id: string;
  status: string;
  event_id: string | null;
  wallet_id: string | null;
  printed_number: string | null;
  paid_balance: number | null;
  promo_balance: number | null;
  deposit: number | null;
}

export interface CustomerSearchResult {
  masked_phone: string;
  wallets: WalletOverview[];
}
