// Inventaire des chemins de débit du central (mission passerelle-locale, lot WP11, T050 ; FR-004, FR-013). Tout débit
// d'un portefeuille est refusé tant que `ledger.debit_authority = 'EDGE'` ; les crédits restent acceptés. Établi par
// lecture du contrat (`openapi.yaml`, opérations `POST`/`PUT`) et du code : un chemin = une entrée, avec ce qui le
// protège (fichier:ligne). Le test `debit-paths-refused.spec.ts` LIT cette liste : ajouter un chemin sans cas de test
// le fait échouer.
//
// Dernier recours pour tout débit passant par `post_transaction` : la garde SQL `CL006` (0060, refus de toute écriture
// débitrice d'un compte de portefeuille de source autre que `EDGE_SYNC`). Les gardes TypeScript évitent seulement une
// écriture partielle avant le refus. Le corps `409` est complété par le filtre d'erreurs (edge-conflict.ts).
//
// `layer` dit où le test prouve le refus : `HTTP` (route réelle), `ENGINE` (le moteur d'écriture réel, la route
// exigeant un montage hors de portée du lot : voir `note`), `GUARD` (garde d'admission seule), `ABSENT` (route du
// contrat non servie par l'API : la requête n'écrit rien), `CLASSIFIED` (crédit ou neutre classé par lecture du code,
// sans cas de test propre).
export type DebitPathKind = 'DEBIT' | 'CREDIT' | 'NEUTRAL';
export type DebitPathLayer = 'HTTP' | 'ENGINE' | 'GUARD' | 'ABSENT' | 'CLASSIFIED';

export interface DebitPath {
  route: string;
  operationId: string;
  kind: DebitPathKind;
  layer: DebitPathLayer;
  /** Ce qui protège (DEBIT) ou ce qui justifie le classement (CREDIT, NEUTRAL) : fichier et ligne. */
  protection: string;
  note?: string;
}

const CL006 = 'SQL CL006 (migrations/0060_edge_sync_registry.sql:386, post_transaction)';

export const DEBIT_PATHS: readonly DebitPath[] = [
  {
    route: 'POST /payments',
    operationId: 'createPayment',
    kind: 'DEBIT',
    layer: 'HTTP',
    protection: `payments/payments.service.ts:123 (refus après les gardes du terminal et du vendeur, avant la lecture du bracelet) ; payments/payments.service.ts:165 (PURCHASE par le moteur) ; ${CL006}`,
  },
  {
    route: 'POST /payment-requests/{payment_request_id}/pay',
    operationId: 'payPaymentRequest',
    kind: 'DEBIT',
    layer: 'HTTP',
    protection: `payment-requests/payment-request.service.ts:296 (PURCHASE) ; ${CL006}`,
  },
  {
    route: 'POST /media/{media_id}/deposit',
    operationId: 'takeDeposit',
    kind: 'DEBIT',
    layer: 'HTTP',
    protection: `media/lifecycle/deposit.service.ts:105 (FROM_BALANCE, avant écriture) ; ${CL006}`,
  },
  {
    route: 'POST /media/activations',
    operationId: 'activateMedia',
    kind: 'DEBIT',
    layer: 'HTTP',
    protection: `media/lifecycle/activation.service.ts:71 (caution FROM_BALANCE) ; ${CL006}`,
  },
  {
    route: 'POST /media/{media_id}/release',
    operationId: 'releaseMedia',
    kind: 'DEBIT',
    layer: 'HTTP',
    protection: 'media/lifecycle/release.service.ts:90 (solde central non sûr sous EDGE)',
  },
  {
    route: 'POST /me/media',
    operationId: 'claimMedia',
    kind: 'DEBIT',
    layer: 'GUARD',
    protection: `media/claims/claims.service.ts:192 (caution sur un bracelet approvisionné) ; ${CL006}`,
    note: 'Refus enregistré avec la clé (CommittedProblem) : le corps garde l’ancienne forme, voir compte rendu.',
  },
  {
    route: 'POST /media/claims/confirmations',
    operationId: 'confirmMediaClaim',
    kind: 'DEBIT',
    layer: 'GUARD',
    protection: `media/claims/claims.service.ts:272 (actor.debitAuthority) ; ${CL006}`,
  },
  {
    route: 'POST /webhooks/{provider}/{psp_config_id}',
    operationId: 'receivePspWebhook',
    kind: 'DEBIT',
    layer: 'ENGINE',
    protection: `chargebacks/chargeback.service.ts:154 (CHARGEBACK, source PSP_WEBHOOK) ; ${CL006}`,
    note: 'Contestation : débit du portefeuille. Les paiements acceptés du même webhook sont des crédits.',
  },
  {
    route: 'POST /chargebacks/{chargeback_id}/approval-requests',
    operationId: 'requestLateChargeback',
    kind: 'DEBIT',
    layer: 'ENGINE',
    protection: `chargebacks/chargeback.service.ts:154 (CHARGEBACK, source BACKOFFICE) ; ${CL006}`,
    note: 'La demande ne débite rien ; l’exécution à l’approbation passe FAILED (DEBIT_AUTHORITY_EDGE).',
  },
  {
    route: 'POST /offline-batches',
    operationId: 'submitOfflineBatch',
    kind: 'DEBIT',
    layer: 'GUARD',
    protection:
      'offline/batches/batch-intake.ts:193 (contrôle 9, checkAuthority) ; offline-batches.service.ts:120',
  },
  {
    route: 'POST /refund-requests/{refund_request_id}/confirm',
    operationId: 'confirmRefundRequest',
    kind: 'DEBIT',
    layer: 'ABSENT',
    protection: 'aucune route dans apps/api/src (contrat seulement)',
  },
  {
    route: 'POST /payment-intents/{payment_intent_id}/capture',
    operationId: 'capturePaymentIntent',
    kind: 'DEBIT',
    layer: 'ABSENT',
    protection: 'aucune route dans apps/api/src (contrat seulement)',
  },
  {
    route: 'POST /ledgers/{ledger_id}/late-claims',
    operationId: 'postLateClaim',
    kind: 'DEBIT',
    layer: 'ABSENT',
    protection: 'aucune route dans apps/api/src (contrat seulement)',
  },
  {
    route: 'POST /topups/cash',
    operationId: 'createCashTopup',
    kind: 'CREDIT',
    layer: 'CLASSIFIED',
    protection:
      'recharge : crédit du portefeuille (TOPUP_CASH), jamais une ligne débitrice de portefeuille',
  },
  {
    route: 'POST /payments/{transaction_id}/reversal',
    operationId: 'reversePayment',
    kind: 'CREDIT',
    layer: 'HTTP',
    protection:
      'reversals/reversal.service.ts:182 (REVERSAL d’une vente : rend le montant au portefeuille)',
  },
  {
    route: 'POST /media/{media_id}/deposit/refund',
    operationId: 'refundDeposit',
    kind: 'CREDIT',
    layer: 'CLASSIFIED',
    protection: 'media/lifecycle/deposit.service.ts:154 (DEPOSIT_REFUNDED : rend la caution)',
  },
  {
    route: 'POST /media/{media_id}/cash-due-refunds',
    operationId: 'refundCashDue',
    kind: 'NEUTRAL',
    layer: 'CLASSIFIED',
    protection: 'compte « espèces dues » (pas un compte de portefeuille) : hors de la garde CL006',
  },
  {
    route: 'POST /taps',
    operationId: 'createTap',
    kind: 'NEUTRAL',
    layer: 'HTTP',
    protection: 'register_tap n’écrit aucune ligne comptable (lecture du bracelet)',
  },
  {
    route: 'POST /cash-sessions/{cash_session_id}/close',
    operationId: 'closeCashSession',
    kind: 'NEUTRAL',
    layer: 'HTTP',
    protection:
      'begin_cash_close lève CL029 sous EDGE (0059:402) : 409 CONFLICT_STATE, sens de CL029 inchangé',
  },
];
