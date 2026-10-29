# Contrat : configurations PSP, recharges PSP, notifications, contestations

Références : SPECIFICATION §5.3, §8.5, §10.3, §11.1, §12.1, §12.2, §13.2, §14.2 S14, S26, S26b ; ADR-70, ADR-72,
ADR-77 ; research R-07 à R-14, R-16, R-17 et **R-20 (fait foi)**.

## Configurations (back-office)

1. `createPspConfiguration` (`OPERATOR_ADMIN`) : `{organizer_id, method, provider, holder_party_id, secret_ref,
   is_default, valid_from, valid_until}` → `DRAFT`. Fournisseur compatible avec le moyen ; `secret_ref` de forme
   `psp/<holder>/<nom>` (jamais un secret ; une valeur qui ressemble à un secret est refusée `422`).
2. Activation : demande d'approbation `PSP_CONFIGURATION` (`{psp_configuration_id}`), exécutée par un autre
   `OPERATOR_ADMIN` → `ACTIVE`. Suspension : même action (`{psp_configuration_id, status: SUSPENDED}`).
3. `listPspConfigurations` / `getPspConfiguration` : `OPERATOR_ADMIN` du prestataire, `ORGANIZER_ADMIN` de
   l'organisateur (lecture). `secret_ref` n'est rendu qu'à l'`OPERATOR_ADMIN`.
4. Au plus une configuration par défaut `ACTIVE` par organisateur et par moyen (base).

## Choix par événement

5. `setEventPspSelection` (`ORGANIZER_ADMIN`) `{method, psp_configuration_id}` : hors `LIVE`, écrit directement ;
   pendant `LIVE`, `202` et demande `EVENT_PSP_SELECTION` à approuver par une autre personne. Base : même
   organisateur, `ACTIVE`, même moyen, titulaire = `ledger.funds_holder_id` (sinon `422 VALIDATION_FAILED`).
6. Résolution à la recharge : choix de l'événement, sinon défaut de l'organisateur soumis au même contrôle, sinon
   `409 PSP_NOT_CONFIGURED`.

## Recharge PSP

7. `initiatePspTopup` : guichet (terminal `TOPUP_DESK` + `CASHIER`/`SUPERVISOR`, `tap_id` ou `wallet_id` de
   l'événement) ou festivalier (`CustomerAuth`, son portefeuille). Contrôles : grand livre `LIVE` (`409
   EVENT_CLOSING` sinon), montant > 0, devise de l'événement, configuration résolue, plafond de solde/mensuel
   estimé (refus anticipé `422`, non garanti : le contrôle qui fait foi est à la notification). Portefeuille `BLOCKED`/`CLOSED` → `409 WALLET_BLOCKED` ; au plus 3 `PENDING` par portefeuille et 20
   par terminal ; `Idempotency-Key` obligatoire. Crée la recharge `PENDING` (`create_psp_topup`), appelle
   `adapter.initiate` avec la référence marchande `psp_topup_id` **après** validation de la transaction (aucun appel
   réseau sous verrou) ; échec de l'adaptateur → la recharge reste `PENDING` (l'interrogation tranche), réponse
   `503 PSP_UNAVAILABLE` ou `422 PSP_REJECTED`.
   Réponse `201` : identifiant, statut, action de paiement (URL ou instruction), échéance, frais estimés si
   `psp_fee_bearer = CUSTOMER`.
8. `getPspTopup` : le demandeur (même terminal et même personne, ou même festivalier) ou un `ORGANIZER_ADMIN` de
   l'événement ; sinon `404`.
9. `cancelPspTopup` (festivalier ou guichet demandeur) : `PENDING` → `CANCELLED` seulement si l'adaptateur confirme
   l'annulation ; un succès notifié ensuite passe par les mêmes contrôles qu'un succès ordinaire et est crédité
   s'il est recevable, sinon non crédité avec son anomalie (R-20 ; décision du porteur du 29/10/2026, ADR-133).

## Notifications

10. `POST /webhooks/{provider}/{psp_config_id}` (`receivePspWebhook`), public : taille ≤ 64 Kio (`413`), configuration
    `ACTIVE` du fournisseur (`404` neutre), signature HMAC-SHA256 `t=<unix>,v1=<hex>` sur `t.corps_brut`, deux
    secrets en rotation, comparaison à temps constant (`401 WEBHOOK_SIGNATURE_INVALID`), `|t − maintenant| ≤ 300 s`
    (`401 WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE`). Refus : rien en base ; journal de sécurité
    `psp.webhook.rejected` et alerte bornée (R-10).
11. Acceptée : transaction 1, `record_psp_event` (conservé) ; `200 {received: true, duplicate}`. Transaction 2 :
    traitement sous verrou de la recharge (R-11, R-20) ; recharge introuvable → `UNMATCHED`, retraitée par le
    travailleur ; erreur inattendue → `RETRY`, retraitée, alerte au-delà de 5 essais ; refus définitif du moteur →
    non créditée avec anomalie.
12. Écriture `TOPUP` : clés du tableau de data-model.md ; `occurred_at` = heure de réception ; source
    `PSP_WEBHOOK`.

## Écritures

| Opération | Débit | Crédit |
|---|---|---|
| `TOPUP` (frais `ORGANIZER`/`OPERATOR`) | `A-PSP-<moyen>` (brut) ; `L-ORG-FPSP`/`L-OPE-FPSP` (frais) | `L-WAL-P` (brut) ; `A-PSP-<moyen>` (frais) |
| `TOPUP` (frais `CUSTOMER`) | `A-PSP-<moyen>` (brut) | `L-WAL-P` (net) ; `L-ORG-FFEST` + `L-ORG-TVA` (frais) |
| `CHARGEBACK` | `L-WAL-P` (jusqu'au solde payé) ; pertes du payeur `chargeback_bearer` (reste) | `A-PSP-<moyen>` |

(Constructeurs existants `buildTopup` et `buildChargeback` ; la ligne `CUSTOMER` reprend `buildTopup` tel quel.)

## Contestations

13. Notification `DISPUTE` : recharge retrouvée par la référence de paiement ; `record_chargeback` (unicité, plafond
    du montant restant) ; `CHARGEBACK` (clé `psp:<configuration>:<contestation>`) ; blocage du portefeuille si le
    solde payé ne couvrait pas le montant. Grand livre `LOCKED` : `LATE_CHARGEBACK` + demande d'approbation ;
    exécution en source `BACKOFFICE` (bornes `check_late_claim`).
14. Déblocage : demande `WALLET_UNBLOCK` `{wallet_id}`, `ORGANIZER_ADMIN`, deux personnes.

## Faux

15. `FakePspAdapter` par fournisseur et `FakePspSecretStore` portent `isFake` et ne sont jamais construits en
    production : le module enregistre alors un fournisseur « indisponible » (`503 PSP_UNAVAILABLE`, notifications
    `404`, travailleur inactif) ; si un faux est malgré tout présent, `assertProcessIsSafe` refuse le démarrage. Tests :
    chaque faux refusé en production, et le processus public démarre en production avec les routes espèces. Le faux PSP expose aux tests une fonction de
    notification signée (succès, échec, annulation, contestation, carte avec ou sans 3-D Secure).
