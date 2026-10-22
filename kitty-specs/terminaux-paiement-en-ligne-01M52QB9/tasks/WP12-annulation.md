---
work_package_id: WP12
title: "Annulation"
dependencies: [WP11]
requirement_refs: [FR-016, FR-017, NFR-005, C-001, C-003, C-009]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T055, T056, T057, T058, T059, T060]
phase: "Phase 3 - Routes"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: apps/api/
create_intent:
- apps/api/src/reversals/reversals.module.ts
- apps/api/src/reversals/reversals.controller.ts
- apps/api/src/reversals/reversal.service.ts
- apps/api/src/reversals/sale-reversal-action.ts
- apps/api/src/approval/onsite/device-onsite-approval.ts
- apps/api/test/integration/reversals/reversal-vendor.spec.ts
- apps/api/test/integration/reversals/reversal-supervisor.spec.ts
- apps/api/test/integration/reversals/reversal-backoffice.spec.ts
- apps/api/test/unit/reversals/reversal-request.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/reversals.cases.ts
execution_mode: code_change
owned_files:
- apps/api/src/reversals/**
- apps/api/src/approval/onsite/**
- apps/api/src/approval/action-registry.ts
- apps/api/test/integration/reversals/**
- apps/api/test/unit/reversals/**
- apps/api/test/unit/approval/action-registry.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/reversals.cases.ts
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Annulation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
- `spec.md` : User Story 5, Edge Cases (annulations simultanées, terminal suspendu), FR-016, FR-017, NFR-005 ;
- `contracts/payments.md` : « Clé et registre des numéros », « `POST /payments/{transaction_id}/reversal` » ;
- `data-model.md` : `journal_transaction` (index `journal_transaction_reverses_once`), `approval_token_use` (appelant
  terminal), `sale_attribution`, codes CL035 et CL036 ;
- `research.md` : R-05, R-11 (A5, A8, A9, A19) ; `decisions/DM-01M5HRNBX5CTP7CAKN4JRCY3F9.md` ;
- code existant : `apps/api/src/approval/onsite/` (garde et consommation du jeton), `apps/api/src/approval/
  action-registry.ts`, `apps/api/src/approval/approval.service.ts` (lecture seule), `apps/api/test/integration/
  approval/onsite.spec.ts` (tableau des refus), `apps/api/src/media/lifecycle/cash-due.controller.ts` (garde du jeton
  derrière une garde de terminal), `apps/api/src/media/blacklist/blacklist-approval-actions.ts` (modèle d'action) ;
- la migration `packages/ledger-sql/migrations/0033_payments.sql` telle que livrée par WP04 (signatures réelles de
  `assert_reversible`, `record_sale_attribution`, colonnes de `approval_token_use`).

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **la signaler** dans le compte rendu. Ne jamais modifier
un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir `POST /v1/payments/{transaction_id}/reversal` (`reversePayment`) pour le vendeur de la vente depuis le
terminal d'origine dans la fenêtre, et pour un `SUPERVISOR` de l'événement au terminal (jeton sur place, variante
d'appelant terminal) ; ajouter l'action à deux personnes `SALE_REVERSAL` (source `BACKOFFICE`) au back-office.

## Context

- Exigences : FR-016, FR-017, NFR-005 ; IC-05 (annulation), IC-14 (annulation par un `SUPERVISOR`).
- Décision du porteur `DM-01M5HRNBX5CTP7CAKN4JRCY3F9` : au terminal, jeton d'approbation sur place du `SUPERVISOR` de
  l'événement, **lié à la requête, usage unique**, appelant = terminal et session de vendeur ; **la variante de garde
  ne relâche aucun contrôle** (deux personnes distinctes pour un appelant personne, portée événement, liaison à la
  requête, usage unique) ; au back-office, demande à deux personnes, source `BACKOFFICE`.
- Constats : A5 (fenêtre ancrée sur `recorded_at`, heure lue dans la base, jamais `occurred_at`), A8 (champ
  `supervisor_pin_proof` refusé : empreinte de requête circulaire), A9 (`assert_reversible` sur **tous** les chemins),
  A19 (seconde annulation traduite par le **nom** de la contrainte, pas par tout `23505`).
- Fournis par d'autres lots : WP04 (`assert_reversible`, index unique, colonnes d'appelant de `approval_token_use`,
  `SALE_REVERSAL` dans la liste fermée, `record_sale_attribution`), WP07 (accords à `cashless_app`), WP08 (garde
  exclusive « terminal ou personne », idempotence de terminal, `DeviceContext`, traduction CL035/CL036, registre des
  cas), WP09 (garde de session de vendeur), WP11 (registre des numéros, contrôle de `X-Authority-Epoch` et de
  `occurred_at`, lecture d'une vente). Réutilise leurs services exportés sans les modifier.
- **Écart de chemin au plan** (sans effet de sécurité) : le plan place l'annulation dans `apps/api/src/payments/` ; elle
  vit dans `apps/api/src/reversals/` (module séparé, `@Controller('payments')`) pour que WP11 et WP12 ne se marchent pas
  dessus. À mentionner dans le compte rendu.
- Dépendants : WP14 (parcours complet, concurrence transverse, isolation).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en affaiblissant
la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi
sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Ici, toute
simplification de la variante de garde (retrait d'un des contrôles de la garde existante) est de ce type. Un
renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- `SALE_REVERSAL` demandable par `SUPERVISOR` **ou** `ORGANIZER_ADMIN` (contrat) : `requiredRole` devient une liste ; retouche hors carte d'une ligne dans `apps/api/src/approval/approval.service.ts`, consignée.
- `reversePayment` par un appelant personne (`humanBearer`) : `403 APPROVAL_REQUIRED` sans écriture ; le back-office passe par `SALE_REVERSAL`.
- `assert_reversible` à trois modes avec preuve en base de l'approbation (arbitrage WP04).

## Branch Strategy

Planification et merge sur `feat/terminaux-paiement-en-ligne`. Dépendance : WP11 (donc WP09, WP10, WP07, WP08). Le
worktree est attribué par lane (`lanes.json`). Commande :
`spec-kitty agent action implement WP12 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.
Retouche hors carte autorisée : **une ligne** d'import de `ReversalsModule` dans `apps/api/src/app.module.ts`, et la
ligne `x-process: public` de `reversePayment` dans `packages/contracts/openapi.yaml` ; les consigner.

## Subtasks

### T055 — Annulation par le vendeur depuis le terminal

- `apps/api/src/reversals/reversals.controller.ts` : `@Controller('payments')`, `@Post(':transaction_id/reversal')`,
  `@HttpCode(201)`, garde exclusive de WP08 (mTLS ou `Signature` présent → trois preuves exigées, sans repli ;
  sinon chemin personne). `@Idempotent` de terminal (prestataire tiré du terminal, R-03) ; `Idempotency-Key` =
  `<serial>:<seq>`, `<serial>` ≠ `device.serial` → `422 VALIDATION_FAILED`, rien d'écrit.
- Corps `ReversalRequest` + `vendor_session_id` (uuid, requis depuis un terminal) ; `supervisor_pin_proof` présent →
  `422 VALIDATION_FAILED` (A8) ; `reason` dans l'énumération du contrat ; `comment` ≤ 500.
- Transaction unique, verrous dans l'ordre global (terminal → vendeur → session → … → portefeuille) :
  1. `record_device_seq` (terminal `FOR UPDATE`) par le service de WP11 ;
  2. `X-Authority-Epoch` contrôlé (`STALE_AUTHORITY_EPOCH`) et `occurred_at` borné à ±120 s (heure de la base ; au-delà,
     écrit à l'heure de la base, `metadata.device_occurred_at`, anomalie `CLOCK_SKEW`) par les aides de WP11 ;
  3. `assert_device_active(device)` ; 4. `assert_vendor_session(device, vendor_session_id)` ;
  5. `assert_reversible(...)` mode vendeur (même prestataire, `PURCHASE`, non annulée, même terminal, même vendeur,
     `now() ≤ recorded_at + reversal_window_minutes`, heure de la base) → sinon `CL036` → `403 REVERSAL_NOT_ALLOWED` ;
  6. moteur : `REVERSAL`, `reversesId`, `source ONLINE`, clé = `Idempotency-Key`, `deviceId` ; lignes miroir (builder
     existant, aucun recalcul) ; matrice des statuts respectée (`RECONCILING` refusé hors synchronisation) ;
  7. `record_sale_attribution` pour la transaction d'annulation (vendeur retrouvé par la session) ;
  8. `201 PaymentResult` (`type REVERSAL`, `reverses_id`).
- Seconde annulation : violation de `journal_transaction_reverses_once` (par `constraint`, pas par `23505` seul) ou
  `CL035` → `409 ALREADY_REVERSED`. Refus 4xx : numéro enregistré à part (transaction séparée validée) ; refus non
  définitifs (`409 DEBIT_AUTHORITY_MOVING`, `DEBIT_AUTHORITY_EDGE`) : clé relâchée, rien d'enregistré.
- Vente inconnue ou d'un autre prestataire : `404` (pas de fuite d'existence).
- Fichiers : `reversals.module.ts`, `reversals.controller.ts`, `reversal.service.ts`.

### T056 — Jeton sur place pour un appelant terminal

- `apps/api/src/approval/onsite/device-onsite-approval.ts` : variante `RequiresDeviceOnsiteApproval({ operationId,
  role, scope })`, qui réutilise **les mêmes fonctions** que `OnsiteApprovalGuard` (factoriser la vérification commune
  dans `onsite-approval.ts` plutôt que la copier) : signature, émetteur, audience, durée ; `act === 'reversePayment'` ;
  `act_hash` = empreinte de la requête exacte (`requestActHash`, corps compris, donc `vendor_session_id` compris) ;
  valideur connu, `ACTIVE`, du **même prestataire** que le terminal ; rôle `SUPERVISOR` exercé sur la chaîne de
  **l'événement de la vente** ; IdP indisponible → `503 SERVICE_UNAVAILABLE` ; toute autre anomalie →
  `403 APPROVAL_INVALID`, raison au journal seulement.
- La portée dépend de la vente : la variante accepte une portée **asynchrone** (lecture de `event_id` de la vente
  dans une transaction du prestataire du terminal) ; vente introuvable → `404`, jamais une portée vide.
- Ordre des gardes : garde de terminal d'abord (décorateurs appliqués de bas en haut, comme `cash-due.controller.ts`).
- Consommation dans la transaction métier : `consumeDeviceOnsiteApproval(client, req, audit)` insère
  `approval_token_use` avec `caller_device_id`, `caller_vendor_session_id`, `caller_id` NULL (colonnes de WP04) ;
  `ON CONFLICT (jti) DO NOTHING` → 0 ligne → `403 APPROVAL_INVALID`, travail annulé ; `23514` (échéance passée) →
  `403 APPROVAL_INVALID` ; audit `APPROVAL_TOKEN_USED` comme l'existant.
- La garde existante (appelant personne) reste **inchangée** ; `onsite.spec.ts` reste vert sans retouche.

### T057 — Annulation par le `SUPERVISOR` au terminal

- Même route, en-tête `X-Approval-Token` présent : `vendor_session_id` exigé et contrôlé (`assert_vendor_session`),
  `assert_reversible` en mode `SUPERVISOR` (lève vendeur et fenêtre, **garde** prestataire, `PURCHASE`, non annulée,
  terminal du même événement que la vente). Le valideur part au moteur comme `approvedBy` ; l'annulation est attribuée
  au `SUPERVISOR` (`actor_user_id`) et à la session.
- Jeton présenté puis refusé : aucune annulation, aucun jeton consommé, numéro enregistré avec le refus.
- Si la signature réelle d'`assert_reversible` (WP04) ne distingue pas ces deux modes, ne pas contourner par un contrôle
  en API seule : le signaler à l'orchestrateur.

### T058 — Action `SALE_REVERSAL` au back-office

- `apps/api/src/reversals/sale-reversal-action.ts` : `ApprovalActionDefinition<SaleReversalPayload>` sur le modèle de
  `blacklist-approval-actions.ts` ; charge utile `{ transaction_id, reason, comment?, scope_type: 'EVENT', scope_id }`
  figée à la demande (événement de la vente, lu en base) ; `validate` refuse `422` tout autre champ.
- Rôle : contrat = `SUPERVISOR` **ou** `ORGANIZER_ADMIN` de l'événement. `ApprovalActionDefinition.requiredRole` n'en
  porte qu'un : l'étendre dans `action-registry.ts` à `StaffRole | readonly StaffRole[]` (test dans
  `action-registry.spec.ts`) ; `approval.service.ts` (ligne `exercisedRole(principal, [definition.requiredRole], …)`)
  n'est pas à ce lot : retouche hors carte d'une ligne à consigner, **ou** demander l'arbitrage à l'orchestrateur.
  Ne jamais élargir à d'autres rôles.
- `execute` : `assert_reversible` mode back-office (sans terminal ni session), moteur `REVERSAL`, `source BACKOFFICE`,
  `createdBy` = auteur, `approvedBy` = valideur (distincts, contrôlés par la base), clé dérivée de la demande ;
  `record_sale_attribution` avec `actor_user_id` ; renvoie `executedTxId`. `ALREADY_REVERSED` ou `REVERSAL_NOT_ALLOWED`
  → demande `FAILED` avec le motif.
- **Chemin personne de `reversePayment`** (le contrat le déclare, `humanBearer`) : point à trancher, signalé à
  l'orchestrateur. Proposition par défaut (la plus stricte) : `403 APPROVAL_REQUIRED` sans écriture ; l'annulation au
  back-office passe par `createApprovalRequest` avec `SALE_REVERSAL`.

### T059 — Tests de l'annulation

- `test/integration/reversals/reversal-vendor.spec.ts` (HTTPS réel, terminal de test, vraie base) : annulation dans la
  fenêtre (`REVERSAL` lié, solde rendu, attribution au vendeur) ; seconde annulation `409 ALREADY_REVERSED` ; autre
  vendeur, autre terminal, hors fenêtre (`recorded_at` reculé par le propriétaire) → `403 REVERSAL_NOT_ALLOWED` ;
  `occurred_at` du terminal dans la fenêtre mais `recorded_at` hors fenêtre → refus (A5) ; terminal suspendu avec
  session ouverte → refus ; `supervisor_pin_proof` → `422` ; `<serial>` étranger → `422` ; refus 4xx enregistré dans
  `device_seq_registry` ; rejeu de la clé → même réponse ; **20 annulations simultanées → exactement 1** (NFR-005).
- `reversal-supervisor.spec.ts` : chaque ligne du tableau des refus de `onsite.spec.ts` **rejouée sur la variante**
  (sans jeton → mode vendeur ; signature, `act`, `act_hash` d'un autre corps ou d'une autre vente, valideur inconnu,
  désactivé, d'un autre prestataire, sans le rôle, `SUPERVISOR` d'un autre événement, jeton rejoué avec une autre clé,
  deux requêtes simultanées avec le même jeton → une seule) ; succès hors fenêtre et pour un autre vendeur ; terminal
  d'un autre événement refusé même avec un jeton valide.
- `reversal-backoffice.spec.ts` : demande puis approbation par une seconde personne → `REVERSAL` `BACKOFFICE`,
  auteur ≠ valideur ; même personne → refus ; rôle absent → refus ; vente déjà annulée → `FAILED`.
- `test/unit/reversals/reversal-request.spec.ts` : validation du corps ; traduction par nom de contrainte.

### T060 — Cas de la matrice (annulation)

`test/integration/end-to-end/device-auth-cases/reversals.cases.ts` : cas de `reversePayment` au registre de WP08 (forme
exacte du registre ; aucun fichier index à éditer) ; réussite servie par la vraie route, puis refus pour chaque preuve
absente, fausse ou rejouée. Le test « routes de terminal du contrat non servies : 404 » reste vert.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : demande-lui les passes complètes ; tests en série seulement. Dans un worktree de
lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base
Docker qui peut reculer : aucun test ne compare l'heure de Node à `now()` de la base sans marge (la fenêtre se teste en
reculant `recorded_at` en base, pas en attendant).

## Definition of Done

- `reversePayment` servi (vendeur, `SUPERVISOR` au terminal), `SALE_REVERSAL` enregistrée ; suites vertes, dont
  `onsite.spec.ts` et la matrice des preuves inchangées.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot ajouté en fin de ce fichier : écarts au plan (sens ; dont le chemin `reversals/`), retouches hors
  carte (`app.module.ts`, `x-process`, éventuellement `approval.service.ts`, une ligne de justification chacune),
  points soumis au porteur, fichiers à faire relire par une personne (`apps/api/src/approval/onsite/`, la variante de
  garde), **critères couverts avec leur preuve** (FR-016, FR-017, NFR-005 annulations : fichier et nom du cas).

## Risks

- Variante de garde qui « oublie » un contrôle en se séparant de l'existante : factoriser, et rejouer chaque refus.
- Portée prise sur l'événement du terminal au lieu de celui de la vente, ou portée vide si la vente est introuvable.
- Heure du terminal utilisée pour la fenêtre (A5) ; traduction de tout `23505` en `ALREADY_REVERSED` (A19).
- Jeton consommé hors de la transaction métier (consommé alors que l'annulation échoue).

## Reviewer Guidance

Vérifier, refus par refus : `supervisor_pin_proof` → 422 ; `serial` étranger → 422 sans écriture ; autre vendeur,
autre terminal, hors fenêtre → 403 ; seconde annulation → 409 par le nom de la contrainte ; `assert_reversible`
appelée sur les trois chemins ; variante : `act`, `act_hash` (corps exact), prestataire, rôle sur l'événement **de la
vente**, usage unique dans la transaction, raison seulement au journal ; garde existante inchangée ; `SALE_REVERSAL` :
auteur ≠ valideur, rôles limités à `SUPERVISOR` et `ORGANIZER_ADMIN` ; 20 annulations simultanées → 1 ; ordre des
verrous ; aucune règle d'annulation réécrite en API à la place de la base (C-001).
