// Masque d'un numéro E.164 pour les réponses du back-office (mission routes-backoffice, WP08 ; FR-013, NFR-006).
// `maskPhone('+221771234512') === '+221 77 *** ** 12'` : indicatif, 2 chiffres, 3 étoiles, 2 étoiles, 2 derniers
// chiffres pour un numéro national de 9 chiffres ; tout autre format : indicatif, étoiles, 2 derniers chiffres.
// Le masque ne se calcule que sur le numéro que l'appelant vient de saisir : il n'est jamais relu en base.

/** Longueur de l'indicatif pays (plan E.164 de l'UIT) d'après les premiers chiffres ; 3 chiffres par défaut. */
function countryCodeLength(digits: string): number {
  const first = digits[0]!;
  if (first === '1' || first === '7') return 1;
  const two = Number(digits.slice(0, 2));
  const three = Number(digits.slice(0, 3));
  switch (first) {
    case '2':
      return two === 20 || two === 27 ? 2 : 3;
    case '3':
      return (three >= 350 && three <= 359) || three >= 370 ? 3 : 2;
    case '4':
      return [420, 421, 423].includes(three) ? 3 : 2;
    case '5':
      return two >= 51 && two <= 58 ? 2 : 3;
    case '6':
      return two <= 66 ? 2 : 3;
    case '8':
      return [81, 82, 84, 86].includes(two) ? 2 : 3;
    case '9':
      return [90, 91, 92, 93, 94, 95, 98].includes(two) ? 2 : 3;
    default:
      return 3;
  }
}

/** Masque d'un numéro E.164 valide (`+` puis 8 à 15 chiffres) ; la valeur reçue est supposée déjà validée. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+/, '');
  const cc = digits.slice(0, countryCodeLength(digits));
  const national = digits.slice(cc.length);
  if (national.length === 9) return `+${cc} ${national.slice(0, 2)} *** ** ${national.slice(-2)}`;
  // Autre format : on ne montre les 2 derniers chiffres que si le numéro est assez long pour ne pas se livrer.
  const shown = national.length >= 6 ? national.slice(-2) : '';
  return `+${cc} ${'*'.repeat(national.length - shown.length)}${shown ? ` ${shown}` : ''}`;
}
