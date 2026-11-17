// IBAN : normalisation, validation (ISO 13616 : longueur par pays, puis modulo 97 de l'ISO 7064)
// et masque. Aucune dépendance (R-15). Table des longueurs : registre IBAN, pays de la zone
// d'exploitation compris.

/** Longueur totale d'un IBAN par code pays. Un pays absent de la table est invalide. */
// prettier-ignore
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28,
  CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18,
  FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22,
  IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
  NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31,
  SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29,
  VA: 22, VG: 24, XK: 20, YE: 30,
  // Afrique de l'Ouest et du Centre, Maghreb (zone d'exploitation).
  BF: 28, BJ: 28, CF: 27, CG: 27, CI: 28, CM: 27, CV: 25, DZ: 26, GA: 27, GQ: 27, GW: 25, KM: 27,
  MA: 28, MG: 27, ML: 28, NE: 28, SN: 28, TD: 27, TG: 28,
};

/** Retire espaces et tirets, passe en majuscules. Ne valide rien. */
export function normalizeIban(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Reste modulo 97 de la chaîne alphanumérique, calculé par morceaux (jamais de grand entier). */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(`${remainder}${digits.slice(i, i + 7)}`) % 97;
  }
  return remainder;
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (length === undefined || iban.length !== length) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let digits = '';
  for (const char of rearranged) {
    // Chiffres inchangés, lettres A à Z remplacées par 10 à 35.
    digits += char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
  }
  return mod97(digits) === 1;
}

/**
 * Masque pour l'audit et les journaux : code pays, deux chiffres de contrôle et quatre derniers
 * caractères visibles (`SN08************3035`). Une valeur trop courte est masquée en entier.
 */
export function maskIban(value: string): string {
  const iban = normalizeIban(value);
  if (iban.length <= 8) return '*'.repeat(iban.length);
  return `${iban.slice(0, 4)}${'*'.repeat(iban.length - 8)}${iban.slice(-4)}`;
}
