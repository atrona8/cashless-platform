---
work_package_id: WP01
title: Contrat d'API et types
dependencies: []
requirement_refs: [FR-030, C-001]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA
base_commit: 2e05132338890cf635d630c7d52b4397005042ee
created_at: '2026-10-27T12:27:42.259101+00:00'
subtasks: [T001, T002, T003, T004]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/
create_intent: []
execution_mode: code_change
model: sonnet
owned_files: [packages/contracts/**, apps/api/src/http/messages.fr.json, apps/api/src/http/messages.en.json]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Contrat d'API et types

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (FR-030, C-001), `contracts/openapi-additions.md` (**la liste des changements**),
`contracts/cash.md` (règles 2 à 6 et 9), `contracts/psp.md` (sections Configurations, Choix par
événement, Recharge PSP, Notifications), `research.md` R-04, R-10, R-11 et **R-20** (qui fait foi),
`data-model.md` (`cash_session`, `psp_configuration`, `event_psp_selection`, `psp_topup`). Code de
référence : `packages/contracts/openapi.yaml` (opérations `openCashSession`, `countCashSession`,
`closeCashSession`, `createCashTopup`, `initiatePspTopup`, `getPspTopup`, `receivePspWebhook`,
`takeDeposit`, `refundDeposit`, `refundCashDue`, `releaseMedia`, `reversePayment` pour le modèle
d'une sécurité « terminal ou personne » ; schémas `CashSession`, `PspTopup`, `PspTopupRequest`,
`ApprovalAction`, `ProblemCode`, `CashTopupRequest`, `CashDueRefundRequest`),
`packages/contracts/scripts/generate.mjs` et `check.mjs`,
`packages/contracts/scripts/generate-dart.sh`. En cas de contradiction entre sources, applique la
priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` >
SPECIFICATION > `PRD.md`) et **signale-la**, sans la trancher en silence. Ne modifie jamais un
`.sql` généré de `packages/ledger-sql/`.

## Objective

Mettre `packages/contracts/openapi.yaml` en conformité avec `contracts/openapi-additions.md` et la
section R-20 de la recherche : corriger dix opérations existantes, en ajouter douze, compléter les
schémas, la liste fermée `ApprovalAction` et la documentation des motifs ; puis régénérer les types
TypeScript et Dart. Ce lot ne contient aucun code applicatif : il fige les noms (`operationId`,
codes, champs) que tous les autres lots implémentent.

## Context

- Concern IC-09 (partie contrat) du plan ; FR-030 (contrat et types), C-001 (priorité des sources).
- Le contrat actuel date des missions antérieures : il prévoit une authentification par jeton de
  personne seul pour les sessions de caisse, et décrit des sessions « à créer ». R-04 le corrige
  (renforcement : terminal ET personne). Chaque correction est une **contradiction signalée** (§0.3)
  déjà consignée au plan : tu l'appliques et tu la rappelles dans le compte rendu.
- Dépendants de ce lot (ils citent tes noms à la lettre) : WP07 (codes de problème, ports),
  WP08 (`openCashSession`, `countCashSession`, `closeCashSession`, `getCashSession`,
  `listCashSessions`), WP09 (`createCashTopup`, `takeDeposit`, `refundDeposit`, `refundCashDue`,
  `releaseMedia`), WP10 (configurations, choix par événement), WP11 (`initiatePspTopup`,
  `getPspTopup`, `cancelPspTopup`), WP12 (`receivePspWebhook`), WP13 (`ApprovalAction`).
- Les applications mobiles (Dart) consomment les types générés : une divergence TS/Dart ou un nom
  instable casse un autre dépôt. Les noms ci-dessous sont définitifs.
- Aucune migration, aucun code TypeScript de `apps/api` n'est modifié par ce lot (exceptions
  d'une ligne listées dans « Arbitrages »).

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**,
avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le
compte rendu. Aucun faux en production. Aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Ils priment sur le texte ci-dessus et sur `contracts/openapi-additions.md` en cas de doute.

- **Noms figés** : `getCashSession`, `listCashSessions`, `createPspConfiguration`,
  `listPspConfigurations`, `getPspConfiguration`, `getEventPspSelections`, `setEventPspSelection`,
  `cancelPspTopup`. Chemins exactement ceux du tableau d'`openapi-additions.md`. Ne renomme rien.
- **Huit opérations d'`openapi-additions.md`, plus quatre demandes d'approbation** (compléments 3
  et 4) : `requestPspConfigurationChange` et les trois routes de demande des actions sans route
  (voir complément 4). Aucune autre opération. `contracts/cash.md` règle 9 cite un
  `createApprovalRequest` qui n'existe pas dans `openapi.yaml` (seulement `list/get/approve/
  rejectApprovalRequest`) : les quatre routes ci-dessous le remplacent ; signale l'écart.
- **Complément 1 : `createCashTopup` gagne `staffBearer`** dans sa première entrée `security` (trois
  preuves + `staffBearer`), comme `takeDeposit` : `contracts/cash.md` règle 7 exige un terminal ET
  un `CASHIER`/`SUPERVISOR`, le contrat actuel ne porte que les trois preuves. Renforcement de
  cohérence, à signaler.
- **Complément 2 : code de problème `PAYLOAD_TOO_LARGE` (`413`)** ajouté à `ProblemCode` (le
  `413 PayloadTooLarge` existant ne cite que `BATCH_TOO_LARGE`, sens faux pour une notification) ;
  fichiers désormais dans la carte du lot : une entrée `PAYLOAD_TOO_LARGE` dans
  `apps/api/src/http/messages.fr.json` et `messages.en.json` (imite l'entrée voisine
  `BATCH_TOO_LARGE`), faute de quoi le test des messages échoue. Consigne-la.
- **`WALLET_BLOCKED` reste `422`** (code existant `CL039`). `contracts/psp.md` et R-20 écrivent `409
  WALLET_BLOCKED` à l'initiation : c'est une contradiction avec le contrat existant et avec
  `errors/sqlstate-map.ts` (priorité §0.3 : `openapi.yaml` et le code testé). Décris l'initiation
  avec « `422 WALLET_BLOCKED` » et **signale la contradiction** dans le compte rendu.
- **Complément 3 (écart à `openapi-additions.md`, demandé par WP10) : neuf opérations, pas huit.**
  Ajoute `requestPspConfigurationChange` : `POST
  /psp-configurations/{psp_config_id}/approval-requests` (`humanBearer`, `OPERATOR_ADMIN`), corps
  `{status: ACTIVE|SUSPENDED, compliance_ref}` (`compliance_ref` obligatoire pour `ACTIVE`, R-20
  A34), réponse `202` (`ApprovalRequestAccepted`, action `PSP_CONFIGURATION`), exécutée par un autre
  `OPERATOR_ADMIN` via `approveApprovalRequest`. Ajoute aussi `PSP_CONFIGURATION` à
  `FeeRuleScopeType` (portée de frais par configuration, R-20, ADR-133) et décris-le dans
  `createFeeRule`/`replaceFeeRule` si ces opérations énumèrent les portées. Signale les deux comme
  écarts à `openapi-additions.md`.
- **Complément 4 (arbitrage du 27/10/2026) : trois routes de demande de plus**, même forme que
  `requestPspConfigurationChange` (`humanBearer`, `Idempotency-Key`, réponse `202`
  `ApprovalRequestAccepted` = `ApprovalRequest` `PENDING`, `401`/`403`/`404`/`409`/`422`, exécution
  par une autre personne via `approveApprovalRequest`, auteur et valideur distincts). Chemins et
  noms **figés** (WP08 et WP13 les servent à l'identique) :
  - `requestCashDeposit` : `POST /ledgers/{ledger_id}/cash-deposits/approval-requests`, action
    `CASH_DEPOSIT`, corps `{amount, bank_reference}` (le `ledger_id` vient du chemin), rôles
    `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de l'événement du grand livre (`contracts/cash.md`).
  - `requestWalletUnblock` : `POST /wallets/{wallet_id}/unblock/approval-requests`, action
    `WALLET_UNBLOCK`, corps vide `{}` (additionalProperties faux), rôle `ORGANIZER_ADMIN` seul
    (FR-028).
  - `requestLateChargeback` : `POST /chargebacks/{chargeback_id}/approval-requests`, action
    `LATE_CHARGEBACK`, corps vide `{}`, rôles `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` (R-20).
  Ni l'événement ni le prestataire ne viennent du corps : lus en base. Objet d'un autre prestataire
  : `404`. Signale les quatre routes comme écarts à `openapi-additions.md` (neuf plus trois).
- **`PAYLOAD_TOO_LARGE` (`413`)** est le code que WP12 utilise pour une notification trop grande
  (pas `BATCH_TOO_LARGE`).
- **`PspTopupRequest.provider`** porte la méthode (`WAVE|ORANGE_MONEY|CARD`, schéma `PspProvider`)
  alors que `data-model.md` l'appelle `method` et réserve `provider` aux quatre fournisseurs. Le nom
  du champ HTTP existant **ne change pas** (rupture pour les apps) ; ajoute à sa description : «
  valeur = méthode (`method` du modèle de données) ; le fournisseur est résolu par la configuration
  ». Signale l'écart de nommage.
- **`closeCashSession`** : la clé d'écriture est `cash-close:<cash_session_id>` (R-20, garde de
  caisse), et non `bo:<Idempotency-Key>` (texte actuel) : corrige la description. La session ne
  porte que les états `OPEN` et `CLOSED` dans le contrat : `CLOSING` n'existe qu'à l'intérieur de la
  transaction de fermeture (jamais validé), il n'entre pas dans l'énumération.
- **`PSP_TOPUP_NOT_CREDITED` n'est pas un `ProblemCode`** : c'est un type d'anomalie et un motif
  d'échec de recharge (`failure_reason`). `failure_reason` reste une **chaîne libre** : cite, à
  titre indicatif dans sa description, `THREE_DS`, `NO_FINGERPRINT`, `CARD_DAILY_LIMIT`,
  `LEDGER_STATUS`, `CANCELLED` ; l'ensemble fermé est arrêté par WP11, pas ici.
- **Pas d'`x-process`** sur les opérations nouvelles sans avoir lu `media-isolation.spec.ts` et
  `device-e2e.ts` : suis les opérations voisines du même type (`takeDeposit` porte
  `x-process: public`) mais vérifie par les tests unitaires qu'aucun test ne dérive de ce champ.
- **Ne modifie aucun fichier de `apps/api`** hors les deux fichiers de messages ci-dessus. Si un
  test de `apps/api` échoue à cause du contrat (liste des opérations de terminal, matrice des
  preuves), **ne le corrige pas** : liste-le dans le compte rendu avec le lot qui doit l'adapter.

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Aucune dépendance. Le worktree est
attribué par lane d'après `lanes.json`. Commande : `spec-kitty agent action implement WP01 --agent
claude --mission recharges-caisses-psp-01M5YEBA`. Worktree sans `node_modules` : fais les liens de
`node_modules/@cashless/*` et du paquet `yaml` (voir la mémoire du poste) avant de lancer les
scripts.

## Subtasks

### T001 — Corriger les opérations existantes

But : appliquer le tableau « Corrections » d'`openapi-additions.md`, ligne par ligne, plus le
complément 1. Une correction = la `security`, les paramètres, les schémas **et** la description.

1. `openCashSession` (`POST /cash-sessions`) : `security` = trois preuves (`deviceMtls`,
   `deviceToken`, `deviceSignature`) **et** `staffBearer` dans une seule entrée, comme `takeDeposit`
   ; paramètres de terminal (`DeviceRequestId`, `SignatureInput`, `Signature`, `ContentDigest`) à la
   place de `RequestId` seul ; corps : `cash_account_id` **facultatif** (retire de `required`), s'il
   est fourni il doit être la caisse du terminal ; `device_id` retiré du corps (le terminal est
   celui qui signe : un champ de plus serait une source de confusion — signale ce retrait). Réponse
   `201` inchangée sauf `status`. Ajoute `422` (mode d'application ≠ `TOPUP_DESK`,
   `DEVICE_MODE_NOT_ALLOWED`) et `403`. Description : une caisse = un terminal `TOPUP_DESK`, compte
   `A-CAISSE-<série>` créé à la première ouverture, une session `OPEN` par caisse et par terminal,
   grand livre `LIVE` ou `CLOSING` (`409` sinon), aucune écriture comptable, `Idempotency-Key =
   <série>:<seq>` (numérotation du terminal).
2. `countCashSession` : même sécurité ; réponse `CashSession` sans théorique ni écart ; `422` pour
   un montant négatif ; `409 CONFLICT_STATE` si la session n'est pas `OPEN` ou au 11e comptage (au
   plus 10, R-20 A26) ; `403` si la personne n'est pas `CASHIER`/`SUPERVISOR` de l'événement.
   Description : « le théorique n'est jamais renvoyé ».
3. `closeCashSession` : deux entrées `security` : (a) trois preuves + `staffBearer`, (b)
   `humanBearer` ; description : `SUPERVISOR` de l'événement **n'ayant fait aucun comptage de la
   session** (`403 FORBIDDEN` sinon), comptage obligatoire (`409 CONFLICT_STATE`), une transaction
   (verrou de la session et de la caisse, théorique = solde, `CASH_CLOSE`, `CASH_DIFF` si écart non
   nul, caisse ramenée à 0), rejeu de la même `Idempotency-Key` : même réponse, terminal suspendu ou
   révoqué : fermeture possible par le back-office. Corrige la clé d'écriture (voir Arbitrages).
   Ajoute les paramètres de terminal comme sur `takeDeposit` pour l'entrée (a).
4. `initiatePspTopup` : première entrée = trois preuves + `staffBearer` (guichet `TOPUP_DESK`,
   `CASHIER`/`SUPERVISOR`), seconde = `humanBearer` (festivalier, son portefeuille) ; retire la
   phrase sur `CARD_DAILY_LIMIT` à l'initiation (R-11, R-16 : le plafond par carte se contrôle à la
   notification, la carte étant inconnue avant) et le `422 CARD_DAILY_LIMIT` des réponses de cette
   opération ; ajoute `409 EVENT_CLOSING`, `409 PSP_NOT_CONFIGURED`, `422 WALLET_BLOCKED` (voir
   Arbitrages), `422 PSP_REJECTED`, `503 PSP_UNAVAILABLE` ; `Idempotency-Key` obligatoire ; au plus
   3 recharges `PENDING` par portefeuille et 20 par terminal (`409 CONFLICT_STATE`). La clé
   d'écriture `TOPUP` devient `wave:<config>:<paiement>`, `om:<config>:<paiement>`,
   `psp:<config>:<paiement>` (R-20 : qualifiée par la configuration pour tous les moyens) : corrige
   ici et dans `receivePspWebhook`. Le schéma `PspTopupRequest` ne change pas.
5. `getPspTopup` : le demandeur (même terminal et même personne, ou même festivalier) ou un
   `ORGANIZER_ADMIN` de l'événement ; sinon `404` (décris-le ; `security` inchangée mais ajoute
   `staffBearer` à l'entrée du terminal pour la même raison que 4).
6. `receivePspWebhook` : remplace « rien n'est écrit » par la description R-10/R-20 (ordre : taille
   ≤ 64 Kio → configuration `ACTIVE` du fournisseur → signature à temps constant sur deux secrets →
   horodatage ±300 s → conservation puis traitement) ; ajoute la réponse `413` (`PayloadTooLarge`,
   code `PAYLOAD_TOO_LARGE`) ; décris les refus signalés (journal de sécurité
   `psp.webhook.rejected`, alerte bornée, compteur sans corps, **rien** écrit au grand livre ni au
   registre brut) ; la réponse `200` reste `{received: true, duplicate}` (vérifie le schéma
   existant) ; remplace l'anomalie « `PSP_TOPUP_OVER_LIMIT` + remboursement » par la description des
   cas non créditables (anomalie `PSP_TOPUP_NOT_CREDITED` ou `PSP_TOPUP_OVER_LIMIT`, argent à rendre
   hors plateforme, OP-N82).
7. `takeDeposit`, `refundDeposit` : `cash_session_id` facultatif dans leur corps (schéma
   `DepositRequest`, réponse `DepositState` : ajoute-y `cash_session_id`) ; description : espèces →
   la session `OPEN` du terminal, sinon `409 CONFLICT_STATE` ; `cash_session_id` fourni = celle du
   terminal, sinon `409`.
8. `refundCashDue`, `releaseMedia` : `cash_session_id` **accepté** (retire « facultatif tant que les
   sessions ne sont pas livrées » dans `CashDueRefundRequest`, « obligatoire si des espèces sont
   rendues » dans `MediaReleaseRequest`) ; renvoyé dans la réponse (ajoute le champ aux schémas de
   réponse `CashDueRefundResult` et `MediaReleaseResponse`).
9. `createCashTopup` : ajoute `staffBearer` (complément 1) ; `CashTopupRequest.cash_session_id` :
   facultatif, doit être la session ouverte du terminal ; `TopupResult` : ajoute `cash_session_id` ;
   description : aucune espèce sans session `OPEN` (`409 CONFLICT_STATE`), plafond dépassé → `422
   WALLET_LIMIT_EXCEEDED`/`MONTHLY_TOPUP_LIMIT_EXCEEDED` et rien d'écrit, caution `DUE` prise
   ensuite dans une transaction distincte (le champ `deposit` porte l'état lu dans la transaction du
   crédit).
10. Schéma `PspTopup.failure_reason` : description (voir Arbitrages) ; ne change pas `status`.

Validation :
- [ ] Les dix corrections sont dans le fichier ; `git diff` relu contre le tableau
  d'`openapi-additions.md`.
- [ ] Aucune opération ne perd une exigence d'authentification (seules les `security` de
      `openCashSession`, `countCashSession`, `closeCashSession` et `initiatePspTopup` changent, et
      elles se renforcent).

### T002 — Ajouter les douze opérations

But : déclarer les opérations du tableau « Opérations ajoutées » avec leurs schémas. Place-les près
de leurs voisines (sessions de caisse, recharges PSP, section organisateur/événement).

1. `getCashSession` (`GET /cash-sessions/{cash_session_id}`) : deux entrées `security` (trois
   preuves + `staffBearer` ; `humanBearer`). Réponse `200 CashSession` ; `404` pour une session d'un
   autre prestataire ou d'un autre événement que ceux de la personne. Description : `CASHIER` ses
   sessions seulement, **sans théorique** tant que `OPEN` (et jamais l'écart) ; `SUPERVISOR` et
   `ORGANIZER_ADMIN` de l'événement : théorique et écart après fermeture (`contracts/cash.md` règle
   5).
2. `listCashSessions` (`GET /events/{event_id}/cash-sessions`) : `humanBearer` ; rôles `SUPERVISOR`,
   `ORGANIZER_ADMIN` ; filtres `status` (`OPEN`, `CLOSED`), `Cursor`, `Limit` (paramètres existants)
   ; réponse sur le modèle de `listApprovalRequests` (`data`, `next_cursor`, `has_more`).
3. `createPspConfiguration` (`POST /organizers/{organizer_id}/psp-configurations`) : `humanBearer`,
   `OPERATOR_ADMIN` ; corps `PspConfigurationCreate` : `method` (`WAVE`, `ORANGE_MONEY`, `CARD`),
   `provider` (`WAVE`, `ORANGE_MONEY`, `PAYDUNYA`, `STRIPE` ; compatible avec le moyen, sinon
   `422`), `holder_party_id`, `secret_ref` (motif `^psp/<uuid>/[A-Za-z0-9._-]+$`, jamais un secret :
   une valeur qui ressemble à un secret est refusée `422`), `is_default`, `valid_from`,
   `valid_until` ; réponse `201 PspConfiguration` au statut `DRAFT`. `Idempotency-Key`. Erreurs
   `403`, `404`, `409`, `422`.
4. `listPspConfigurations` (`GET …/psp-configurations`) et `getPspConfiguration` (`GET
   /psp-configurations/{psp_config_id}`) : `OPERATOR_ADMIN` du prestataire, `ORGANIZER_ADMIN` de
   l'organisateur (lecture) ; `secret_ref` rendu au seul `OPERATOR_ADMIN` (champ nullable, absent ou
   `null` pour l'autre rôle) — dis-le dans la description du champ.
5. `getEventPspSelections` (`GET /events/{event_id}/psp-selections`) : `ORGANIZER_ADMIN`,
   `OPERATOR_ADMIN` ; réponse `{data: EventPspSelection[]}` (une entrée par moyen choisi).
6. `setEventPspSelection` (`PUT /events/{event_id}/psp-selections/{method}`) : `ORGANIZER_ADMIN` ;
   corps `{psp_config_id}` ; `200 EventPspSelection` hors `LIVE`, `202` + demande
   (`ApprovalRequestAccepted`, action `EVENT_PSP_SELECTION`) pendant `LIVE` ; `422
   VALIDATION_FAILED` si la configuration n'est pas du même organisateur, `ACTIVE`, du même moyen,
   de titulaire = détenteur des fonds du grand livre.
7. `cancelPspTopup` (`POST /topups/psp/{topup_id}/cancel`) : mêmes deux entrées `security` que
   `initiatePspTopup` ; le demandeur seulement ; `200 PspTopup` (`CANCELLED`) seulement si le PSP
   confirme l'annulation, sinon `409 CONFLICT_STATE` ; un succès notifié ensuite est traité comme
   non crédité (motif `CANCELLED`, anomalie `PSP_TOPUP_NOT_CREDITED`).
8. Schémas à créer : `PspConfiguration` (`psp_config_id`, `organizer_id`, `method`, `provider`,
   `holder_party_id`, `secret_ref` nullable, `compliance_ref` nullable, `status`
   `DRAFT|ACTIVE|SUSPENDED`, `is_default`, `valid_from`, `valid_until`, `version`, `created_by`,
   `approved_by` nullable, `created_at`), `PspConfigurationCreate`, `EventPspSelection` (`event_id`,
   `method`, `psp_config_id`, `selected_by`, `approved_by` nullable, `selected_at`), `PspMethod` si
   l'énumération n'existe pas. Réutilise `PspProvider`, `Timestamp`, `Currency`. Le nom du champ est
   `psp_config_id` partout (aligné sur `PspTopup.psp_config_id` et sur l'URL de webhook).
10. `requestPspConfigurationChange` : voir complément 3 ; `Idempotency-Key`, `404` si la
   configuration n'est pas du prestataire, `409 CONFLICT_STATE` si la transition est impossible
   (`DRAFT|SUSPENDED → ACTIVE`, `ACTIVE → SUSPENDED`).
9. `CashSession` : ajoute `closed_by` (nullable), `counted_amount` (nullable, figé à la fermeture),
   `expected_amount` (nullable), et précise que `expected_amount` et `difference` ne sont rendus
   qu'après fermeture et seulement à un `SUPERVISOR` ou `ORGANIZER_ADMIN` (nuls sinon, y compris
   dans les réponses d'`openCashSession` et `countCashSession`). `last_count` reste.
11. `requestCashDeposit`, `requestWalletUnblock`, `requestLateChargeback` : voir complément 4
   (chemins, corps, rôles) ; mêmes `Idempotency-Key`, `RequestId`, `AcceptLanguage` et réponses que
   `requestPspConfigurationChange` ; `404` si l'objet n'est pas du prestataire ; `409
   CONFLICT_STATE` si l'état de l'objet ne permet pas la demande (portefeuille non bloqué par une
   contestation, contestation non tardive) ; exemples valides.

Validation :
- [ ] Les douze `operationId` existent, uniques ; chemins identiques à `openapi-additions.md` et au
      complément 4 pour les trois routes de demande.
- [ ] Chaque opération ajoutée porte `security`, `Idempotency-Key` si elle écrit, `RequestId`,
      `AcceptLanguage`, et les réponses `401`/`403`/`404` pertinentes.

### T003 — Schémas, codes d'erreur, `ApprovalAction`, statuts et motifs

But : compléter les listes fermées et la documentation transverse.

1. `ApprovalAction` : ajoute `WALLET_UNBLOCK` et `CASH_DEPOSIT` à l'énumération **et** à la
   description (correspondance avec l'opération : `CASH_DEPOSIT` demandée par `requestCashDeposit`,
   `WALLET_UNBLOCK` par `requestWalletUnblock`, `LATE_CHARGEBACK` par `requestLateChargeback`,
   `PSP_CONFIGURATION` par `requestPspConfigurationChange` : complément 4). Vérifie que
   `PSP_CONFIGURATION`, `EVENT_PSP_SELECTION`, `LATE_CHARGEBACK` y sont déjà (ils y sont) ; pour
   `CASH_DEPOSIT` documente la charge `{ledger_id, amount, bank_reference}`, pour `WALLET_UNBLOCK`
   `{wallet_id}`, pour `PSP_CONFIGURATION` `{psp_config_id, compliance_ref}` et
   `{psp_config_id, status: SUSPENDED}`.
2. `ProblemCode` : ajoute `PAYLOAD_TOO_LARGE` (énumération **et** description, `413`). Le script
   `generate.mjs` tire les statuts de la description : respecte le format des lignes voisines
   (`` - `PAYLOAD_TOO_LARGE` (413) : … ``). Vérifie que `PSP_TOPUP_NOT_CREDITED` n'y est pas ajouté.
3. Descriptions des codes existants à compléter, sans changer leur statut : `PSP_NOT_CONFIGURED`
   (titulaire contrôlé à la résolution), `PSP_UNAVAILABLE` (inclut « fournisseur indisponible en
   production tant que les adaptateurs réels ne sont pas livrés », OP-N81), `WALLET_BLOCKED`
   (initiation et notification), `CONFLICT_STATE` (cas « aucune session de caisse ouverte »).
   `CASH_SESSION_REQUIRED` n'est **pas** créé (ADR-89).
4. Si un schéma du contrat énumère les types d'anomalie (cherche `CARD_VELOCITY` et
   `LATE_CHARGEBACK` dans les énumérations ; un `grep` suffit), ajoute-y `PSP_TOPUP_NOT_CREDITED` ;
   sinon n'en crée pas.
5. Messages (dans la carte du lot, voir Arbitrages) : `PAYLOAD_TOO_LARGE` dans `messages.fr.json` et
   `messages.en.json`, même structure que l'entrée `BATCH_TOO_LARGE`.
6. Exemples : chaque exemple ajouté ou modifié valide son schéma (le script de génération ne le
   vérifie pas : relis-les). Aucun secret réaliste dans un exemple : `secret_ref` d'exemple =
   `psp/6f1c…/wave-prod`, jamais une valeur de secret.

Validation :
- [ ] `ApprovalAction` contient les deux nouvelles valeurs ; `ProblemCode` contient
      `PAYLOAD_TOO_LARGE` ; rien d'autre n'est ajouté à `ProblemCode`.
- [ ] Les deux fichiers de messages contiennent l'entrée nouvelle ; test unitaire des messages vert.

### T004 — Régénérer les types et vérifier

But : TypeScript et Dart à jour, vérification verte, effets de bord listés.

1. Depuis la racine : `npm run generate -w @cashless/contracts` (types TS, codes et statuts de
   problème), puis `npm run generate:dart -w @cashless/contracts`. Le SDK Dart peut être absent du
   poste (le script le dit et sort 0 hors CI) : **dis dans le compte rendu si les types Dart n'ont
   pas pu être régénérés** ; la CI le vérifiera (`CI` exige Dart). N'écris jamais un fichier de
   `generated/` ou de `dart/lib` à la main.
2. `npm run check -w @cashless/contracts` (types à jour, Dart à jour si SDK présent) et
   `npm run typecheck -w @cashless/contracts`.
3. Dans `apps/api` : `npx tsc --noEmit` puis `npx jest test/unit` (en série). Relève les échecs qui
   viennent du contrat : codes sans message, liste d'opérations, `PROBLEM_STATUSES`. Corrige
   seulement les deux fichiers de messages ; consigne le reste (test, cause, lot qui doit
   l'adapter). Attendu : `test/integration/end-to-end/device-auth-matrix.spec.ts` (et son registre
   `device-auth-cases/`) listera les nouvelles opérations de terminal comme « non servies » (404)
   tant que WP08, WP09 et WP11 ne les servent pas ; ne le lance pas, il tourne chez l'orchestrateur.
4. Vérifie qu'aucun opérationId n'est dupliqué et que tous les `$ref` se résolvent (le script de
   génération échoue sinon). Compte avant/après : opérations (+9), valeurs d'`ApprovalAction` (+2),
   `ProblemCode` (+1).
5. Relis le diff complet du contrat : lignes de 100 caractères non exigées dans le YAML existant,
   mais ne reformate pas les lignes que tu ne modifies pas (diff minimal).

Validation :
- [ ] `check` et `typecheck` verts ; `generated/` et `dart/lib` (si SDK) à jour et commités avec le
  contrat.
- [ ] Liste des tests d'`apps/api` réagissant au contrat, dans le compte rendu.

## Test Strategy

- Aucun test applicatif écrit. Preuves : `npm run check -w @cashless/contracts` vert, `npm run
  typecheck -w @cashless/contracts` vert, `npx jest test/unit` dans `apps/api` (inchangé hors
  messages), relecture du diff contre `contracts/openapi-additions.md` (tableau de correspondance
  opération par opération dans le compte rendu).
- Aucune base n'est nécessaire : `cashless_test` reste réservée à l'orchestrateur ; ne lance pas
  pgTAP.
- Horloge Docker : sans objet pour ce lot.

## Definition of Done

- [ ] T001 à T004 faits ; dix opérations corrigées, douze ajoutées, `ApprovalAction` et
  `ProblemCode`
      complétés ; `generated/` à jour.
- [ ] `check` et `typecheck` du paquet verts ; tests unitaires d'`apps/api` verts ou échecs
  expliqués.
- [ ] Aucun `.sql` modifié ; aucune dépendance ajoutée ; aucun code de `apps/api` modifié hors
  messages.
- [ ] Matrice d'acceptation : FR-030 et C-001 passés à `pass` avec commande et résultat.
- [ ] Compte rendu du lot : écarts au plan avec leur sens (`WALLET_BLOCKED` 422 contre 409 du plan ;
      `PAYLOAD_TOO_LARGE` ajouté ; `staffBearer` sur `createCashTopup` ; retrait de `device_id` du
      corps d'`openCashSession` ; clé `cash-close`) ; retouches hors carte justifiées (deux fichiers
      de messages) ; les trois routes de demande ajoutées (complément 4) ; points
      soumis au porteur (aucun attendu) ; fichiers à faire relire par une personne (aucun ici, mais
      cite `openapi.yaml` comme source des droits attendus) ; critères couverts avec preuve ; état
      des types Dart.

## Risks

- Un `$ref` ou un exemple faux casse la génération pour tous les lots : lance les scripts après
  chaque grosse série de modifications, pas seulement à la fin.
- Dart : le générateur ignore certains `oneOf` ; n'introduis pas de `oneOf` dont une branche est un
  `$ref` dans une réponse (voir `EXCLUDED` de `generate-dart.sh`).
- Une `security` mal écrite (entrées confondues : « et » dans une entrée, « ou » entre entrées)
  change silencieusement le sens : `openCashSession` = **une** entrée avec quatre schémas.
- Les tests qui parcourent le contrat (`contractDeviceOperations`) classent les opérations par leurs
  schémas `device*` : une faute de frappe sur un nom de schéma les fait disparaître de la matrice.
- Les noms de champs sont repris par WP08 à WP13 : `psp_config_id`, `cash_session_id`, `topup_id`.

## Reviewer Guidance

Tente de casser : (1) une route d'écriture de la caisse qui reste accessible par jeton de personne
seul (`openCashSession`, `countCashSession`) ; (2) une `security` où le terminal devient facultatif
(« ou » à la place de « et ») ; (3) `secret_ref` rendu à un `ORGANIZER_ADMIN` ou présent dans un
exemple avec une vraie valeur ; (4) un champ de théorique (`expected_amount`, `difference`) rendu à
l'agent avant la fermeture dans un exemple ou un schéma de réponse de `countCashSession` ; (5) un
`ProblemCode` ajouté à tort (`CASH_SESSION_REQUIRED`, `PSP_TOPUP_NOT_CREDITED`) ; (6) une opération
ajoutée qui ne figure pas dans `openapi-additions.md` ; (7) des types générés modifiés à la main ou
périmés par rapport au YAML ; (8) une description qui promet un comportement contraire à R-20 (par
exemple le plafond par carte à l'initiation, ou la clé de fermeture `bo:`).
