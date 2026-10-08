// Arrondi entier « demi vers l'extérieur » (div_round de moteur_ecritures_reference.py, SPECIFICATION §5.5).

/** num / den arrondi au plus proche, demi s'éloignant de zéro (0,5 → 1 ; −0,5 → −1). `den` strictement positif. */
export function roundDiv(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('roundDiv : dénominateur strictement positif requis');
  const abs = num < 0n ? -num : num;
  let q = abs / den;
  if (2n * (abs % den) >= den) q += 1n;
  return num < 0n ? -q : q;
}

export const BPS_SCALE = 10_000n;
