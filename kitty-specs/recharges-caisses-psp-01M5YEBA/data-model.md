# Data Model: Recharges, caisses et PSP

Toutes les tables : `operator_id`, RLS forcée (`assert_tenant`), écriture par fonctions SECURITY DEFINER à
`search_path` fixé, aucun `INSERT`/`UPDATE`/`DELETE` direct pour `cashless_app` (contracts/database-rights.md).
Migrations `0036` et suivantes ; le schéma de référence n'est pas modifié à la main. Corrections de la passe
contradictoire intégrées (research R-20).

## cash_session (S20)

| Colonne | Type | Règle |
|---|---|---|
| `cash_session_id` | uuid PK | |
| `operator_id`, `ledger_id`, `event_id` | uuid | grand livre de l'événement du terminal |
| `device_id` | uuid | terminal `TOPUP_DESK` actif à l'ouverture |
| `cash_account_id` | uuid | compte `A-CAISSE-<série>` (`CASH_DESK`) du même grand livre |
| `opened_by`, `opened_at` | uuid, timestamptz | heure de la base |
| `status` | `OPEN` \| `CLOSING` \| `CLOSED` | `CLOSING` posé par `begin_cash_close` dans la transaction de fermeture |
| `closed_by`, `closed_at` | | `closed_by` ≠ auteur du dernier comptage |
| `counted_amount`, `expected_amount` | bigint | figés à la fermeture ; `expected` = solde de la caisse sous verrou |
| `close_tx_id` | uuid NULL | `CASH_CLOSE` ; NULL seulement si compté = théorique = 0 |
| `cash_diff_anomaly_id` | uuid NULL | non NULL ⇔ écart non nul |

Index uniques partiels : une session `OPEN`/`CLOSING` par `cash_account_id`, une par `device_id`.
Transitions : `OPEN → CLOSING → CLOSED` (dans une même transaction, `begin_cash_close` puis `finish_cash_close`).
Ouverture seulement si le grand livre est `LIVE` ou `CLOSING`. Le fermeur n'a fait aucun comptage de la session.

## cash_desk

`account_id` PK, `device_id` unique, `ledger_id`, `created_at`. Rempli par `open_cash_session` à la création de
`A-CAISSE-<série>`. Seuls les comptes inscrits ici sont soumis à la garde.

## cash_session_count

`(cash_session_id, count_no)`, `count_no ≤ 10`, `counted_amount ≥ 0`, `counted_by`, `counted_at`, `note`. La fermeture retient le
dernier `count_no`. Lecture par l'agent : jamais avec le théorique.

## cash_session_tx

`(cash_session_id, tx_id)` PK, `tx_id` unique. Toute transaction qui écrit sur un compte `CASH_DESK` y est rattachée
dans la même transaction (`attach_cash_tx`). Déclencheur `posting_cash_desk_guard` : pour un compte inscrit dans
`cash_desk`, exige une session `OPEN` de ce compte (ou `CLOSING` avec une transaction `CASH_CLOSE` de clé
`cash-close:<session>`), et le même terminal que la session quand la transaction en porte un. Lecture sans verrou.
Déclencheur `account_purpose_guard` : `cashless_app` ne crée ni `CASH_DESK` ni `PSP`.

## psp_configuration (S26)

| Colonne | Type | Règle |
|---|---|---|
| `psp_configuration_id` | uuid PK | |
| `operator_id`, `organizer_id` | uuid | |
| `method` | `WAVE` \| `ORANGE_MONEY` \| `CARD` | |
| `provider` | `WAVE` \| `ORANGE_MONEY` \| `PAYDUNYA` \| `STRIPE` | `WAVE`→`WAVE`, `ORANGE_MONEY`→`ORANGE_MONEY`, `CARD`→`PAYDUNYA`\|`STRIPE` |
| `holder_party_id` | uuid | titulaire = détenteur des fonds |
| `secret_ref` | text | `CHECK (secret_ref LIKE 'psp/' \|\| holder_party_id \|\| '/%')` ; jamais un secret |
| `compliance_ref` | text | non vide à l'activation (agrément BCEAO ou compte XOF vérifié, §11.1) |
| `status` | `DRAFT` \| `ACTIVE` \| `SUSPENDED` | `ACTIVE` par exécution de l'approbation `PSP_CONFIGURATION` seulement (liée à la version), et seulement avec une règle de frais `PSP_CONFIGURATION` |
| `is_default` | boolean | index unique partiel `(organizer_id, method) WHERE is_default AND status = 'ACTIVE'` |
| `valid_from`, `valid_until` | timestamptz | |
| `version`, `created_by`, `approved_by` | | `approved_by` ≠ `created_by` |

## event_psp_selection (S26b)

PK `(event_id, method)`, `psp_configuration_id`, `selected_by`, `approved_by` (obligatoire si l'événement est `LIVE`),
`selected_at`. Déclencheur : configuration du même organisateur, `ACTIVE`, même moyen, titulaire =
`ledger.funds_holder_id`. Historique dans l'audit ; une recharge garde sa configuration.

## psp_topup (S14)

| Colonne | Type | Règle |
|---|---|---|
| `psp_topup_id` | uuid PK | |
| `operator_id`, `ledger_id`, `event_id`, `wallet_id` | uuid | |
| `psp_configuration_id`, `method`, `provider` | | figés à la création |
| `amount`, `currency` | bigint, text | devise de l'événement |
| `fee_amount` | bigint | renseigné au crédit |
| `status` | `PENDING` \| `SUCCEEDED` \| `FAILED` \| `EXPIRED` \| `CANCELLED` | transitions ci-dessous |
| `provider_payment_ref` | text NULL | unique `(psp_configuration_id, provider_payment_ref)` ; la référence marchande est `psp_topup_id` |
| `expires_at` | timestamptz | |
| `requested_by_kind` | `DESK` \| `CUSTOMER` | + `device_id`/`person_id` ou `customer_id` |
| `card_fingerprint`, `three_ds` | text NULL | carte seulement, posés à la notification |
| `topup_tx_id` | uuid NULL | `CHECK ((status = 'SUCCEEDED') = (topup_tx_id IS NOT NULL))` |
| `failure_reason`, `anomaly_id` | | `FAILED` après paiement : anomalie obligatoire |

Transitions (sous `FOR UPDATE` de la ligne) :

| État \ notification | Succès conforme et créditable | Succès non créditable | Échec (`PAYMENT_FAILED`) | Annulation confirmée | Échéance (travailleur, après `getStatus`) |
|---|---|---|---|---|---|
| `PENDING` | `SUCCEEDED` (TOPUP) | `FAILED` + anomalie | reste `PENDING` | `CANCELLED` | `EXPIRED` si non payé, sinon traité comme succès |
| `FAILED`, `EXPIRED`, `CANCELLED` | `SUCCEEDED` (TOPUP) | anomalie `PSP_TOPUP_NOT_CREDITED` (une par paiement) | sans effet | sans effet | — |
| `SUCCEEDED` | doublon (aucune écriture) | — | sans effet (signalé) | sans effet (signalé) | — |

Au plus 3 `PENDING` par portefeuille, 20 par terminal.

## psp_event (S14)

`psp_event_id` uuid PK ; `operator_id`, `psp_configuration_id`, `provider_event_id` (unique avec la configuration),
`received_at`, `body` (bytea, ≤ 64 Kio, purgé après 400 jours), `signature_valid` (toujours vrai : seules les
notifications authentifiées sont conservées), `kind`, `status` (`RECEIVED`, `PROCESSED`, `UNMATCHED`, `RETRY`),
`attempts`, `processed_at`, `outcome` (`CREDITED`, `NOT_CREDITED`, `MISMATCH`, `DUPLICATE_PAYMENT`, `CHARGEBACK`,
`NO_EFFECT`), `psp_topup_id` NULL.

## psp_webhook_rejection

`(psp_configuration_id NULL, reason, minute)` PK, `count`. Compteur des notifications refusées, sans corps.

## psp_chargeback

`(psp_configuration_id, provider_dispute_id)` unique ; `psp_topup_id`, `amount > 0`, `chargeback_tx_id` NULL (NULL tant
que la contestation tardive attend son approbation), `wallet_blocked`, `late` ; contrôle : somme des contestations
d'une recharge ≤ son montant.

## Extensions de tables existantes (migrations)

- `fee_rule.scope_type` : + `PSP_CONFIGURATION` (`scope_id` = configuration).
- `anomaly.kind` : + `PSP_TOPUP_NOT_CREDITED` (motif `THREE_DS`, `LEDGER_STATUS` ; `amount` et `ledger_id` exigés).
- `approval_request.action` : + `WALLET_UNBLOCK`, `CASH_DEPOSIT`.
- `account` : comptes `A-PSP-WAVE`, `A-PSP-OM`, `A-PSP-CARTE` (`PSP`, chaud, négatif permis, ADR-77) créés à
  l'ouverture du grand livre pour les nouveaux grands livres et par la migration pour les grands livres existants ;
  `A-CAISSE-<série>` par `open_cash_session`.

## Correspondances

| Moyen | Compte | Préfixe de clé d'écriture `TOPUP` |
|---|---|---|
| `WAVE` | `A-PSP-WAVE` | `wave:<configuration>:<paiement>` |
| `ORANGE_MONEY` | `A-PSP-OM` | `om:<configuration>:<paiement>` |
| `CARD` | `A-PSP-CARTE` | `psp:<configuration>:<paiement>` |

Clé de réception : `psp:<configuration>:<id de notification>` ; contestation : `psp:<configuration>:<id de contestation>`.
