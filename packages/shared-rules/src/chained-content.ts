// Champs chaînés d'une opération (docs/sync_protocol.md §3.3, prioritaire sur ADR-128 : 11 champs, R-13).
// Point UNIQUE de construction de l'objet dont on prend l'empreinte : les routes en ligne (vente, recharge
// espèces, annulation) et le traitement des lots hors ligne passent toutes par `chainedContent`, de sorte
// qu'une même opération donne la même empreinte au bit près sur tous les canaux.
//
// Valeurs prises TELLES QUELLES (chaînes, objets `tap` et `lines` entiers, propriétés inconnues comprises) :
// aucune normalisation. Jamais un champ d'état (`online_status`, `online_transaction_id`, `online_tap_id`,
// `snapshot_version`, `config_id`, `local_available_before`, `clock`, `état_local`) ni `tap_id`,
// `customer_qr_token`, `vendor_session_id` : seuls les onze noms ci-dessous sont retenus.

export const CHAINED_FIELDS = [
  'seq',
  'type',
  'occurred_at',
  'amount',
  'currency',
  'tap',
  'lines',
  'reverses_seq',
  'reverses_transaction_id',
  'online_operation',
  'void_reason',
] as const;

/**
 * `seq` en nombre JSON : seulement un entier sûr (<= 2^53 - 1). Au-delà, JCS ne représente pas exactement
 * l'entier : c'est une erreur de programmation (la couche d'entrée a déjà refusé le numéro).
 */
function seqToJson(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('chainedContent : seq hors des entiers sûrs');
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error('chainedContent : seq doit être un entier sûr (bigint ou nombre)');
}

/** Sous-ensemble chaîné de `op` (champs absents ou `undefined` omis ; autres champs jamais retenus). */
export function chainedContent(op: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of CHAINED_FIELDS) {
    const value = op[field];
    if (value === undefined) continue;
    out[field] = field === 'seq' ? seqToJson(value) : value;
  }
  return out;
}
