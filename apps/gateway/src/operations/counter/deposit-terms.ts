// Conditions de caution et de frais d'un bracelet, lues dans `edge_terms` répliqué (décision 36,
// ADR-172 : `activation_fee`, `deposit_batches`). Tout ce qui manque est « inconnu » et les chemins
// qui en dépendent REFUSENT (`409 CONFLICT_STATE`, `DEPOSIT_TERMS_UNKNOWN`, rien d'écrit) : échec
// fermé. Deux limites assumées, signalées au porteur :
//  * le flux ne porte pas le lot d'un bracelet (`batch_id` absent d'`EdgeUnassignedMedia`) : les
//    conditions ne sont servies que si le bracelet porte un lot connu, OU si tous les lots de
//    l'événement ont les mêmes conditions (alors le lien est sans objet) ;
//  * le flux ne porte pas l'état de la caution d'un bracelet déjà activé (`DUE`/`HELD`) : seule
//    l'activation (caution forcément due) est servie, la prise de caution d'un bracelet actif
//    refuse.
import type { TxClient } from '../../db/gateway-tx';

export type DepositStatus = 'NONE' | 'DUE' | 'HELD' | 'REFUNDED' | 'FORFEITED';

export interface DepositTerms {
  /** Montant de la caution du lot, en unités mineures (0 : aucune caution). */
  depositAmount: bigint;
  depositStatus: DepositStatus;
  /** Frais d'activation prélevés sur le solde (0 : aucun). */
  activationFeeFromBalance: bigint;
}

export interface DepositTermsPort {
  lookup(
    tx: TxClient,
    media: { mediaId: string; batchId: string | null; mediaStatus: string },
  ): Promise<DepositTerms | null>;
}
export const DEPOSIT_TERMS = Symbol('DEPOSIT_TERMS');

export const unknownDepositTerms: DepositTermsPort = {
  lookup: () => Promise.resolve(null),
};

/** Valeur JSON entière >= 0 (les montants du flux tiennent dans un entier sûr). */
function amount(value: unknown): bigint | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}

/** Conditions déduites d'`edge_terms` ; null (inconnu) au moindre doute. */
export function termsFromEdgeTerms(
  edgeTerms: Record<string, unknown> | null,
  media: { batchId: string | null; mediaStatus: string },
): DepositTerms | null {
  if (edgeTerms === null) return null;
  // Bracelet déjà actif : l'état de sa caution n'est pas répliqué.
  if (media.mediaStatus === 'ACTIVE') return null;
  const fee = amount(edgeTerms.activation_fee);
  const batches = edgeTerms.deposit_batches;
  if (fee === null || !Array.isArray(batches) || batches.length === 0) return null;
  const parsed: Array<{ id: unknown; amount: bigint | null; mode: unknown }> = batches.map(
    (b: Record<string, unknown>) => ({
      id: b?.batch_id,
      amount: amount(b?.deposit_amount),
      mode: b?.deposit_mode,
    }),
  );
  let chosen = parsed;
  if (media.batchId !== null) {
    chosen = parsed.filter((b) => b.id === media.batchId);
    if (chosen.length !== 1) return null;
  }
  const first = chosen[0]!;
  if (first.amount === null) return null;
  const same = chosen.every((b) => b.amount === first.amount && b.mode === first.mode);
  if (!same) return null;
  // Caution prélevée sur le solde : non servie en `EDGE` (aucun solde débité par cette voie).
  if (first.amount > 0n && first.mode !== 'SEPARATE') return null;
  return {
    depositAmount: first.amount,
    depositStatus: first.amount > 0n ? 'DUE' : 'NONE',
    activationFeeFromBalance: fee,
  };
}

/** Port par défaut : les conditions répliquées dans `edge_terms`. */
export const replicatedDepositTerms: DepositTermsPort = {
  async lookup(tx, media) {
    const { rows } = await tx.query<{ edge_terms: Record<string, unknown> | null }>(
      'SELECT edge_terms FROM edge_event_setting',
    );
    return termsFromEdgeTerms(rows[0]?.edge_terms ?? null, media);
  },
};
