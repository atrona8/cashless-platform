// Solde effectif d'un bracelet vu de la passerelle : solde du central plus somme des deltas locaux. Fonction pure,
// en `bigint` (jamais de flottant). La règle de purge des deltas (A26) n'est pas ici : elle vit dans la passerelle.

export interface BalanceParts {
  /** Part payée. */
  paid: bigint;
  /** Part offerte (crédits promotionnels). */
  promo: bigint;
}

export function effectiveBalance(
  central: BalanceParts,
  deltas: readonly BalanceParts[],
): BalanceParts {
  let paid = central.paid;
  let promo = central.promo;
  for (const delta of deltas) {
    paid += delta.paid;
    promo += delta.promo;
  }
  return { paid, promo };
}
