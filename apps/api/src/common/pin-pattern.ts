// Motif du PIN d'un vendeur (contracts/vendors.md) : module NEUTRE, sans argon2 ni secret, pour que
// `vendors/` (validation du corps) ne charge ni `vendor-pin.hasher` ni argon2 (mission 11a, OP-N159 c).
/** Exactement 6 chiffres. */
export const PIN_PATTERN = /^[0-9]{6}$/;
