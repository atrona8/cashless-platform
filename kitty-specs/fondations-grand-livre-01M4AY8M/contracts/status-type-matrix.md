# Contrat — Types acceptés selon le statut de l'événement

Source : SPECIFICATION §12.1 (tableau « Types acceptés », clôture avec soldes restants, casse réversible). Le moteur
refuse `VALIDATION_FAILED` **avant** d'appeler `post_transaction` ; la base applique en plus le statut du grand
livre (§5.4 étape 4 : `LEDGER_LOCKED`, `EVENT_CLOSING`, `PERIOD_CLOSED`).

| Statut événement (grand livre) | Types acceptés par le moteur | Restriction de source |
|---|---|---|
| `DRAFT` (`OPEN`) | `PROMO_CREDIT` (préchargement), `DEPOSIT_TAKEN` / `DEPOSIT_REFUNDED` en mode `SEPARATE` | — |
| `LIVE` (`OPEN`) | tous sauf `BREAKAGE` | — |
| `CLOSING` (`CLOSING`) | `PURCHASE`, `TOPUP_CASH`, `DEPOSIT_TAKEN` synchronisés ; `REVERSAL`, `CASH_CLOSE`, `DEPOSIT_REFUNDED`, `WALLET_REFUND`, `PROMO_EXPIRY`, `CHARGEBACK` ; `TOPUP` | ventes/recharges : `OFFLINE_SYNC` ou `EDGE_SYNC` ; `TOPUP` : `PSP_WEBHOOK` |
| `RECONCILING` (`CLOSING`) | synchronisations et leurs `REVERSAL`, `CASH_CLOSE`, `CASH_DEPOSIT`, `PSP_SETTLEMENT`, `ANOMALY_RESOLUTION`, `ADJUSTMENT`, `WALLET_REFUND`, `DEPOSIT_REFUNDED`, `PROMO_EXPIRY`, `CHARGEBACK` | synchronisations : `OFFLINE_SYNC` / `EDGE_SYNC` |
| `SETTLING` (`CLOSING`) | `PITCH_FEE`, `MERCHANT_DEBT_TRANSFER`, `OPERATOR_FEE`, `PLATFORM_FEE`, `PAYOUT_INITIATED`, `PAYOUT_CONFIRMED`, `PAYOUT_FAILED`, `WALLET_REFUND`, `DEPOSIT_REFUNDED`, `PROMO_EXPIRY`, `CHARGEBACK`, `ADJUSTMENT` | — |
| `REFUND_WINDOW` (`CLOSING`) | `WALLET_REFUND`, `DEPOSIT_REFUNDED`, `PROMO_EXPIRY`, `CHARGEBACK`, `BREAKAGE`, `DEPOSIT_FORFEITED`, `OPERATOR_FEE` (régularisation), `PAYOUT_*`, `ADJUSTMENT` | — |
| `CLOSED` (`CLOSING`, soldes restants) | `WALLET_REFUND` (dont espèces dues), `PAYOUT_*` depuis `L-LEGAL-CASSE` | `PAYOUT_*` : compte débité = `LEGAL_BREAKAGE` |
| `CLOSED` (`LOCKED`) | `BREAKAGE_REVERSAL`, `ADJUSTMENT`, `WALLET_REFUND`, `CHARGEBACK` (réclamations tardives) | `BACKOFFICE` uniquement, jusqu'à `late_claims_until` (bornes : base, `CL024`) |

Notes :

- `wallet_scope = ORGANIZER` : le grand livre reste `OPEN` ; la matrice s'applique aux seules commandes portant
  l'`event_id` de l'événement concerné.
- `DEPOSIT_TAKEN` en `CLOSING`/`RECONCILING` : uniquement une caution **en espèces** synchronisée (sync_protocol
  §7.5) ; à confirmer à la mission hors ligne, et signalé si la lecture diffère.
- Les lignes `CLOSING` et `RECONCILING` sont interprétées strictement depuis §12.1 ; chaque cellule a un test
  unitaire (type accepté / refusé) et toute ambiguïté relevée est consignée (FR-024).
