---
work_package_id: WP11
title: Remboursement du back-office et limites de la 9a
dependencies: [WP01, WP04, WP06, WP09, WP10]
requirement_refs: [FR-017, FR-018, FR-019]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T047, T048, T049, T050, T051]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/refunds/
create_intent:
- apps/api/src/refunds/refund-backoffice-create.service.ts
- apps/api/src/refunds/refund-backoffice-create.controller.ts
- apps/api/test/integration/refunds/create-backoffice.spec.ts
- apps/api/test/integration/refunds/holder-code-retry.spec.ts
- apps/api/test/integration/refunds/failed-recredit-bound.spec.ts
- apps/api/test/integration/customer-auth/verify-then-consume.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/refunds/**
- apps/api/src/customer-auth/customer-auth.service.ts
- apps/api/src/media/lifecycle/release.service.ts
- apps/api/test/integration/refunds/**
- apps/api/test/integration/customer-auth/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 : Remboursement du back-office et limites de la 9a

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp11`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` ; `spec.md` : FR-017 à FR-019, scénario 5 de la story 5 ;
- `contracts/contract-additions.md` : ligne 15 (`createRefundRequest`), schéma
  `RefundRequestBackofficeCreate` ; `contracts/interfaces.md` : `common/iban.ts`, `moneyAccountFor`,
  `refund_deposit_for_session(…, actor, approver)`, ordre des verrous ;
- `research.md` R-10, R-09 (`moneyAccountFor`), contradiction 3 ; `data-model.md` (graphe de
  `refund_request`, invariant 5) ;
- `docs/POINTS_OUVERTS.md` OP-N123 (l. 1595-1610), OP-N124 (l. 1865-1873), OP-N126 (l. 1885-1893),
  OP-N128 (l. 1903-1909), OP-N130 (l. 1919-1927) ; `docs/DECISIONS_ADR.md` ADR-191, 192, 195, 196
  (l. 2837, 2860, 2907, 2924) ;
- code : `refunds/destination.ts` l. 19-31 ; `refunds/refund-requests.service.ts` l. 53-140 ;
  `refunds/refund-requests.controller.ts` ; `refunds/refunds.module.ts` ;
  `refunds/refund-confirm.service.ts` l. 60-195 ; `refunds/holder-challenge.service.ts` l. 98-150 ;
  `refunds/wallet-refund-action.ts` l. 150-255 ; `customer-auth/customer-auth.service.ts` l. 281-301
  et 343-420 ; `media/lifecycle/release.service.ts` l. 195-310 ; `ledger/db/ledger-queries.ts` l. 82-90
  et 260-270 ; `ledger/ledger-engine.service.ts` l. 255-320 ; `media/lifecycle/deposit.service.ts`
  l. 138-196 ; migration `0081_refund_requests.sql` (CHECK, index) et la migration `0086` de WP04 ;
- tests à inverser : `test/integration/refunds/journey-limits.spec.ts` l. 61-83 et 117-134,
  `journey.spec.ts` l. 418, `create-refund-request.spec.ts` l. 122-125, `confirm-refund.spec.ts`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `contract-additions.md` et
`interfaces.md` font foi sur ce prompt.

## Objective

Servir la route 15 `createRefundRequest` (back-office, virement `BANK_TRANSFER` avec IBAN) et lever
quatre limites de la 9a : OP-N124 (code du titulaire), OP-N126 (recrédit d'un `FAILED`), OP-N128
(`approved_by` de la caution, cumul sous verrou) et le côté TypeScript d'OP-N130. Chaque levée inverse
son test de borne, puis se consigne dans la note de lane (WP14 en tire les OP et les ADR).

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Contrat = `contract-additions.md` exactement. Aucune route, aucun champ ni code d'erreur en plus,
  aucune dépendance nouvelle. `createMyRefundRequest` garde son refus de `BANK_TRANSFER`
  (`destination.ts:19-31` ne change pas).
- Tu ne touches pas `post-roles.sql` (seul WP06 y écrit) ni aucune migration. La signature SQL
  `refund_deposit_for_session(media, session, actor, approver)` et le déclencheur de transitions
  viennent de WP04 : relis sa note de lane pour les noms exacts avant de coder.
- **Retouches hors carte à demander à l'orchestrateur AVANT de coder** (fichiers hors `owned_files`,
  trouvés à la lecture) : T050 exige de transmettre l'acteur et le valideur jusqu'à SQL par
  `media/lifecycle/deposit.service.ts` (l. 154), `ledger/ledger-engine.service.ts` (cas
  `refund_deposit`, l. 307-309) et `ledger/db/ledger-queries.ts` (`refundDeposit`, l. 260). Une ligne
  par fichier dans ta note de lane. Sans accord, signale et continue le reste.
- Ajouts hors carte permis (une ligne chacun à la note de lane) : `AuditAction` en fin d'union ;
  `errors/redact.ts` : l'IBAN n'y est pas masqué aujourd'hui (aucun journal de corps n'existe) :
  signale-le, ne l'écris pas toi-même.
- **Règle 1 de `CLAUDE.md`** : tout écart qui affaiblit la sécurité est décrit (risque, options) et
  attend la réponse du porteur ; tu continues le reste. Un renforcement se fait puis se consigne.
- Arbitrages de la route 15 (renforcements, à consigner) : la demande naît `REQUESTED` pour
  `BANK_TRANSFER` ; un numéro Wave ou Orange Money différent de celui du titulaire vérifié passe par
  `AWAITING_HOLDER` (décision du titulaire, comme l'app) ; `extra_check_required` s'applique au virement
  et au numéro étranger au-delà de `event.refund_new_number_max` (note exigée à l'approbation). Si tu
  juges ces choix trop stricts ou trop souples, ne tranche pas : signale-le au porteur.
- **Question ouverte pour le porteur (OP-N126)** : le contrat validé n'a aucune voie de « second
  valideur » pour `confirmRefundRequest`. Ne code AUCUN en-tête ni champ. Défaut sûr de T049 : refus
  `409` sans contournement (plus strict). Signale la question dans ta note.

## Subtasks

### T047 : route 15 `createRefundRequest` (OP-N123)

`POST /refund-requests`, `@Idempotent({ scope: 'bo:' })`, `201 RefundRequest`. Rôles
`REFUND_BACKOFFICE_ROLES` (`refund-requests.service.ts:27`), portée de l'événement du portefeuille
(`resolveChain`, `exercisedRole`) ; portefeuille inconnu ou hors portée : `404`.

- Nouveaux fichiers `refund-backoffice-create.controller.ts` et `.service.ts`, déclarés dans
  `refunds.module.ts`. Corps strict (`parseRefundRequestBackofficeCreate`, modèle
  `parseRefundRequestCreate`, `refund-requests.dto.ts:34-66`) : `wallet_id`, `destination`, `reason`
  (1 à 2000 caractères). Champ inconnu : `422`.
- `BANK_TRANSFER` : IBAN obligatoire, validé par `isValidIban`, stocké par `normalizeIban`
  (`common/iban.ts`, WP01). IBAN mal formé : `422 VALIDATION_FAILED`. `WAVE` et `ORANGE_MONEY` :
  `msisdn` au format international (`MSISDN`, `refund-requests.dto.ts`).
- Éligibilité : `promote_due_refund_requests()`, puis `evaluateRefundEligibility` (fenêtre, blocages,
  solde payé, frais), mêmes refus que l'app. L'INSERT écrit `requested_by` (la personne) et `iban`.
  `customer_id` peut être nul (colonne nullable, `0081`) pour un bracelet sans compte. Une seule
  demande ouverte : `REFUND_ALREADY_OPEN` par l'index, comme `refund-requests.service.ts:127-130`.
- Audit `REFUND_REQUEST_CREATED` avec `reason` et un IBAN MASQUÉ (fonction de masquage de
  `common/iban.ts`). L'IBAN ne sort dans aucune réponse ni journal (`refund-requests.dto.ts:3`).
- `moneyAccountFor('BANK_TRANSFER')` rend `A-BANQUE` (fourni par WP10) : vérifie que l'approbation
  `WALLET_REFUND` d'une demande virement s'exécute (`wallet-refund-action.ts`).
- Valideur ≠ demandeur : tenu par la CHECK `refund_request_two_persons`. Vérifie que l'approbation
  exécutée par le demandeur échoue proprement (`failure()`, approbation `FAILED`, demande
  `REQUESTED`) et ajoute le cas manquant à `SQL_FAILURES` si besoin.

### T048 : OP-N124, vérification du code scindée

Aujourd'hui `holder-challenge.service.ts:103-111` appelle `verifyChallenge` (transaction propre qui
VÉRIFIE ET CONSOMME), puis écrit la décision (l. 113-143) : un `409` perd le code.

- Dans `customer-auth.service.ts`, sépare : (1) une vérification, en transaction propre, qui compte
  les essais faux et le blocage comme `checkCode` (l. 343-415) mais NE consomme pas ; (2) une
  consommation qui s'exécute dans la transaction de l'appelant : verrou `FOR UPDATE` du défi, relecture
  « utilisable » (non consommé, non invalidé, non expiré), liaison usage + sujet + numéro revérifiée,
  puis `consumed_at`. Le chemin de connexion (`exchangeIn`) garde son comportement : ses tests restent
  verts.
- `HolderChallengeService.decide` : vérification (essais comptés, survivent au refus), puis UNE
  transaction qui fait l'`UPDATE refund_request` ET la consommation. Si l'`UPDATE` ne trouve rien
  (`409`), la transaction s'annule : le code reste utilisable. Deux décisions concurrentes avec le même
  code : une seule consomme et décide.
- La création vers un autre numéro (`destination.ts:51-57`) est hors périmètre : ne la change pas.
- Inverse `journey-limits.spec.ts:61-83` : après le `409`, `consumed` vaut `false` et le titulaire
  réessaie avec le même code (demande encore `AWAITING_HOLDER` si l'échéance n'est pas passée).

### T049 : OP-N126, recrédit d'un `FAILED` borné

`refund-confirm.service.ts:96-105` : un tiers habilité suffit à recréditer. Garde ce qui existe (refus
du proposant et de l'exécutant, `tookPart`, l. 171-182 : renforcement d'ADR-191, ne le relâche pas) et
ajoute la borne du rapprochement :

- Avant le `REVERSAL` d'un `FAILED`, après la garde `EDGE`, cherche une ligne de relevé rapprochée à
  cette sortie d'argent : `external_statement_line.matched_tx_id = refund_request.transaction_id` (et,
  si `external_reference` est connue, la ligne de même référence). Colonnes posées par WP02/WP09.
- Une telle ligne existe : le paiement est visible à la banque. Refus `409 CONFLICT_STATE`, detail
  qui le dit, aucune écriture. Aucune ligne : comportement actuel (tiers habilité, `REVERSAL`).
- La lecture se fait dans la transaction de la confirmation, après le verrou de la demande. Rappel :
  un rapprochement posé pendant la confirmation concurrente ne doit pas échapper à la borne : lis sous
  le verrou, pas avant.
- Aucune voie de contournement (voir la question ouverte). Inverse `journey-limits.spec.ts:117-134` :
  le cas sans ligne reste vert ; le cas avec ligne rapprochée répond `409` et n'écrit rien.

### T050 : OP-N128, valideur sur la caution, cumul sous verrou

- `release.service.ts` l. 241-251 : `this.deposits.refund(...)` doit transmettre l'acteur
  (`actor.userId`) et, si le cumul prévu dépasse le seuil (l. 237), le valideur de `approverFor()`
  (l. 202-208), jusqu'à `refund_deposit_for_session(…, p_actor, p_approver)` (retouches hors carte
  ci-dessus). `DEPOSIT_REFUNDED` porte alors `approved_by` ; auteur ≠ valideur (la base le refuse
  sinon). Sous le seuil : valideur nul comme avant.
- Cumul sous verrou : avant la lecture `plan` (l. 215-233), verrouille le solde payé de chaque
  portefeuille de `settleable` par `lockWalletPaidBalance` (`ledger-queries.ts:82`), dans l'ordre des
  identifiants, APRÈS `lockCounterMedia` (l. 107). Ordre des verrous : bracelet puis portefeuilles.
  Le contrôle de repli (l. 300-302) reste.
- Inverse `journey.spec.ts:418` : « avec approbateur sur l'écriture » (`approved_by` non nul égal au
  valideur du jeton). Ajoute le test de la fenêtre de course (b) : voir « Tests et preuves ».

### T051 : OP-N130 côté TypeScript, tests de borne inversés et nouveaux

- Le déclencheur de WP04 interdit les `UPDATE` hors graphe, y compris pour le propriétaire de la base :
  les fixtures de `test/integration/refunds/**` qui modifient une demande doivent passer par une
  transition permise (ou `session_replication_role = 'replica'` dans la fixture, jamais dans le code).
  Vérifie que `wallet-refund-action.ts` (`REQUESTED` → `PROCESSING`, montant et frais recalculés),
  `refund-confirm.service.ts`, `holder-challenge.service.ts` et la promotion passent.
- Inverse `create-refund-request.spec.ts:122-125` côté app seulement : `BANK_TRANSFER` par `/me`
  reste `422 REFUND_NOT_ALLOWED` (le cas `WAVE` autre numéro sans code aussi). Le virement passe par la
  route 15 (`create-backoffice.spec.ts`).
- Tests nouveaux : voir « Tests et preuves ».

## Tests et preuves

Une seule commande par bloc (base partagée : jamais `cashless_test`) :

```bash
cd <lane> && PGDATABASE=cashless_wp11 bash packages/ledger-sql/scripts/reset-db.sh
cd <lane>/apps/api && export PGDATABASE=cashless_wp11 && source ../../tools/dev-db/env.sh \
  && env | grep DATABASE_URL && SKIP_LATENCY=1 npx jest test/integration/refunds \
  test/integration/customer-auth test/integration/media/release-chaining \
  test/integration/debit-authority --runInBand --forceExit
cd <lane> && npm run typecheck -w @cashless/api && npx prettier --check \
  "apps/api/src/refunds/**/*.ts" apps/api/src/customer-auth/customer-auth.service.ts
```

Relance `reset-db` après chaque Jest. Cas exigés :

- FR-017 : demande `BANK_TRANSFER` créée par A (`requested_by` = A), approbation proposée par B et
  exécutée par C, confirmée `PAID` ; IBAN absent de toute réponse et de l'audit en clair ; IBAN mal
  formé (clé de contrôle fausse, pays inconnu, longueur) : `422`, aucune ligne ; A ne peut pas
  valider sa propre demande ; rôles `SUPERVISOR` et `CASHIER` : `403` ; portefeuille d'un autre
  prestataire : `404` ; `/me` garde le `422` sur `BANK_TRANSFER`.
- FR-019 (OP-N124) : décision refusée (`409`, demande échue) puis code encore utilisable ; code faux :
  essais comptés, blocage au 5e ; 20 décisions concurrentes avec le même code : une seule écrite, un
  seul `consumed_at`.
- FR-019 (OP-N126) : `FAILED` sans ligne rapprochée : `REVERSAL` par un tiers ; avec ligne rapprochée
  (posée par `match_statement_line` de WP09 ou par l'owner) : `409`, aucune écriture ; proposant et
  exécutant : toujours `403`.
- FR-019 (OP-N128) : `DEPOSIT_REFUNDED.approved_by` = valideur du jeton au-dessus du seuil, nul en
  dessous ; fenêtre de course : une transaction externe tient le verrou du solde payé (appel de
  `wallet_topup_headroom` en transaction ouverte), `releaseMedia` attend, puis lit le cumul réel et
  exige le jeton si la dépense l'a fait dépasser le seuil.
- FR-018 : un `UPDATE` direct de `PAID` vers `REQUESTED` par `cashless_app` est refusé (pgTAP de
  WP04) ; les parcours de la 9a passent sans fixture illicite.
- Le grand livre reste équilibré (`expectRefundInvariants`, `refund-invariants.ts`).

## Definition of Done

- [ ] Route 15 servie, IBAN validé et masqué, `requested_by` écrit, app inchangée.
- [ ] OP-N124, OP-N126, OP-N128 levés par le code ; OP-N130 : parcours de la 9a verts sous le
  déclencheur.
- [ ] Tests de borne inversés (`journey-limits` l. 61-83 et 117-134, `journey` l. 418) et nouveaux.
- [ ] Tests verts sur `cashless_wp11` ; typecheck et Prettier (100) verts ; aucun `.sql` touché.
- [ ] Note de lane : pour CHAQUE levée (OP-N123, N124, N126, N128, N130) : test inversé (fichier et
  lignes), preuve, comportement avant et après, écart (renforce ou affaiblit), pour WP14 (OP et ADR) ;
  retouches hors carte ; question OP-N126 posée au porteur ; fichiers sensibles.

## Ce que le relecteur doit casser

1. Rejouer la même décision du titulaire avec le même code, deux fois en parallèle : une seule
   décision, un seul `consumed_at`. Un code faux 5 fois : bloqué, pas consommé par erreur.
2. Consommer un défi sans l'avoir vérifié (mauvais usage, mauvais sujet, mauvais numéro) : refusé.
3. Créer une demande `BANK_TRANSFER` avec un IBAN dont la clé de contrôle est fausse, ou avec un
   espace et des minuscules : refusé, ou normalisé, jamais stocké tel quel.
4. Lire l'IBAN dans la réponse, l'audit, les journaux Jest : introuvable en clair.
5. Confirmer `FAILED` après un rapprochement posé entre le contrôle et le `REVERSAL` : refus.
6. Restituer un bracelet au-dessus du seuil sans jeton : `403` ; avec jeton : `approved_by` posé.
7. Deux restitutions concurrentes d'un même portefeuille : pas d'interblocage (ordre bracelet puis
   portefeuilles), une seule écriture.
8. Retirer un droit ou un test pour passer : `git diff --stat` ne montre que les `owned_files` et les
   retouches annoncées.

## Fichiers à faire relire par une personne

- `customer-auth/customer-auth.service.ts` (vérification, consommation, essais, blocage) ;
- `refunds/refund-confirm.service.ts` (borne du recrédit, `REVERSAL`) ;
- `refunds/refund-backoffice-create.service.ts` (IBAN, destination, `requested_by`) ;
- `media/lifecycle/release.service.ts` (argent, verrous, valideur) ;
- la validation d'IBAN (`common/iban.ts`, WP01) utilisée ici.
