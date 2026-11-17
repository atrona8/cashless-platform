# Note aux équipes du back-office et des applications : clôture, versements, rapprochements, relevés (mission 9b)

Version du 17 novembre 2026. Ce document reprend le contrat livré (`packages/contracts/openapi.yaml`) : il ne le remplace pas, il
dit comment s'en servir. En cas d'écart, le contrat fait foi. Toutes les routes sont préfixées par `/v1`. Les exemples viennent
des tests de la mission ; ils ne contiennent aucune donnée réelle, et aucun IBAN complet.

## 1. À savoir avant de commencer

- **Paiement manuel.** L'API ne verse rien. Elle calcule les droits, prépare le lot, produit le fichier à envoyer à la banque ou
  à l'opérateur mobile, puis enregistre le résultat que la personne lui annonce (`CONFIRMED` ou `FAILED`).
- **Deux personnes.** Un lot de versements est demandé par une personne et validé par une autre (`202` à la demande, rien n'est
  écrit ; l'exécution a lieu à la validation par `POST /approval-requests/{id}/approve`). La personne qui valide est toujours celle
  du jeton ; un champ `approved_by` dans le corps est ignoré. Auteur et valideur identiques : refusé.
- **Clé d'idempotence.** Toute écriture envoie `Idempotency-Key` (identifiant unique par action). Rejouer la même clé avec le même
  corps rend la même réponse sans nouvelle écriture. Exception : l'export d'un lot (`GET`) n'est pas rejoué, chaque export est
  tracé.
- **Montants.** Entiers dans la plus petite unité de la devise (le franc CFA n'a pas de décimale). Un montant négatif sort d'un
  compte.
- **Ce qui est simulé.** La copie externe des scellements d'audit et l'envoi des alertes d'exploitation à une personne ne sont pas
  réels avant la mission 12b (voir §9). Aucune route ne les expose.

## 2. Les 20 opérations

| # | Opération | Route | Rôle requis | Réponse |
|---|---|---|---|---|
| 1 | `listEventClosingSteps` | `GET /operators/{operator_id}/events/{event_id}/closing-steps` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN`, `SUPERVISOR` | `200` liste de 7 étapes, dans l'ordre |
| 2 | `previewEventClosingStep` | `GET …/closing-steps/{step}/preview` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` aperçu, rien d'écrit |
| 3 | `executeEventClosingStep` | `POST …/closing-steps/{step}` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` résultat ; `409 CLOSING_CONDITION_NOT_MET` |
| 4 | `getEventRemainingBalances` | `GET …/remaining-balances` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` totaux ; `?format=csv` : fichier |
| 5 | `listPayoutEntitlements` | `GET /ledgers/{ledger_id}/payout-entitlements` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` droits par partie |
| 6 | `requestPayoutBatch` | `POST /ledgers/{ledger_id}/payout-batches/approval-requests` | selon le bénéficiaire (§4) | `202` demande d'approbation |
| 7 | `listPayouts` | `GET /ledgers/{ledger_id}/payouts` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` page de versements |
| 8 | `exportPayoutBatch` | `GET /ledgers/{ledger_id}/payout-batches/{approval_request_id}/export` | rôle du lot | `200` CSV |
| 9 | `confirmPayout` | `POST /payouts/{payout_id}/confirm` | rôle du lot | `200` versement |
| 10 | `importAccountStatement` | `POST /ledgers/{ledger_id}/accounts/{account_id}/statements` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `201` résultat d'import |
| 11 | `listStatementLines` | `GET /ledgers/{ledger_id}/statement-lines` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` page de lignes |
| 12 | `matchStatementLine` | `POST /statement-lines/{statement_line_id}/match` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `200` ligne |
| 13 | `getLedgerReconciliation` | `GET /ledgers/{ledger_id}/reconciliation` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN`, `SUPERVISOR` | `200` état par compte |
| 14 | `postLateAdjustment` | `POST /ledgers/{ledger_id}/late-adjustments` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `202` demande d'approbation |
| 15 | `createRefundRequest` | `POST /refund-requests` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | `201` demande `REQUESTED` |
| 16 | `getPartyStatement` | `GET /operators/{operator_id}/events/{event_id}/statements/{party_kind}` | selon `party_kind` (§7) | `200` ou CSV |
| 17 | `getMyWalletStatement` | `GET /me/wallets/{wallet_id}/statement` | festivalier, son portefeuille | `200` CSV |
| 18a | `listAccountMappings` | `GET /operators/{operator_id}/account-mappings` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` (son entité) | `200` |
| 18b | `createAccountMappingVersion` | `POST /operators/{operator_id}/account-mappings` | `OPERATOR_ADMIN` | `201` nouvelle version |
| 19 | `exportAccounting` | `GET /operators/{operator_id}/accounting-exports` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` (son entité) | `200` CSV |

(La ligne 18 compte deux opérations sur un même chemin : 20 en tout.) Une personne dont le rôle ne convient pas reçoit `403` ;
un objet d'un autre prestataire ou d'un autre organisateur reçoit `404`, sans indice sur son existence.

## 3. Clôture d'un événement

Passages de statut : `POST /operators/{operator_id}/events/{event_id}/status-transitions` avec `{ "to": "RECONCILING" }`, etc.
Un passage dont une condition n'est pas remplie répond `409 CLOSING_CONDITION_NOT_MET` ; le champ `detail` nomme chaque condition
non remplie (`CODE : texte`). `GET …/status-conditions?to=SETTLING` les liste d'avance.

**Trois valeurs nouvelles de `StatusCondition.code`**, et une qui change de nature :

| Code | Vers | Texte quand remplie | Texte quand non remplie |
|---|---|---|---|
| `NO_OPEN_CASH_SESSION` | `RECONCILING` | Aucune session de caisse ouverte. | Une session de caisse est encore ouverte ou en cours de fermeture. |
| `CLOSING_STEPS_DONE` | `REFUND_WINDOW` (étapes 1 à 3), `CLOSED` (les sept) | Les étapes de clôture de la phase sont faites ou sans objet. | Des étapes de clôture de la phase restent à faire. |
| `REFUND_DEADLINE_REACHED` | `CLOSED` | La date limite de remboursement est atteinte. | La date limite de remboursement n'est pas atteinte. |
| `PSP_RECONCILED` | `SETTLING` | Les comptes des prestataires de paiement sont rapprochés avec leurs relevés. | Des comptes des prestataires de paiement ne sont pas rapprochés avec leurs relevés. |

`PSP_RECONCILED` garde son code ; elle est désormais **calculée** par le système (elle était externe). Les textes existent en
français et en anglais (`Accept-Language`).

**Les sept étapes** (`step` : `PITCH_FEES`, `OPERATOR_FEE`, `PLATFORM_FEE`, `OPERATOR_FEE_REGULARIZATION`, `BREAKAGE`,
`DEPOSIT_FORFEIT`, `PROMO_EXPIRY`). Les trois premières se font en `SETTLING`, les quatre autres en `REFUND_WINDOW`. Le bon usage : lire l'**aperçu** (rien n'est écrit), puis exécuter. Le total exécuté est celui de
l'aperçu ; une étape déjà faite rend le même résultat (rejeu sans effet). Exemple du festival de référence :

```
GET  …/closing-steps/PITCH_FEES/preview   -> 200 { "event_id": "…", "step": "PITCH_FEES", "currency": "XOF",
                                                   "applicable": true, "lines": [ … ], "total": 25000 }
POST …/closing-steps/PITCH_FEES           -> 200 { "step": "PITCH_FEES", "status": "DONE", "transaction_ids": ["…"],
                                                   "summary": { "total": 25000, "lines": [ … ] } }
```

Étapes de l'exemple : droits de place 25 000, frais du prestataire 6 000, redevance de la plateforme 1 017, casse 20 000 (16 000
à l'organisateur, 4 000 au prestataire), caution acquise 2 000, crédits offerts expirés 1 000. `status` d'une étape :
`TODO`, `DONE` ou `NOT_APPLICABLE` (la régularisation des frais est sans objet quand la base de calcul est brute). Exécuter une
étape hors de son statut ou hors d'ordre : `409 CLOSING_CONDITION_NOT_MET`. Règle de casse : si le contrat prévoit que la casse
va au prestataire (`breakage_destination = OPERATOR`), elle va entièrement au prestataire.

**Soldes restants** : `GET …/remaining-balances` rend `wallet_count`, `paid_total`, `cash_due_total`, `promo_total`. Le CSV
(`format=csv`) a les colonnes `wallet_id,paid,cash_due,promo`.

## 4. Versements

**Droits** : `GET /ledgers/{ledger_id}/payout-entitlements` rend, par partie, `net_claim` (droit avant versements en cours),
`pending_payouts` (versements demandés non réglés) et `available` (ce qu'on peut encore verser). `available = net_claim -
pending_payouts`. Un nouveau versement ne dépasse jamais `available`.

**Qui prépare et valide quoi.** Le rôle dépend du bénéficiaire (amendement de la spécification, ADR-204) :

| Bénéficiaire du versement | Rôle de l'auteur et du valideur |
|---|---|
| un commerçant, l'organisateur | `ORGANIZER_ADMIN` |
| le prestataire, la plateforme | `OPERATOR_ADMIN` |
| un lot qui mélange les deux | les deux rôles, chez l'auteur **et** chez le valideur |

**Demande** (`202`) :

```
POST /ledgers/{ledger_id}/payout-batches/approval-requests
{ "lines": [ { "beneficiary_party_id": "…", "amount": 11400, "currency": "XOF", "method": "WAVE", "msisdn": "+221770000001" },
             { "beneficiary_party_id": "…", "amount": 4000,  "currency": "XOF", "method": "BANK_TRANSFER", "iban": "<IBAN valide>" } ] }
-> 202 { "approval_request_id": "…", "action": "PAYOUT", "status": "PENDING", "target_id": "<ledger_id>" }
```

`method` : `BANK_TRANSFER` (avec `iban`), `WAVE` ou `ORANGE_MONEY` (avec `msisdn` au format `+…`). `CASH` est refusé (`422`). Un
bénéficiaire qui n'est ni commerçant, ni organisateur, ni prestataire, ni plateforme : `422`. L'IBAN et le numéro sont masqués dans
la demande qu'on relit et dans le journal d'audit (`SN08****************3035`) ; ils ne sont en clair que dans l'export.

**Validation** : `POST /approval-requests/{approval_request_id}/approve` par une autre personne. Réponse `200` avec `status` :
`EXECUTED` (les versements existent, `INITIATED`) ou `FAILED` (par exemple `failure_code = PAYOUT_EXCEEDS_ENTITLEMENT` si le
droit a baissé entre la demande et la validation : rien n'est écrit).

**Liste** : `GET /ledgers/{ledger_id}/payouts?status=INITIATED&approval_request_id=…` : page de `Payout` (`payout_id`, `amount`,
`method`, `status`, `external_reference`, `failure_reason`, `initiated_by`, `approved_by`, `confirmed_by`…).

**Export du lot** : `GET …/payout-batches/{approval_request_id}/export` rend un CSV `text/csv` à envoyer à la banque ou à
l'opérateur mobile. Colonnes : `beneficiary,method,destination,amount,currency,reference`. La `destination` est l'IBAN ou le numéro
en clair, **numéro en chiffres seuls, sans `+`**. Un nom qui commence par `=`, `+`, `-` ou `@` est neutralisé (apostrophe en
tête) : ne pas retirer ce préfixe. Un lot non validé : `404` ; chaque export est tracé dans l'audit (nombre de lignes, jamais la
destination).

**Résultat** : `POST /payouts/{payout_id}/confirm`.

```
{ "outcome": "CONFIRMED", "external_reference": "VIR-0001" }     -> 200 Payout { "status": "CONFIRMED", … }
{ "outcome": "FAILED", "failure_reason": "numéro refusé" }       -> 200 Payout { "status": "FAILED", … }
```

`CONFIRMED` exige `external_reference` ; `FAILED` exige `failure_reason` (3 à 500 caractères) ; mélanger les deux : `422`. Un
versement ne change d'état qu'une fois : le même résultat rejoué rend `200` sans nouvelle écriture ; un résultat contraire
ensuite : `409`. Un `FAILED` recrédite le droit de la partie, qui peut être reversé par un nouveau lot.

**Codes d'erreur** : `409 PAYOUT_EXCEEDS_ENTITLEMENT` (montant supérieur au droit disponible, à la demande ou à la validation) ;
`422 VALIDATION_FAILED` (IBAN invalide, devise, montant nul ou décimal, champ inconnu) ; `409 CONFLICT_STATE` ;
`403`/`404` ; `409 LEDGER_LOCKED` sur un grand livre verrouillé.

## 5. Relevés et rapprochements

**Import** : `POST /ledgers/{ledger_id}/accounts/{account_id}/statements?source=wave&statement_date=2026-12-31&closing_balance=0`
avec un corps `text/csv` :

```
external_ref;value_date;amount;currency
WV-0001;2026-12-15;19800;XOF
WV-0002;2026-12-16;-19800;XOF
```

Séparateur `;` obligatoire, en-tête obligatoire, montant entier non nul, **positif = entrée d'argent** sur le compte (une sortie est négative). `201` rend
`{ statement_import_id, account_id, lines_created, lines_matched, lines_existing }`. Une ligne déjà présente (même compte, même
source, même référence) n'est pas recréée. Le même fichier réimporté avec d'autres paramètres : `409 CONFLICT_STATE`. Caractères
de contrôle dans une référence : `422`.

**Rapprochement automatique** : à l'import, une ligne est rapprochée seule quand sa référence est celle d'une recharge PSP, d'une
contestation, d'un remboursement ou d'un versement **et** que son signe et son montant égalent le mouvement net de cette
transaction sur le compte (ou son brut, quand des frais sont portés sur le même compte). Sinon la ligne reste non rapprochée.

**Manuel** : `GET /ledgers/{ledger_id}/statement-lines?account_id=…&matched=false`, puis
`POST /statement-lines/{id}/match` avec `{ "transaction_id": "…" }` **ou** `{ "anomaly_id": "…" }` (jamais les deux, aucun autre
champ : `400`). Une ligne se rapproche une seule fois (`409`). Une ligne ne se rapproche pas à la transaction d'une demande de
remboursement déjà recréditée (`409`, motif : échec constaté).

**État** : `GET /ledgers/{ledger_id}/reconciliation` rend, par compte d'argent (comptes de PSP, banque, et tout compte qui a reçu
un relevé), `lines_total`, `lines_unmatched`, `statement_balance`, `statement_date`, `ledger_balance`, `reconciled`. Un compte est
rapproché quand toutes ses lignes sont rapprochées et que le solde du relevé égale le solde du grand livre à la date du relevé
(plus les anomalies expliquées). Un compte avec des mouvements et sans relevé n'est pas rapproché. Le solde de clôture est celui
que l'importeur déclare : il n'est pas recoupé avec la somme des lignes (limite consignée).

## 6. Réclamations tardives et demande de remboursement du back-office

- **Réclamation tardive de type ajustement** : `POST /ledgers/{ledger_id}/late-adjustments`
  `{ "beneficiary_party_id": "…", "amount": 1500, "currency": "XOF", "reason": "…" }` : `202` ; même circuit à deux que les autres
  réclamations tardives (`postLateClaim`), mêmes bornes (`LATE_CLAIM_INVALID` hors limites).
- **Remboursement tardif** (`postLateClaim`, déjà au contrat) : en mobile money, le numéro de destination peut être **autre que
  celui du festivalier, sans code de vérification** ; un contrôle à deux personnes et une preuve le remplacent (écart accepté,
  limite consignée). Sur un grand livre verrouillé, le remboursement est sans frais ; l'espèce n'y est pas possible.
- **Demande de remboursement créée par le back-office** : `POST /refund-requests`
  `{ "wallet_id": "…", "destination": { "method": "BANK_TRANSFER", "iban": "<IBAN valide>" }, "reason": "…" }` : `201`, demande
  `REQUESTED`, ensuite le circuit habituel (approbation par une autre personne, paiement hors système, confirmation `PAID` ou
  `FAILED`). `WAVE` et `ORANGE_MONEY` : `msisdn` au lieu de `iban`. Un numéro mobile différent de celui du titulaire vérifié passe
  par l'attente du titulaire (`AWAITING_HOLDER`).
- **`FAILED` d'un remboursement et rapprochement** : si une ligne de relevé est rapprochée à la sortie d'argent de la demande, la
  confirmation `FAILED` répond `409` (le paiement est visible à la banque) ; la demande reste confirmable `PAID`.

## 7. Relevés des parties, relevé du festivalier, export comptable

**Relevé d'une partie** : `GET /operators/{operator_id}/events/{event_id}/statements/{party_kind}` avec `party_kind` =
`MERCHANT`, `ORGANIZER`, `OPERATOR` ou `PLATFORM` ; `party_id` pour un commerçant. Rôles : `MERCHANT_ADMIN` (son commerçant),
`ORGANIZER_ADMIN`, `OPERATOR_ADMIN` pour le commerçant ; `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` pour l'organisateur ;
`OPERATOR_ADMIN` pour le prestataire ; `PLATFORM_ADMIN` pour la plateforme. Une partie hors de son périmètre : `404`.
Pagination par curseur (`limit`, `cursor`, `has_more`, `next_cursor`). **Ordre des lignes = ordre d'écriture au grand livre.**
L'organisateur voit une catégorie « Ventes internes » (les ventes et annulations de ses commerçants internes, hors commissions).
`closing_balance` (facultatif au contrat) **n'est pas servi** dans le JSON ; le CSV (`format=csv`, colonnes
`occurred_at,type,label,amount,balance`) porte le solde courant ligne à ligne.

**Relevé du festivalier** : `GET /me/wallets/{wallet_id}/statement` : CSV (`occurred_at,type,label,amount,balance`), son
portefeuille seulement.

**Correspondance comptable** : `POST /operators/{operator_id}/account-mappings` crée une **nouvelle version** pour une entité
(`entity_party_id`, `valid_from`, liste de `mappings` : `purpose`, `transaction_type` facultatif, `debit_account`,
`credit_account`). Une version **remplace la précédente en entier** : un couple (finalité, type) absent de la nouvelle version est
non mappé. Aucune version n'est modifiée ni supprimée ; une date `valid_from` non postérieure à la version en vigueur : `422`.
Aucun jeu de comptes SYSCOHADA n'est livré : à saisir et à faire valider par l'expert-comptable.

**Export comptable** : `GET /operators/{operator_id}/accounting-exports?entity=…&from=2026-01-01&to=2027-12-31` : CSV
`ligne,date,transaction_id,transaction_type,purpose,sens,debit_account,credit_account,amount,currency`. Les périodes sont des
**jours UTC**, bornes comprises, quel que soit le fuseau du serveur. Les couples (finalité, type) sans correspondance sont listés
**en tête** en lignes `NON_MAPPE` (type, finalité, total des valeurs absolues) et comptés dans l'en-tête de réponse
`X-Unmapped-Count` ; leurs écritures restent dans le fichier avec des comptes légaux vides, rien n'est omis. Les écritures
suivent, une ligne `ECRITURE` par écriture de l'entité, avec les comptes de la version en vigueur à la date de l'écriture.
**Attention au double compte** : chaque ligne porte les deux comptes légaux et son `sens` (`D` ou `C`) sur le compte de
l'application ; si les deux côtés d'une même transaction sont dans le fichier, n'en prendre qu'un côté pour la balance.

## 8. Formats des fichiers

| Fichier | Séparateur | Colonnes |
|---|---|---|
| Relevé importé (entrée) | `;` | `external_ref;value_date;amount;currency` |
| Export d'un lot | `,` | `beneficiary,method,destination,amount,currency,reference` |
| Soldes restants | `,` | `wallet_id,paid,cash_due,promo` |
| Relevé d'une partie, relevé du festivalier | `,` | `occurred_at,type,label,amount,balance` |
| Export comptable | `,` | `ligne,date,transaction_id,transaction_type,purpose,sens,debit_account,credit_account,amount,currency` |

Tous les fichiers sortants sont en UTF-8, fin de ligne `CRLF`, quotes selon la RFC 4180, et **neutralisent les formules** (une
cellule qui commence par `=`, `+`, `-` ou `@` est précédée d'une apostrophe).

## 9. Ce qui est simulé ou limité jusqu'à la mission 12b

- **Copie externe des scellements d'audit** : simulée. Un scellement et sa copie sont dans la même base ; le faux refuse de
  démarrer en production (OP-N131).
- **Alertes d'exploitation** (somme non nulle, versement non confirmé après 48 h, ligne de relevé non rapprochée, transaction
  longue) : écrites dans l'audit, le journal et un canal de la base ; **aucun envoi à une personne** (OP-N132).
- **Code de vérification d'un remboursement tardif vers un autre numéro** : absent (OP-N139).

## 10. Changement pour les applications Dart (clients générés)

Le contrat ajoute des valeurs d'énumération ; le générateur Dart numérote ses énumérations en ligne dans l'ordre d'apparition.
**Renommage accepté par le porteur le 17/11/2026** : `Event.status` passe de `Status4` à `Status5`, `TokenFamily.status` de
`Status5` à `Status6`, et `Payout.status` est `Status4`. Les applications Dart ajustent leurs types à la régénération ; aucun
changement de valeur ni de comportement.
