// Table de correspondance « catégorie du relevé → comptes (finalités) et types de transaction » (SPECIFICATION §12.3).
// Une constante testée, pas du code dispersé. Première entrée qui correspond : l'ordre compte. Un mouvement sans
// entrée tombe dans `OTHER_CATEGORY` : il n'est jamais omis d'un relevé.
import type { PartyKind } from './party-statement-scope';

export interface StatementCategory {
  /** Libellé de la catégorie (ce que le relevé affiche). */
  category: string;
  /** Finalités (`account.purpose`) concernées. */
  purposes: readonly string[];
  /** Types de transaction concernés ; absent : tous. */
  types?: readonly string[];
  /** `true` : seulement les lignes portant une règle de frais (commission) ; `false` : sans règle ; absent : peu importe. */
  fee?: boolean;
}

export const OTHER_CATEGORY = 'Autres mouvements';

const MERCHANT = ['MERCHANT'] as const;

export const STATEMENT_CATEGORIES: Readonly<Record<PartyKind, readonly StatementCategory[]>> = {
  MERCHANT: [
    { category: 'Commissions', purposes: MERCHANT, types: ['PURCHASE', 'REVERSAL'], fee: true },
    { category: 'Ventes brutes', purposes: MERCHANT, types: ['PURCHASE'] },
    { category: 'Annulations', purposes: MERCHANT, types: ['REVERSAL'] },
    { category: 'Droit de place', purposes: MERCHANT, types: ['PITCH_FEE'] },
    {
      category: 'Versements',
      purposes: MERCHANT,
      types: ['PAYOUT_INITIATED', 'PAYOUT_CONFIRMED', 'PAYOUT_FAILED'],
    },
    {
      category: 'Reste dû (transfert de dette)',
      purposes: MERCHANT,
      types: ['MERCHANT_DEBT_TRANSFER'],
    },
  ],
  ORGANIZER: [
    // Ventes des commerçants INTERNAL de l'événement (comptes `MERCHANT` de leurs participations, SPECIFICATION §12.3) :
    // ventes et annulations seulement, hors lignes de frais, versements et droit de place.
    {
      category: 'Ventes internes',
      purposes: MERCHANT,
      types: ['PURCHASE', 'REVERSAL'],
      fee: false,
    },
    { category: 'Commissions', purposes: ['ORG_COM'] },
    { category: 'Droits de place', purposes: ['ORG_PLACE'] },
    { category: 'Frais festivaliers', purposes: ['ORG_FFEST'] },
    { category: 'Taxe collectée', purposes: ['ORG_TAX'] },
    { category: 'Casse', purposes: ['ORG_CASSE'] },
    { category: 'Cautions détenues', purposes: ['ORG_DEPOSIT'] },
    { category: 'Cautions acquises', purposes: ['ORG_DEPOSIT_FORFEIT'] },
    { category: 'Crédits offerts consommés', purposes: ['ORG_PROMO'] },
    { category: 'Frais PSP', purposes: ['ORG_FPSP'] },
    { category: 'Frais du prestataire', purposes: ['ORG_FPREST'] },
    { category: 'Pertes', purposes: ['ORG_PERTES'] },
    { category: 'Versements', purposes: ['ORG_VERS'] },
  ],
  OPERATOR: [
    { category: 'Frais facturés', purposes: ['OPE_FRAIS'] },
    { category: 'Taxe collectée', purposes: ['OPE_TAX'] },
    { category: 'Part de casse', purposes: ['OPE_CASSE'] },
    { category: 'Redevance plateforme', purposes: ['OPE_REDEV'] },
    { category: 'Versements', purposes: ['OPE_VERS'] },
  ],
  PLATFORM: [
    { category: 'Redevance', purposes: ['PLT_REDEV'] },
    { category: 'Taxe collectée', purposes: ['PLT_TAX'] },
    { category: 'Versements', purposes: ['PLT_VERS'] },
  ],
};

export interface CategorizedLine {
  purpose: string;
  type: string;
  /** Le mouvement porte une règle de frais (`posting.fee_rule_id`). */
  fee: boolean;
}

export function categoryOf(kind: PartyKind, line: CategorizedLine): string {
  const hit = STATEMENT_CATEGORIES[kind].find(
    (entry) =>
      entry.purposes.includes(line.purpose) &&
      (entry.types === undefined || entry.types.includes(line.type)) &&
      (entry.fee === undefined || entry.fee === line.fee),
  );
  return hit?.category ?? OTHER_CATEGORY;
}

/** Libellés lisibles des types de transaction, pour le relevé du festivalier. */
export const WALLET_TYPE_LABELS: Readonly<Record<string, string>> = {
  TOPUP: 'Recharge en ligne',
  TOPUP_CASH: 'Recharge en espèces',
  PROMO_CREDIT: 'Crédit offert',
  PROMO_EXPIRY: 'Expiration du crédit offert',
  ACTIVATION_FEE: 'Frais d’activation',
  DEPOSIT_TAKEN: 'Caution',
  DEPOSIT_REFUNDED: 'Caution rendue',
  DEPOSIT_FORFEITED: 'Caution retenue',
  PURCHASE: 'Achat',
  REVERSAL: 'Annulation',
  CHARGEBACK: 'Contestation de paiement',
  WALLET_REFUND: 'Remboursement',
  BREAKAGE: 'Solde non réclamé',
  BREAKAGE_REVERSAL: 'Solde non réclamé rétabli',
  ADJUSTMENT: 'Ajustement',
  ANOMALY_RESOLUTION: 'Régularisation',
};
