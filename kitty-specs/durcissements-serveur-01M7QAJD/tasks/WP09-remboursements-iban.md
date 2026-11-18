---
work_package_id: WP09
title: 'Remboursements et réclamations tardives : IBAN chiffré (OP-N140, OP-N145)'
dependencies: [WP02, WP03, WP08]
requirement_refs: [FR-010, FR-011, NFR-005, SC-003]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/durcissements-serveur. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: f24388bc7614fe704837b2e2c90dcb3a49655558
created_at: '2026-11-18T15:48:02.447436+00:00'
subtasks: [T034, T035, T036, T037]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/refunds/refund-backoffice-create.service.ts
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/refunds/refund-backoffice-create.service.ts
- apps/api/src/late-claims/**
- apps/api/src/approval/approval.mapper.ts
- apps/api/test/integration/refunds/create-backoffice.spec.ts
- apps/api/test/integration/late-claims/late-claim.spec.ts
- apps/api/test/integration/invariants-cloture/limits-9b.spec.ts
- apps/api/test/integration/invariants-cloture/payment-data-exposure.spec.ts
- apps/api/test/unit/payouts/payout-roles.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 : Remboursements et réclamations tardives : IBAN chiffré

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- les notes de lane de **WP02** (migrations `0092`, `0093` : nom réel du déclencheur d'insertion, de la contrainte
  `refund_request_iban_sealed`), **WP03** (liste des 16 colonnes d'`INSERT`, droits) et **WP08** (API réelle de
  `IbanVault`, `IbanVaultModule`, nouvelle liste `REDACTED_FIELDS`) ;
- `research/R-9b-iban-remboursements-versements.md` §1.2 (les trois emplacements de l'IBAN), §1.4 points 4 (écritures),
  5 (lectures, `iban_mask`) et 10 (tests), §2.1 (droits et gardes) et §2.2 points 4-5 (tests de l'insertion) ;
- `apps/api/src/refunds/refund-backoffice-create.service.ts` (entier : INSERT l. 78-97, audit l. 112-130) ;
- `apps/api/src/late-claims/late-claim-action.ts` l. 30-60 (`LateClaimPayload`, `FIELDS`), l. 183-270 (`request`),
  l. 270-380 (`definition`, `execute`), l. 383-450 (`claimBody`, `validatePayload`) ; `late-claims.dto.ts` l. 75-130
  (`parseLateClaimBody`, destination) ; `approval/action-registry.ts` l. 40-60 (signatures `validate`, `execute`) ;
- `apps/api/src/approval/approval.mapper.ts` l. 50-95 (`maskPaymentData`) ;
- tests : `refunds/create-backoffice.spec.ts` l. 25-80, `late-claims/late-claim.spec.ts` l. 270-370,
  `invariants-cloture/limits-9b.spec.ts` (entier), `invariants-cloture/payment-data-exposure.spec.ts` (entier),
  `unit/payouts/payout-roles.spec.ts` l. 85-110.

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi. Contradiction : tu la signales.

## Objective

Écrire chiffrés les IBAN des demandes de remboursement du back-office (`refund_request.iban`) et des réclamations
tardives (`approval_request.payload.destination.iban`), faire rendre `iban_mask` par `maskPaymentData`, et inverser
les tests de borne de la 9b : une demande de remboursement ne peut naître qu'à son état initial, et rien d'un IBAN en
clair ne reste en base ni dans l'audit (FR-010, FR-011, NFR-005, SC-003). Les versements (`payout`, payload `PAYOUT`)
et l'export CSV sont à **WP10**.

## Context

- **Points ouverts levés** : OP-N140 (partie remboursements et réclamations tardives) et OP-N145 (côté tests).
- **Décisions du porteur du 18/11/2026 qui s'appliquent** : clé de l'IBAN en configuration de l'API (aux trois
  emplacements) ; `refund_deposit(uuid, uuid)` gardée, exécutable par personne (preuve en base : WP02 et WP03 ; tu
  ne touches ni migration ni droit).
- **Interfaces consommées** : `IbanVault.seal(iban, operatorId)`, `.open(...)`, `.isSealed(...)` (WP08) ; contrainte
  `refund_request_iban_sealed` (`CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID`) et déclencheur
  d'insertion `CL057` (WP02) ; droits d'`INSERT` par colonne (WP03).
- **Interface possédée** : « Payload d'approbation : `iban` chiffré + `iban_mask` (valeur de `maskIban`) ;
  `maskPaymentData` rend `iban_mask` » (`interfaces.md`). WP10 s'y conforme pour les lignes `PAYOUT` : **fige la forme
  exacte dans ta note de lane** (clé `iban_mask` à côté de `iban`, au même niveau d'objet).
- **Hors carte, à lister dans la note** : `apps/api/src/errors/sqlstate-map.ts`, une ligne `CL057` (mission 11a,
  migration 0092 : insertion de demande refusée) vers un code et un statut **existants**, sans code exposé nouveau.
- **Fichier à faire relire par une personne** (règle 4) : aucun de ceux-ci ne porte de clé ni de droit ; WP08 porte la
  cryptographie.

## Subtasks

### T034 : demande de remboursement du back-office, IBAN chiffré, audit masqué

1. `RefundBackofficeCreateService` reçoit `IbanVault` (constructeur) ; `IbanVaultModule` est global, aucun import de
   module à ajouter. Calcule `const mask = input.iban ? maskIban(input.iban) : null` **avant** de chiffrer.
2. L'`INSERT` (l. 78-97) passe `input.iban ? this.vault.seal(input.iban, actor.operatorId) : null` ; rien d'autre ne
   change dans la requête (mêmes colonnes : ce sont les 16 colonnes accordées par WP03). L'audit garde
   `iban: mask` ; la réponse (`toRefundRequest`) n'a jamais rendu l'IBAN et ne le rend toujours pas.
3. Aucun lecteur TypeScript de `refund_request.iban` n'existe (`REFUND_COLUMNS`, `toRefundRequest`) : n'en crée pas.
   Si tu en trouves un, **signale-le** : c'est une lecture à ouvrir avec le coffre, hors plan.
4. Erreur du coffre à l'écriture (anneau absent en test) : propage ; ne retombe jamais sur l'écriture en clair (le
   `CHECK` de WP02 la refuserait de toute façon).

Validation : `create-backoffice.spec.ts` (cas T037).

### T035 : réclamation tardive, `destination.iban` chiffré, `iban_mask`

1. Construction de la charge (`LateClaimActions.request`, l. 236-250) : pour `BANK_TRANSFER`,
   `destination = { method, iban: vault.seal(claim.destination.iban, operatorId), iban_mask:
   maskIban(claim.destination.iban) }` ; Wave et Orange Money : inchangé (`msisdn`, aucun `iban`). L'audit
   `LATE_CLAIM_REQUESTED` n'a jamais porté l'IBAN : garde-le ainsi (le moyen seul).
2. Type `LateClaimPayload.destination` : ajoute `iban_mask?: string` ; `LateClaimActions` reçoit `IbanVault`.
3. `validate` (appelée à la création de la demande et à l'exécution, **sans** le prestataire en argument) vérifie la
   **forme** : pour `BANK_TRANSFER`, `iban` doit satisfaire `isSealed` et `iban_mask` doit être une chaîne ; un IBAN
   **en clair** dans la charge est refusé (`unprocessable`, sans écho de la valeur) ; `iban_mask` hors
   `BANK_TRANSFER` ou champ en trop : refusé. Conséquence à signaler : une demande `PENDING` créée avant la mission
   avec un IBAN en clair ne s'exécute plus (bases de développement seulement ; pas de donnée réelle avant production).
4. `execute` : le prestataire est `request.operator_id`. **Ouvre** l'enveloppe avec le coffre pour revalider
   (`isValidIban`) et pour `parseLateClaimBody`, **sans réécrire le clair** nulle part (ni charge, ni résultat, ni
   audit, ni journal). `moneyAccountOf` n'utilise que la méthode. Une enveloppe illisible : erreur nommée sans valeur,
   la demande passe `FAILED` comme pour tout refus de revalidation ; jamais le clair en repli.
5. Piège : `validatePayload` renvoie aujourd'hui la destination **recalculée** par `parseLateClaimBody` (qui rejette
   `iban_mask` : `onlyFields`). Sépare la validation de forme du chiffré (ci-dessus) de la validation de l'IBAN clair
   (à l'ouverture), et ne laisse pas `iban_mask` atteindre `parseLateClaimBody`.

Validation : `late-claim.spec.ts`, `late-claim-proof.spec.ts`, `late-adjustment.spec.ts`, `money-account.spec.ts`
(non possédés : tu les lances pour t'assurer que rien ne casse ; un échec se signale).

### T036 : `approval.mapper.ts`, `maskPaymentData` rend `iban_mask`

1. Le mapper reste **pur** (pas de coffre). Pour une clé `iban` dont la valeur est une enveloppe (préfixe `enc:v1:`) :
   rends la valeur de la clé sœur `iban_mask` si c'est une chaîne, sinon `[masqué]` (`REDACTED`) ; **jamais
   l'enveloppe** dans la réponse ni dans l'audit qui recopie le DTO. La clé `iban_mask` elle-même est rendue telle
   quelle (déjà masquée). Un `iban` en clair (ancienne ligne) : `maskIban`, comme aujourd'hui. `msisdn` inchangé.
2. Mets à jour le commentaire de la fonction. Récursif à toute profondeur : listes `lines[]` des versements comprises
   (WP10), `destination` des réclamations tardives.
3. `unit/payouts/payout-roles.spec.ts` (bloc « masque des données de paiement ») : ajoute enveloppe + `iban_mask` →
   `iban_mask` rendu, enveloppe absente de la sortie ; enveloppe sans `iban_mask` → `[masqué]` ; clair → `maskIban`.

Validation : `SKIP_LATENCY=1 npx jest test/unit/payouts --runInBand --forceExit`.

### T037 : tests inversés et étendus

1. `limits-9b.spec.ts`, **bloc OP-N140** : inverse-le : `redactSecrets` masque `{"iban":"…"}` et `iban=…` ; la liste
   de `REDACTED_FIELDS` est exactement celle de WP08 (ancienne + `iban`) ; les secrets déjà couverts restent masqués.
   Renomme en « OP-N140 levé ».
2. `limits-9b.spec.ts`, **bloc OP-N145** : `INSERT` réservé à `cashless_app` **sur exactement les 16 colonnes de WP03**
   (`has_column_privilege` vrai pour elles, faux pour les 14 autres, faux pour tout autre rôle `cashless_*`) ; aucun
   `DELETE` ; `UPDATE` de `cashless_app` borné aux 15 colonnes de transition (liste inchangée). Ajoute, sous
   `SET LOCAL ROLE cashless_app` : insertion avec `status` `PAID` ou `CANCELLED` refusée (`42501` si une colonne non
   accordée est citée, `CL057` si seules les colonnes accordées le sont) ; insertion de colonne de transition
   (`approved_by`, `external_reference`, …) refusée `42501` ; les deux insertions légitimes (`AWAITING_HOLDER`,
   `REQUESTED`) passent. Le test échoue si un droit de colonne ou le déclencheur disparaît.
3. `create-backoffice.spec.ts` (l. 51-76) : la ligne stockée n'est plus `iban: IBAN` : `iban` commence par `enc:v1:`,
   ne contient pas l'IBAN, et `vault.open(row.iban, operatorId) === IBAN` (coffre de test, anneau de test) ; audit
   toujours masqué (`FR14*******************2606`) ; réponse sans IBAN. Insertion **en clair** par le propriétaire :
   `23514` sur `refund_request_iban_sealed`. Même IBAN deux fois : deux enveloppes différentes.
4. `late-claim.spec.ts` (l. 343-365) : après une demande par virement, `approval_request.payload` ne contient pas
   l'IBAN (`LIKE '%IBAN%'` : 0 ligne), contient `iban` chiffré et `iban_mask` ; `GET /approval-requests` rend le
   masque ; l'approbation exécute et la paire d'écritures est inchangée (contrôle positif : mêmes montants, mêmes
   comptes qu'avant). Cas : charge falsifiée avec un IBAN en clair ou une enveloppe d'un autre prestataire → refus.
5. `payment-data-exposure.spec.ts` : ajoute `refund_request.iban`, `approval_request.payload` (réclamation tardive) et
   `audit_log` : **aucun IBAN en clair** (NFR-005, SC-003). Le volet « versements » de ce fichier reste sur les
   routes ; la preuve que `payout.iban` est chiffré est dans les tests de WP10 (n'y compte pas ici : la table
   `payout` n'est écrite chiffrée que par WP10).
6. **Mutations NFR-004** (à consigner) : (a) écris l'IBAN en clair dans `refund_request` (retire `seal`) :
   `create-backoffice.spec`
   **et** le `CHECK` doivent échouer ; (b) fais rendre l'enveloppe par `maskPaymentData` : `payout-roles.spec` et
   `late-claim.spec` échouent ; (c) en base de lane, `GRANT INSERT (status, external_reference) ON refund_request TO
   cashless_app` : `limits-9b` échoue ; (d) `ALTER TABLE refund_request DISABLE TRIGGER <déclencheur de WP02>` : le test
   d'insertion `CANCELLED` échoue. Remets chaque contrôle.

Validation (même appel Bash, voir la fiche) : `export PGDATABASE=cashless_wp09; source ../../tools/dev-db/env.sh;
env | grep DATABASE_URL`, puis `SKIP_LATENCY=1 npx jest test/integration/refunds/create-backoffice.spec.ts
test/integration/late-claims test/integration/invariants-cloture/limits-9b.spec.ts
test/integration/invariants-cloture/payment-data-exposure.spec.ts test/unit/payouts --runInBand --forceExit`.
Puis `reset-db`. Lance aussi `test/integration/refunds` (create-refund-request, journey) : mêmes résultats qu'avant.

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP02, WP03 et WP08.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP09 --agent claude --mission
  durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `refund_request.iban` écrit chiffré, audit masqué, réponse sans IBAN ; aucune lecture en clair ajoutée.
- [ ] Charge des réclamations tardives : `iban` chiffré + `iban_mask`, ouverture seulement à l'exécution, clair
      refusé à la validation, jamais réécrit.
- [ ] `maskPaymentData` rend `iban_mask`, jamais l'enveloppe ; forme figée dans la note (WP10 en dépend).
- [ ] `limits-9b.spec.ts` inversé (OP-N140 levé ; INSERT à 16 colonnes ; `PAID`/`CANCELLED` refusés).
- [ ] 0 IBAN en clair dans `refund_request`, `approval_request.payload`, `audit_log` (NFR-005, SC-003).
- [ ] Quatre mutations prouvées et consignées ; `create-refund-request` et la 9b inchangés (SC-002).
- [ ] `openapi.yaml` inchangé ; `check.mjs` à 0 refus ; ligne `CL057` hors carte listée ; lignes ≤ 100.
- [ ] Note de lane : écarts, retouches hors carte, charge `iban`/`iban_mask`, demandes `PENDING` anciennes.

## Risks

1. `validatePayload` rejette `iban_mask` ou accepte un clair : relis la chaîne de validation à la création **et** à
   l'exécution.
2. Un journal ou un message d'erreur cite le clair ouvert à l'exécution (ex. erreur de `parseLateClaimBody`) :
   `unprocessable` ne doit pas écho de la valeur.
3. `limits-9b` échoue avant ton lot à cause de WP08 : c'est attendu ; il doit passer après.
4. Colonne de `refund_request` insérée par l'API et oubliée dans la liste de WP03 : `42501` à l'exécution ; compare
   la liste de colonnes de l'`INSERT` à celle de la note de WP03 et signale tout écart.
5. L'ordre des tests de droits : `SET LOCAL ROLE` sans rollback laisse le rôle ; ferme chaque transaction.

## Ce que le relecteur doit casser

- Créer une demande par virement, puis chercher l'IBAN (et un fragment de 8 caractères) dans `refund_request`,
  `approval_request.payload`, `audit_log`, les réponses de `GET /approval-requests` et de la demande : zéro résultat.
- Falsifier la charge d'une réclamation tardive : IBAN en clair, enveloppe d'un autre prestataire, `iban_mask`
  falsifié, champ en trop : refus, rien d'écrit au grand livre.
- Depuis `cashless_app` : insérer `PAID`, `CANCELLED`, `PROCESSING`, `REJECTED` ; citer une colonne de transition ;
  insérer en clair un IBAN (le `CHECK` doit refuser) : tout refusé. Retirer le déclencheur ou un droit de colonne et
  vérifier que `limits-9b` échoue.
- Chercher un lecteur de `refund_request.iban` laissé en clair ; chercher `maskIban` appliqué à une enveloppe.
- Comparer les réponses de `POST` de remboursement du back-office et de réclamation tardive avant et après.
- Vérifier que le test de « mutation (a) » n'est pas contourné par un `CHECK` seul : le test applicatif doit échouer
  lui aussi, pas seulement la base.
