---
work_package_id: WP04
title: Création, éligibilité, listes et refus
dependencies: [WP01, WP03]
requirement_refs: [FR-002, FR-004, FR-005, FR-006, FR-007, FR-010, FR-014, FR-020, NFR-004]
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
subtasks: [T018, T019, T020, T021, T022, T023, T024]
phase: Phase 2 - Parcours festivalier
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/refunds/
create_intent: [apps/api/src/refunds/refunds.module.ts, apps/api/src/refunds/refund-eligibility.ts, apps/api/src/refunds/refund-requests.service.ts, apps/api/src/refunds/my-refund-requests.controller.ts, apps/api/src/refunds/refund-requests.controller.ts, apps/api/src/refunds/refund-requests.dto.ts, apps/api/test/integration/refunds/create-refund-request.spec.ts, apps/api/test/integration/refunds/list-refund-requests.spec.ts, apps/api/test/integration/refunds/reject-refund-request.spec.ts, apps/api/test/integration/customer-app/me-refund.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/refunds/refunds.module.ts, apps/api/src/refunds/refund-eligibility.ts, apps/api/src/refunds/refund-requests.service.ts, apps/api/src/refunds/my-refund-requests.controller.ts, apps/api/src/refunds/refund-requests.controller.ts, apps/api/src/refunds/refund-requests.dto.ts, apps/api/src/customer-app/me.service.ts, apps/api/src/app.module.ts, apps/api/test/integration/refunds/create*.spec.ts, apps/api/test/integration/refunds/list*.spec.ts, apps/api/test/integration/refunds/reject*.spec.ts, apps/api/test/integration/customer-app/me-refund.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Création, éligibilité, listes et refus

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis `docs/passation-9a/fiche-implementation.md` (démarrage, base `cashless_wp04`, Jest, fin de lot),
ce prompt, puis seulement :

- `docs/passation-9a/contexte-9a.md` : décisions 4, 6, 7, 8, 9 ;
- `contracts/interfaces.md` : `RefundEligibility`, `resolveDestination`, `startHolderChallenge`, noms figés ;
- `contracts/served-operations.md` : lignes de `createMyRefundRequest`, `listMyRefundRequests`, `listRefundRequests`,
  `rejectRefundRequest` et la section `GET /me/wallets` ;
- `research.md` R-04, R-05 (points 1 et 2), R-06, R-10 ; `data-model.md` (table, invariants, états) ;
- `packages/contracts/openapi.yaml` : `createMyRefundRequest` l. 6069-6170, `listRefundRequests` l. 6170-6200,
  `rejectRefundRequest` l. 6411-6450, schémas `RefundRequest*` l. 16220-16335 ;
- code : `customer-app/me.controller.ts` l. 54-115 (garde `@CustomerAuth`, `@Idempotent({scope: app:…})`, `parseLimit`
  l. 23, curseur l. 31) ; `customer-app/me.service.ts` l. 89-141 ; `configuration/provisional-defaults.ts` l. 128-138 ;
  `configuration/sql-config-resolver.ts` l. 150-154 et 367-380 ; `identity/scope-resolver.ts` l. 37 et 108 ;
  `organization/tenant/tenant-access.ts` l. 37 ; `reversals/reversals.controller.ts` l. 62-82 (portée `bo:`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sur ce prompt.

## Objective

Servir quatre opérations du contrat sans rien y ajouter : `createMyRefundRequest`, `listMyRefundRequests`,
`listRefundRequests`, `rejectRefundRequest`, et rendre vraies les valeurs `refund.*` de `GET /me/wallets`. Une seule
fonction d'éligibilité (`evaluateRefundEligibility`) sert la création, `/me/wallets` et (WP05) l'exécution de
l'approbation : jamais deux copies de la règle. À la fin du lot, l'app festivalier ne reçoit plus de `404` sur les
routes de création et de liste (SC-001).

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Hors lot : routes `approve`, `confirm` (WP05), décision du titulaire (WP03), `debit-paths.ts` (WP05), toute migration.
- Retouches hors carte permises, une ligne chacune au compte rendu : `AuditAction` (ajouts en fin d'union dans
  `audit/audit.service.ts` : création, refus ; une ligne par valeur) ; `refunds.module.ts` est à toi, WP05 y ajoutera
  ses fournisseurs.
- Aucun code d'erreur ni message nouveau : `REFUND_WINDOW_CLOSED`, `REFUND_NOT_ALLOWED`, `REFUND_ALREADY_OPEN`,
  `OTP_INVALID`, `OTP_RATE_LIMITED`, `CONFLICT_STATE`, `NOT_FOUND` existent au catalogue.
- Le rôle de l'appelant back-office est `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (décision 7), pas un autre.

## Subtasks

### T018 : `RefundsModule`, DTO, import dans `app.module.ts`

- `refunds/refunds.module.ts` : déclare `RefundRequestsService`, `MyRefundRequestsController`,
  `RefundRequestsController` ; importe `RefundsHolderModule` (WP03), le module d'authentification festivalier (pour
  `CustomerAuthService.verifyChallenge`), l'audit, l'idempotence, le résolveur de configuration. Modèle de câblage :
  `customer-app/me.module.ts`. Ajoute `RefundsModule` à `app.module.ts`, après `ReversalsModule`.
- `refund-requests.dto.ts` : lecture stricte du corps (`objectBody`, champ inconnu refusé en `400`) :
  `wallet_id` uuid ; `destination.method` dans `WAVE | ORANGE_MONEY | BANK_TRANSFER` ; `msisdn` motif
  `^\+[1-9][0-9]{6,14}$` ; `new_number_otp {otp_request_id, code ^[0-9]{6}$}`. Le mapper `RefundRequest` peut être
  unifié avec celui de WP03 (`RefundsHolderModule`). Le DTO de réponse est
  construit par UN mapper (ligne → contrat) : `refund_request_id` en chaîne, montants en nombres, `reject_reason`
  seulement
  s'il existe ; jamais `requested_by`, `confirmed_by`, `iban` d'un tiers ni `operator_id`.
- `BANK_TRANSFER` n'est pas rejeté par le DTO (il est valide au contrat) : c'est `resolveDestination` (WP03) qui le
  refuse
  en `422 REFUND_NOT_ALLOWED` (décision 4, OP-N123).

### T019 : `refund-eligibility.ts`

`evaluateRefundEligibility(client, walletId, at): Promise<RefundEligibility>` (signature de `interfaces.md`, ne la
change pas). Dans cet ordre, sans écriture :

1. Date limite : `effectiveRefundDeadline(event.refund_deadline, event.ends_at)` (`provisional-defaults.ts:128-138`).
   Jamais la colonne brute. `at > deadline` donne `WINDOW_CLOSED`. `deadline = null` (ni limite ni fin d'événement) :
   `WINDOW_CLOSED` (arbitrage de l'orchestrateur).
2. Statut de l'événement : `isAccepted` de `ledger/status-matrix.ts` (`WALLET_REFUND`, source `BACKOFFICE`) : refus
   `NOT_ALLOWED` si la matrice ne le permet pas (ex. grand livre `LOCKED` sans réclamation tardive : hors 9a).
3. Blocages (décision 6, R-04) : `NOT_ALLOWED` si `wallet.status` n'est pas `ACTIVE` (contestation, `other_block`,
   `CLOSED`)
   ou si un bracelet du portefeuille est `BLACKLISTED`. Un bracelet `SUSPENDED` (déclaré perdu) reste remboursable.
   Fait à vérifier : `customer-app/lost-media.service.ts` suspend seulement le bracelet (l. 34-55), il ne bloque pas le
   portefeuille ; dis-le au compte rendu si la règle se réduit à cela.
4. Solde payé > 0 : lu comme `me.service.ts:106-107` (somme des soldes `WALLET_PAID`), `bigint`, jamais `number`.
5. Frais : règle `PER_REFUND` par `ConfigResolver` et `fee()` de `@cashless/shared-rules`. Sans règle : le résolveur
   lève
   déjà `422` (`sql-config-resolver.ts:367-380`, décision 8) : laisse remonter, n'invente pas de frais nul.
6. `fee >= paid` : `NOT_ALLOWED` (le constructeur refuserait, `ledger/builders/festival/refund.ts:33-37`).
   `estimatedAmount = paid - fee`.

La fonction rend un objet, ne lève jamais pour `WINDOW_CLOSED` ou `NOT_ALLOWED` (les appelants choisissent : la création
lève `422`, `/me/wallets` rend `eligible: false`). Seule la règle de frais absente lève (comme le résolveur).

### T020 : `createMyRefundRequest`

`POST /me/refund-requests`, `@HttpCode(201)`, `@CustomerAuth()`, `@Idempotent({ scope: app:<customerId>: })` exactement
comme `me.controller.ts:95-98`. Dans `tx.run` :

1. Portefeuille : `wallet.customer_id = customerId` du jeton, sinon `422 REFUND_NOT_ALLOWED` (le contrat ne déclare pas
   `404` sur cette route ; MÊME réponse pour un portefeuille inconnu et pour celui d'autrui). Verrouille la ligne du
   portefeuille (`FOR UPDATE`) pour sérialiser les créations.
2. `promote_due_refund_requests()` puis éligibilité : `WINDOW_CLOSED` donne `422 REFUND_WINDOW_CLOSED`, `NOT_ALLOWED`
   donne `422 REFUND_NOT_ALLOWED`.
3. `resolveDestination` (WP03, `refunds/destination.ts`) avec `CustomerAuthService.verifyChallenge` : rend
   `{method, msisdn, newNumber, holderPhone}` ou lève (`BANK_TRANSFER`, autre numéro sans code : `REFUND_NOT_ALLOWED`).
   Le code du nouveau numéro est vérifié ET consommé DANS la même transaction que l'`INSERT` : un échec (dont
   `REFUND_ALREADY_OPEN`) annule la consommation.
4. Statut : `newNumber` et `holderPhone` non nul : `AWAITING_HOLDER`, `hold_until = now + refund_new_number_hold_hours`
   (heure de la base), puis `startHolderChallenge(client, id, holderPhone)` DANS la même transaction. Sinon `REQUESTED`.
5. `extra_check_required = newNumber AND estimatedAmount > event.refund_new_number_max` (FR-014).
6. `INSERT` ; violation de l'index unique partiel (`23505`) : `409 REFUND_ALREADY_OPEN`, jamais `500`. NFR-002 vient de
   la base ;
   le verrou du portefeuille évite seulement le bruit.
7. Audit (`FR-020`) : `AuditAction` nouvelle, auteur = festivalier, après l'écriture, dans la même transaction.

Réponse : `201 RefundRequest`. Aucun `404` sur cette route (arbitrage de l'orchestrateur : `422 REFUND_NOT_ALLOWED`).

### T021 : `listMyRefundRequests`, `listRefundRequests`

- `GET /me/refund-requests` : demandes de `customer_id` du jeton seulement, plus récentes d'abord, pagination `cursor`
  et `limit` avec `parseLimit` et le schéma de curseur de `me.controller.ts` (réutilise, ne recopie pas), `PageMeta` du
  contrat (`next_cursor`, `has_more`). `promote_due_refund_requests()` avant la lecture.
- `GET /refund-requests` : rôle `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (`TenantAccess.actor`, `tenant-access.ts:37`) ;
  filtres `status`, `event_id` du contrat ; portée de l'événement : pour chaque demande, le rôle exercé doit couvrir
  l'événement (`resolveChain` + `exercisedRole`, `scope-resolver.ts:37, 108`), sinon la ligne est absente (jamais `403`
  par ligne). Même pagination, même promotion préalable. `status` hors énumération : `400`.
- Les lectures passent sous la RLS du prestataire (`TenantTx`) : aucune requête ne contourne `operator_id`.

### T022 : `rejectRefundRequest`

`POST /refund-requests/{id}/reject`, rôle back-office comme la liste, `@Idempotent({ scope: 'bo:' })`
(modèle `reversals.controller.ts:62-70`). `reason` obligatoire (chaîne non vide après `trim`, au plus 2000
caractères). Demande inconnue ou hors portée : `404`. Après `promote_due_refund_requests()`, seul `REQUESTED` passe
`REJECTED` (`reject_reason`, `updated_at`) ; tout autre état : `409 CONFLICT_STATE`. Aucune écriture au grand livre.
Audit. Réponse `200 RefundRequest`. Un `AWAITING_HOLDER` n'est pas refusable : le titulaire n'a pas encore décidé.

### T023 : `GET /me/wallets` complété

Dans `customer-app/me.service.ts` (l. 89-141) : pour chaque portefeuille, `refund.eligible`, `refund.deadline` (date
limite
EFFECTIVE, ISO) et `refund.fee` si le schéma `Wallet` du contrat le déclare (lis `openapi.yaml`, ne l'ajoute pas s'il
n'y est pas). Même fonction `evaluateRefundEligibility` que la création, appelée avec `clock_timestamp()` de la base.
Une règle de frais absente ne doit pas faire échouer toute la liste : `eligible: false` pour ce portefeuille, sans
`500`.
Mets à jour le commentaire d'en-tête (l. 5-9) : `refund.eligible` n'est plus « toujours faux ».

### T024 : tests d'intégration

Voir « Tests et preuves ». Un fichier par ligne de la carte : `create-refund-request.spec.ts`,
`list-refund-requests.spec.ts`,
`reject-refund-request.spec.ts`, `me-refund.spec.ts`.

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp04; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/refunds/create test/integration/refunds/list \
  test/integration/refunds/reject test/integration/customer-app/me-refund --runInBand --forceExit
npm run typecheck -w @cashless/api
```

Les tests lisent les codes à usage unique par un `OtpSender` d'enregistrement (aucun en-tête `X-Test-Otp-Code` sur la
création). Cas exigés (chacun nomme son FR) :

- FR-002, FR-005 : création Wave vers le numéro vérifié, `201 REQUESTED`, `estimated_amount = paid - fee` ; les crédits
  offerts n'entrent jamais dans le montant ; rejeu avec la même clé : même réponse, une seule ligne.
- FR-004 : fenêtre close (événement sans `refund_deadline`, `ends_at` + 30 j dépassé, puis un cas explicite) ; solde
  payé nul ; portefeuille `BLOCKED`, `CLOSED`, bracelet `BLACKLISTED` ; bracelet `SUSPENDED` accepté ; `BANK_TRANSFER` ;
  autre numéro sans code ; règle de frais absente : `422`.
- NFR-002 prouvé en WP07, mais ici : deux créations successives donnent `409 REFUND_ALREADY_OPEN`, puis une nouvelle
  demande passe après `REJECTED` ou `FAILED` (insérer l'état par le propriétaire de la base).
- FR-014 : autre numéro au-delà de `refund_new_number_max` : `extra_check_required = true`, `AWAITING_HOLDER` avec
  `hold_until` ; sans numéro vérifié du titulaire : `REQUESTED` directement.
- FR-006, FR-007 : isolation (festivalier B ne voit pas A ; back-office du prestataire B ne voit pas le A ; un
  `ORGANIZER_ADMIN` d'un autre organisateur ne voit pas l'événement) ; pagination sur 3 pages sans doublon ni trou ;
  filtres ; `422 REFUND_NOT_ALLOWED` pour un portefeuille d'un autre festivalier ou inconnu (même réponse) ; rôle
  `CASHIER` : `403`.
- FR-010 : refus de `REQUESTED` ; `reason` vide : `400` ; `PROCESSING` et `AWAITING_HOLDER` : `409` ; aucune ligne
  de `journal_transaction` créée.
- FR-020 : une ligne d'audit par action, auteur correct.
- `me-refund.spec.ts` : `refund.eligible` vrai dans la fenêtre, faux hors fenêtre / solde nul / bloqué ; `deadline`
  effective (cas `ends_at` + 30 j) ; mêmes valeurs que la création pour les mêmes données (une seule fonction).

NFR-004 (mesure) : hors de ce lot, WP07 (`refund-latency.spec.ts`). Garde pourtant les requêtes de liste indexées
(l'index de `refund_request` vient de WP01) et sans N+1 : une requête par page.

## Definition of Done

- [ ] `RefundsModule` dans `app.module.ts` ; les quatre opérations servies ; `/me/wallets` complété.
- [ ] Une seule implémentation de l'éligibilité, appelée par la création et `/me/wallets`.
- [ ] Aucun `404` restant sur `POST`/`GET /me/refund-requests` ; aucun code, champ ni route ajouté au contrat.
- [ ] `409 REFUND_ALREADY_OPEN` sur violation de l'index (jamais `500`) ; `422 REFUND_NOT_ALLOWED` pour le
      portefeuille d'autrui.
- [ ] Audit de chaque création et de chaque refus ; `AuditAction` ajoutées en fin d'union (liste au compte rendu).
- [ ] Tests ci-dessus verts sur `cashless_wp04` ; `npm run typecheck -w @cashless/api` et Prettier (100 caractères)
  verts.
- [ ] Compte rendu : retouches hors carte, écarts au plan (sens : renforce / affaiblit).

## Ce que le relecteur doit casser

1. Date limite : événement sans `refund_deadline`, `ends_at` + 29 j (accepté) et + 31 j (refusé) ; une copie de la règle
   qui lit la colonne brute doit échouer.
2. Créer une demande avec le `wallet_id` d'un autre festivalier ou inconnu : `422 REFUND_NOT_ALLOWED` identique,
   aucune ligne insérée.
3. 20 créations simultanées sur un portefeuille : une seule ligne ouverte, les autres `409`, jamais `500`.
4. Portefeuille bloqué pour contestation avec un bracelet `SUSPENDED` : refusé ; `SUSPENDED` seul sur portefeuille
   actif : accepté.
5. Autre numéro : code d'un AUTRE numéro, code déjà consommé, code expiré, code d'une connexion : tous refusés, et le
   code valide est consommé (second essai refusé).
6. Rôle `OPERATOR_ADMIN` d'un autre prestataire sur la liste et le refus : rien visible, `404`.
7. Refuser deux fois, refuser une demande `PROCESSING`, refuser sans motif : `409` / `409` / `400`, sans écriture.
8. Corps avec champ inconnu (`status`, `estimated_amount`, `operator_id`) : `400` ; aucun champ ne se pose de
   l'extérieur.
9. Règle de frais absente ou frais supérieurs au solde : `422`, jamais un remboursement à frais nuls ni négatif.
10. Réponse : aucune fuite de `requested_by`, `confirmed_by`, `operator_id`, ni du code envoyé au titulaire.

## Fichiers à faire relire par une personne

- `refund-eligibility.ts` (règle commune qui protège un crédit sortant de l'argent) ;
- `refund-requests.service.ts` (isolation, une seule demande ouverte, ordre des contrôles de création).
