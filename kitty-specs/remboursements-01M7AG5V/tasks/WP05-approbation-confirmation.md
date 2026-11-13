---
work_package_id: WP05
title: Approbation à deux et confirmation du paiement
dependencies: [WP02, WP04]
requirement_refs: [FR-008, FR-009, FR-019, FR-020, NFR-001]
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
subtasks: [T025, T026, T027, T028, T029, T030]
phase: Phase 3 - Back-office et guichet
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/refunds/
create_intent: [apps/api/src/refunds/wallet-refund-action.ts, apps/api/src/refunds/refund-confirm.service.ts, apps/api/src/refunds/refund-approve.controller.ts, apps/api/test/integration/refunds/approve-refund.spec.ts, apps/api/test/integration/refunds/confirm-refund.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/refunds/wallet-refund-action.ts, apps/api/src/refunds/refund-confirm.service.ts, apps/api/src/refunds/refund-approve.controller.ts, apps/api/src/ledger/builders/festival/refund.ts, apps/api/src/debit-authority/debit-paths.ts, apps/api/test/integration/debit-authority/debit-cases.ts, apps/api/test/integration/debit-authority/debit-paths-refused.spec.ts, apps/api/test/integration/refunds/approve*.spec.ts, apps/api/test/integration/refunds/confirm*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Approbation à deux et confirmation du paiement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis `docs/passation-9a/fiche-implementation.md` (démarrage, base `cashless_wp05`, Jest, fin de lot),
ce prompt, puis seulement :

- `docs/passation-9a/contexte-9a.md` : décisions 3, 5, 6, 7, 8 ;
- `contracts/interfaces.md` : action `WALLET_REFUND` (payload), clés `bo:`, noms figés ;
- `contracts/served-operations.md` : lignes `approveRefundRequest`, `approveApprovalRequest`, `confirmRefundRequest` ;
- `research.md` R-03, R-04, R-07, R-10 ; `data-model.md` (invariants, écritures, états) ;
- `packages/contracts/openapi.yaml` : `approveRefundRequest` l. 6261-6316 (description comprise), `confirmRefundRequest`
  l. 6317-6410 ;
- code : `reversals/sale-reversal-action.ts` l. 23-196 (modèle intégral) ; `approval/action-registry.ts` l. 37-115 ;
  `approval/approval.service.ts` l. 70-174 (`request`, `approve`, SAVEPOINT l. 124-150) ;
  `ledger/builders/festival/refund.ts` l. 14-45 ; `ledger/builders/registry.ts` l. 85-89 ;
  `ledger/ledger-engine.service.ts` l. 150-245 (`writeLines`) ; `debit-authority/debit-paths.ts` en entier ;
  `test/integration/debit-authority/debit-paths-refused.spec.ts` l. 40-100 et l. 151-175 ;
  `refunds/refund-eligibility.ts` (WP04, déjà fusionné dans ta base).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sur ce prompt.

## Objective

Faire sortir l'argent du portefeuille une seule fois, à la décision de deux personnes, puis enregistrer le résultat du
paiement fait hors système. `approveRefundRequest` crée l'approbation (rien d'écrit). La seconde personne l'exécute par
`approveApprovalRequest` : `WALLET_REFUND` du solde payé à l'instant, demande `PROCESSING`. `confirmRefundRequest` clôt
:
`PAID` n'écrit rien, `FAILED` contre-passe. L'API ne verse rien (décision 3). Les chemins de débit sont reclassés.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Retouches hors carte permises (une ligne chacune au compte rendu) : `refunds/refunds.module.ts` (WP04 l'a créé : tu y
  déclares `RefundConfirmService`, `RefundApproveController` et l'action) ; `AuditAction` (fin d'union, une ligne par
  valeur) ; `refunds/refund-requests.service.ts` (WP04) seulement pour exposer un mapper déjà existant, sans changer sa
  logique. Rien d'autre.
- Hors lot : migration (WP02 a déjà élargi `post_transaction` au `REVERSAL` d'un `WALLET_REFUND`, décision 5),
  création et listes (WP04), guichet (WP06).
- Aucun code d'erreur nouveau. `DEBIT_AUTHORITY_EDGE`, `CONFLICT_STATE`, `REFUND_WINDOW_CLOSED`, `REFUND_NOT_ALLOWED`,
  `APPROVAL_INVALID`, `VALIDATION_FAILED` existent.

## Subtasks

### T025 : constructeur `refund.ts` : compte d'argent par canal

`buildWalletRefund` (`refund.ts:23-45`) prend déjà `moneyAccount`. Ne change pas la logique des lignes ni le refus des
frais
`>=` montant (l. 33-37). Ajoute à côté une fonction pure `moneyAccountFor(method)` : `WAVE` donne `A-PSP-WAVE`,
`ORANGE_MONEY` donne `A-PSP-OM` (comptes de `0037_psp_configurations.sql:560-566`), `BANK_TRANSFER` ou autre :
`BuildError`
(`VALIDATION_FAILED`). Test unitaire du mapping (y compris le refus). Aucun compte `A-CAISSE-…` ici (WP06).

### T026 : `wallet-refund-action.ts`

`ApprovalActionDefinition<'WALLET_REFUND'>` sur le modèle de `sale-reversal-action.ts` (même structure : `request`,
`definition`, `validatePayload` strict, `failure`). Enregistrée dans le constructeur via `ApprovalActionRegistry`.

- `requiredRole: ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']` (décision 7), exporté en constante bornée ; `scopeOf` donne
  `{type: 'EVENT', id: payload.event_id}`. Un test de bornage prouve qu'aucun autre rôle (`SUPERVISOR`, `CASHIER`,
  `PLATFORM_ADMIN`) n'est admis.
- Payload figé à la création (`request(...)`) : `{refund_request_id, ledger_id, event_id, operator_id,
  idempotency_key: 'bo:' + <Idempotency-Key de l'appel approveRefundRequest>, note?}`. `ledger_id`, `event_id` et
  `operator_id` sont LUS EN BASE depuis la demande de remboursement, jamais d'un corps. `validatePayload` refuse tout
  champ
  hors liste (`422`) et une clé qui ne commence pas par `bo:`.
- `target_id = refund_request.id`. `execute`, sous le SAVEPOINT de `ApprovalService.approve` :
  1. verrouiller la demande (`FOR UPDATE`), `promote_due_refund_requests()`, exiger `REQUESTED` (sinon `409
     CONFLICT_STATE`) ;
  2. exiger `note` si `extra_check_required` (sinon `422`) ;
  3. refuser sous `debit_authority = 'EDGE'` : `409 DEBIT_AUTHORITY_EDGE` AVANT toute écriture (CL006 reste le dernier
     recours) ;
  4. `evaluateRefundEligibility(client, wallet_id, now)` revue (fenêtre, blocages, solde payé, frais) ;
  5. montant = solde payé LU À CET INSTANT (verrou du solde payé : modèle `lockWalletPaidBalance`,
     `ledger-engine.service.ts:160`), jamais le
     `estimated_amount` de la demande ; solde nul : refus métier ;
  6. `engine.execute` : `WALLET_REFUND`, source `BACKOFFICE`, `createdBy = requestedBy`, `approvedBy`, clé
     `payload.idempotency_key`,
     `payload: {walletId, amount, moneyAccount: moneyAccountFor(method)}`, métadonnées `{approval_request_id,
     refund_request_id}` ;
     `written.replayed` ou absence de `transactionId` : `IDEMPOTENCY_KEY_REUSED` (modèle
     `sale-reversal-action.ts:141-144`) ;
  7. demande `PROCESSING`, `transaction_id`, `approved_by`, montants recalculés (`estimated_amount`, `fee`) ; audit.
- Refus métier (étapes 1 à 5) : l'approbation passe `FAILED` (mécanisme de `ApprovalService.approve`, SAVEPOINT annulé)
  et
  la demande RESTE `REQUESTED`. Les refus SQL connus passent par `failure()` comme le modèle ; une erreur inconnue
  annule tout.
- `onClosed` : sans objet pour une demande qui reste `REQUESTED` ; n'en ajoute pas.

### T027 : `approveRefundRequest`

`refund-approve.controller.ts`, `POST /refund-requests/{id}/approve`, rôle `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`
(`TenantAccess.actor`), `@Idempotent({ scope: 'bo:' })`, `202` par `respondAccepted` (modèle
`reversals.controller.ts:62-109`).
Corps facultatif `{note}` (chaîne 1 à 2000 caractères). À la création de l'approbation, refuse déjà ce que le contrat
dit
refuser « à la création » : demande hors `REQUESTED` (`409 CONFLICT_STATE`, après promotion), `EDGE` (`409`), fenêtre
close
(`422 REFUND_WINDOW_CLOSED`), `extra_check_required` sans `note` (`422`). L'auteur doit tenir le rôle sur l'événement
de la demande (`ApprovalService.request` le contrôle). Demande inconnue ou hors portée : `404`. Valideur ≠ auteur :
garanti par
la base (CHECK de `approval_request`) ; valideur ≠ demandeur : sans objet en 9a (`requested_by` nul, R-07). Audit géré
par
`ApprovalService.request` ; ajoute seulement ce qui manque (action de remboursement).
Le résultat de `approveApprovalRequest` (`result`) doit contenir la `RefundRequest` du contrat : fais renvoyer par
`execute`
l'objet mappé.

### T028 : `confirmRefundRequest`

`refund-confirm.service.ts` et la route dans `refund-approve.controller.ts` : `POST /refund-requests/{id}/confirm`,
back-office
(mêmes rôles), `@Idempotent({ scope: 'bo:' })`, `200 RefundRequest`. Verrou de la demande ; `PROCESSING` seulement
(sinon `409 CONFLICT_STATE`) ; corps `outcome` dans `PAID | FAILED`, `oneOf` du contrat.

- `PAID` : `external_reference` obligatoire (non vide après `trim`, sinon `400`) ; état `PAID`, `confirmed_by`,
  `confirmed_at` ;
  AUCUNE écriture (le test compte les lignes du grand livre avant/après).
- `FAILED` : `failure_reason` obligatoire ; garde `EDGE` côté API (`409 DEBIT_AUTHORITY_EDGE`, avant écriture) ;
  `REVERSAL`
  par le moteur : source `BACKOFFICE`, `reversesId = transaction_id` de la demande, `createdBy`, `approvedBy`
  (`validate` du moteur exige les deux, distincts) : `createdBy` = la personne qui confirme ; `approvedBy` =
  `approved_by` de la demande (valideur de l'approbation d'origine) ou, si c'est la même personne que celle qui
  confirme, le `requested_by` de l'`approval_request` d'origine (les trois ne peuvent pas coïncider : la base
  l'interdit ; `ledger-engine.service.ts:376-380`). Clé `bo:<Idempotency-Key de l'appel>`. Puis
  `reversal_transaction_id`,
  état `FAILED`. Un 2e `REVERSAL` du même remboursement est refusé par l'index `journal_transaction_reverses_once` :
  rejeu = même
  réponse.
- Audit de chaque confirmation.

### T029 : `debit-paths.ts` et `debit-paths-refused.spec.ts`

Reclasse (R-10) : `confirmRefundRequest` n'est plus `DEBIT`/`ABSENT` : `CREDIT`, protection citée « garde EDGE de
`refund-confirm.service.ts:<ligne>` (409 avant le `REVERSAL`) ». Ajoute `approveApprovalRequest` (exécution
`WALLET_REFUND`) en
`DEBIT`, couche `ENGINE` (`debit-cases.ts` est à toi : tu peux aussi l'étendre si tu choisis `HTTP`), protection :
garde de
l'action
+ CL006. Ajoute en `NEUTRAL` : `createMyRefundRequest`, `listMyRefundRequests`, `listRefundRequests`,
`rejectRefundRequest`,
`decideRefundRequestAsHolder`, `approveRefundRequest` (aucune écriture au grand livre). `releaseMedia` reste `DEBIT` :
WP06 change
`release.service.ts` ; mets à jour la ligne citée (`release.service.ts:90`) APRÈS lecture du fichier fusionné, sinon
laisse-la
et signale-le. Le test garde `la liste est cohérente` : opérations présentes au contrat, une entrée par opération,
entrées `DEBIT`
`HTTP` égales à `HTTP_DEBIT_CASES`. Ajoute les cas : exécution sous `EDGE` refusée sans écriture ; `FAILED` sous `EDGE`
: `409` sans
écriture ; les routes `NEUTRAL` répondent sous `EDGE`.

### T030 : tests

Voir « Tests et preuves ».

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp05; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/refunds/approve test/integration/refunds/confirm \
  test/integration/debit-authority --runInBand --forceExit
npm run typecheck -w @cashless/api
```

La base doit contenir la migration `0082` de WP02 (`reset-db` depuis ta lane après fusion de WP02). Cas exigés :

- FR-008 / SC-003 : deux personnes distinctes : `202`, aucune écriture ; seconde approbation : `WALLET_REFUND` unique,
  solde
  payé à 0, demande `PROCESSING` avec `transaction_id` et `approved_by` ; la même personne comme valideur : refusée par
  la
  base (aucune écriture) ; rôles `SUPERVISOR`, `CASHIER` : `403`.
- Montant à l'exécution : solde payé de 25 000 à la demande, achat de 5 000 avant l'approbation : remboursé 20 000 −
  frais ;
  solde devenu nul : approbation `FAILED`, demande `REQUESTED`, aucune écriture.
- Refus à l'exécution (fenêtre close entre-temps, portefeuille bloqué, `EDGE`, `note` absente si `extra_check_required`)
  :
  approbation `FAILED`, demande `REQUESTED`, aucune écriture, une nouvelle approbation reste possible.
- FR-009 : `PAID` sans `external_reference` : `400` ; `PAID` : zéro écriture ; `FAILED` : `REVERSAL`, solde payé
  recrédité
  (égal à l'avant-remboursement), nouvelle demande possible ; `confirm` sur `REQUESTED` ou `PAID` : `409` ; rejeu de la
  même clé :
  même réponse.
- NFR-001 : 100 exécutions concurrentes de la même approbation donnent UNE écriture `WALLET_REFUND` ; 100 rejeux de la
  même clé
  `bo:` aussi ; 20 `confirm FAILED` concurrents : un seul `REVERSAL`.
- FR-019 : exécution et `FAILED` sous `EDGE` : `409 DEBIT_AUTHORITY_EDGE`, rien écrit ; `PAID` sous `EDGE` : accepté
  (aucun mouvement). `debit-paths-refused.spec.ts` vert avec les nouvelles entrées.
- Le grand livre reste équilibré après chaque cas (somme nulle par transaction ; `NFR-003` prouvé en WP07).

## Definition of Done

- [ ] Action `WALLET_REFUND` enregistrée (rôles bornés, payload figé, `bo:`), `approveRefundRequest` et
  `confirmRefundRequest` servis.
- [ ] Montant du remboursement lu à l'exécution ; compte `A-PSP-WAVE` / `A-PSP-OM` selon le canal ; frais par la règle.
- [ ] `PAID` n'écrit rien ; `FAILED` écrit un seul `REVERSAL`, accepté par la base grâce à WP02 ; garde `EDGE` côté API.
- [ ] `debit-paths.ts` reclassé, `debit-paths-refused.spec.ts` vert ; aucune entrée `ABSENT` pour une route désormais
  servie.
- [ ] Tests verts sur `cashless_wp05` ; typecheck et Prettier (100 caractères) verts ; aucun `.sql` généré touché.
- [ ] Compte rendu : auteur et valideur du `REVERSAL`, retouches hors carte, écarts au plan (renforce / affaiblit).

## Ce que le relecteur doit casser

1. Approuver sa propre proposition, ou approuver par un compte de rôle `SUPERVISOR` : refusé, aucune écriture.
2. Modifier `idempotency_key` ou `refund_request_id` dans le payload de l'approbation par la base (propriétaire) puis
   exécuter :
   refus de `validatePayload`, aucune écriture.
3. 100 `POST /approval-requests/{id}/approve` simultanés : une seule ligne `journal_transaction` `WALLET_REFUND`.
4. Dépenser entre la demande et l'exécution, puis vérifier que le montant rendu est celui de l'instant et qu'aucun solde
   payé ne devient négatif.
5. `confirm FAILED` deux fois, ou une fois par deux personnes en parallèle : un seul `REVERSAL`, une seule réponse.
6. `confirm FAILED` après passage de l'événement en `RECONCILING` : accepté (décision 5) ; un `REVERSAL` d'un `PURCHASE`
   dans le même statut reste refusé (test de WP02 relancé).
7. `confirm FAILED` pendant `EDGE` : `409` AVANT l'écriture ; sans la garde API, CL006 ne protège pas un crédit :
   vérifie
   que la garde existe bien dans le code et dans le test.
8. `PAID` avec `external_reference` de 1 espace, ou `FAILED` avec `failure_reason` vide : refusés.
9. Une demande refusée (`REJECTED`) ou `BLOCKED` : `approve` renvoie `409` ; `AWAITING_HOLDER` aussi.
10. `debit-paths.ts` : ajouter une route d'écriture sans entrée, ou garder `confirmRefundRequest` en `ABSENT` : le test
    échoue.

## Fichiers à faire relire par une personne

- `refunds/wallet-refund-action.ts` (sortie d'argent, deux personnes, montant à l'exécution) ;
- `refunds/refund-confirm.service.ts` (contre-passation, garde `EDGE`, auteur et valideur du `REVERSAL`).
