---
work_package_id: WP17
title: 'Règles pures du hors ligne : temps, conflit, conformité, période, porteur de la perte'
dependencies: [WP01]
requirement_refs:
- FR-020
- FR-022
- FR-025
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T068, T069, T070, T071]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/rules/
create_intent: [apps/api/src/offline/rules/types.ts, apps/api/src/offline/rules/offline-time.ts, apps/api/src/offline/rules/conflict-outcome.ts, apps/api/src/offline/rules/compliance.ts, apps/api/src/offline/rules/period.ts, apps/api/src/offline/rules/loss-bearer.ts, apps/api/test/unit/offline/offline-time.spec.ts, apps/api/test/unit/offline/conflict-outcome.spec.ts, apps/api/test/unit/offline/compliance.spec.ts, apps/api/test/unit/offline/period.spec.ts, apps/api/test/unit/offline/loss-bearer.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/rules/**, apps/api/test/unit/offline/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP17 – Règles pures du hors ligne

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-012, FR-019, FR-020,
FR-022 à FR-026), `research.md` R-12, R-15, R-16 et **R-30.1, R-30.3, R-30.4 (font foi)**,
`contracts/compliance.md` (en entier), `contracts/interfaces.md` § 9, `docs/sync_protocol.md` §7.2 à
§7.4. Priorité des sources : SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée
en silence. Les `.sql` générés ne bougent pas.

## Objective

Écrire, sans aucun accès à la base, à l'horloge ni au réseau, les cinq règles que le processeur de
lots (WP19) applique à chaque opération : heure corrigée, issue d'un conflit de passage, conformité
à la configuration détenue, contrôles de période, porteur de la perte. Chaque règle est une fonction
pure testée par table. Le processeur lit la base et appelle ces fonctions ; elles ne lisent jamais
rien d'autre que leurs arguments.

## Périmètre et arbitrages

- Dans le lot : les cinq fichiers de `offline/rules/` (signatures figées en `interfaces.md` § 9, à
  recopier telles quelles) et leurs tests unitaires. Aucune dépendance de `pg`, `TenantTx`, Nest ou
  `Date.now()` : l'heure et la tolérance (`tolMs`, 120 000 en test et par défaut) viennent de
  l'appelant. Test d'architecture local : aucun `import` interdit dans `rules/` (lecture du texte).
- Hors lot : lecture des entrées de conformité en base, appel des fonctions, écriture des anomalies
  (WP19) ; types générés (`OfflineRejectReason`, `ShortfallReason`, `OperationType`) livrés par WP01
  et importés de `@cashless/contracts` (`components['schemas'][…]`, motif `payments.dto.ts:13`).
- `ComplianceInput` n'est pas figé par `interfaces.md` : tu le définis (`rules/types.ts`) avec les
  groupes listés au § 9 ; WP19 le remplit. Tout champ ajouté est un champ de lecture, pas une règle.
- Décision du porteur (R-30.3) : l'exposition se calcule avec `min(occurred_at_corrigé, received_at)
  − 120 s`. R-12 dit `occurred_at_corrigé − 120 s` : R-30.3 fait foi. Le cumul arrive DÉJÀ calculé
  dans `ComplianceInput` (somme faite par `offline_device_exposure`, WP07) ; la règle compare
  seulement.
- Décision R-30.1 : `online_status = CONFIRMED` avec transaction existante saute la conformité ; la
  fonction reçoit `exempt: boolean` calculé par l'appelant et ne juge pas l'existence elle-même.
- Aucune recharge espèces hors ligne : `TOPUP_CASH` n'arrive jamais à `checkCompliance` (WP19 le
  rejette avant) ; si `type === 'TOPUP_CASH'`, la fonction répond `OFFLINE_NOT_ALLOWED` (défense en
  profondeur).

## Subtasks

### T068 — `resolveOfflineTime`, `detectInversions`

- **Fichier** : `rules/offline-time.ts`. Signatures de `interfaces.md` § 9.
- **`resolveOfflineTime(occurredAt: string, recordedAt, snapshotGeneratedAt | null, tolMs)`** : lit
  `occurredAt` (ISO 8601 avec fuseau ; invalide -> `Error`, la couche d'entrée l'a déjà refusé). Si
  `occurred > recorded + tol` : `corrected = recorded`, `skew 'FUTURE'`. Sinon, si le snapshot est
  connu et `occurred < generated − tol` : `corrected = generated`, `'BEFORE_SNAPSHOT'`. Sinon
  `corrected = occurred`, `'NONE'`. Bornes INCLUSIVES du côté admis : exactement `+tol` reste
  `NONE`.
- **Ordre** : « futur » d'abord ; un snapshot postérieur à `recorded` ne se produit pas (cas absurde
  : le futur gagne). `snapshotGeneratedAt` nul : seul le test du futur s'applique.
- **`detectInversions(ops, tolMs)`** : `ops` triés par numéro croissant ; rend les numéros `n` dont
  la date est antérieure de plus de `tol` à la plus grande date vue AVANT `n` (`max` glissant, pas
  seulement la voisine). Rien d'autre ne change : c'est un signal `CLOCK_SKEW`, pas un rejet.
- **Précision** : arithmétique en millisecondes entières ; pas de `Date.now()`, pas de fuseau local.
- **Critère** : −100 s et +100 s acceptés, +2 h ramené à la réception, −2 h ramené au snapshot
  (`contracts/compliance.md` § Temps) ; bornes ±120 s exactes ; une inversion de 119 s n'est pas
  signalée.

### T069 — `conflictOutcome` (table du protocole §7.3)

- **Fichier** : `rules/conflict-outcome.ts`. Entrée et sortie : `interfaces.md` § 9, à la lettre.
- **Table** (`contracts/compliance.md` § Table de conflit, 11 lignes) — ordre d'évaluation à
  respecter :
  1. `UNKNOWN`, `NOT_ACTIVATED` -> `REJECT MEDIA_NOT_IN_SNAPSHOT` ; `WRONG_EVENT` -> `REJECT
     MEDIA_WRONG_EVENT`.
  2. `CLONE_SUSPECTED` -> couvert 0, manque `amount`, `MEDIA_CLONE_SUSPECTED` ; `UID_MISMATCH` ->
     `MEDIA_UID_MISMATCH` ; `SIGNATURE_MISMATCH` -> `MEDIA_SIGNATURE_MISMATCH` (même forme).
  3. portefeuille `BLOCKED` ou `CLOSED` -> 0 / `amount` / `WALLET_BLOCKED`.
  4. `BLOCKED` (ou état assimilé, voir contradiction) : `blockTime` datée et `occurredAt < blockTime
     + tol` -> couvert `min(spendable, amount)` ; sinon 0 / `amount` /
     `MEDIA_BLOCKED_AFTER_SNAPSHOT` ; `blockTime` `'UNKNOWN'` -> « bloqué avant la vente » : manque
     entier. `null` avec `BLOCKED` : même traitement que `'UNKNOWN'` (jamais de faveur au terminal).
  5. `OK` : `spendable >= amount` -> couvert `amount`, manque 0 ; sinon couvert `spendable`, manque
     le reste, `INSUFFICIENT_FUNDS`.
- **Invariants** (test de propriété sur une grille) : `covered + shortfall === amount` ; `covered >=
  0n` ; `covered <= spendable` ; `shortfall === 0n` implique l'absence de `shortfallReason`.
  `bigint` partout.
- **Contradictions à signaler (R-12 / §7.3 muets)** : (a) `RETIRED`, `REPLACED`, `RELEASED`,
  `BATCH_INACTIVE` ne sont pas dans la table : traités comme `BLOCKED` avec `blockTime` inconnue
  (manque entier, option la plus sûre) ; (b) `blockTime` antérieure ou égale à `snapshotGeneratedAt`
  : le terminal connaissait le blocage, la conformité (#7) a dû le rejeter en amont ; ici, par
  prudence, manque entier. Un test fige chaque choix. Aucun des deux ne desserre un contrôle : pas
  de question au porteur, mais mention dans le rapport.
- **Critère** : une ligne de test par ligne de la table (11), plus `blockTime` à `occurredAt − tol`,
  `+ tol − 1 ms`, `+ tol`, et `'UNKNOWN'`.

### T070 — `checkCompliance`, `checkPeriod`, `lossBearer`

- **`rules/compliance.ts`** : `checkCompliance(i: ComplianceInput)` rend `{ok: true}` ou `{ok:
  false, reason, detail: string[]}`. Les dix contrôles de `contracts/compliance.md` tournent TOUS,
  dans l'ordre du tableau ; le premier échec donne `reason`, les raisons des autres vont dans
  `detail` (codes seuls, aucun montant ni identifiant de personne). `exempt` vrai : `{ok: true}`
  sans autre calcul.
  - #2 : trois conditions (`DEVICE_SUSPENDED`, `DEVICE_REVOKED`, `VENDOR_SESSION`) ; `reason` est
    `OFFLINE_NOT_ALLOWED`, le sous-motif va en tête de `detail`. `offline_enabled` faux : même
    raison.
  - #3 : `config_id` doit valoir `configInForce.configId` (calculé par `offline_config_in_force`,
    WP07, avec `served_at ≤ occurred_corrigé + tol`) ; `null` -> `POLICY_LIMIT_EXCEEDED`. Puis
    `max_per_sale`, cumul bracelet + montant, cumul terminal + montant : plafond atteint EXACTEMENT
    admis, +1 refusé.
  - #4 : version inscrite avant `occurred_corrigé + tol`, enveloppée pour ce terminal, et supérieure
    ou égale au plancher d'accusé (`ackFloor`, R-30.4) -> sinon `SNAPSHOT_VERSION_UNKNOWN`.
  - #5 : âge = `occurred_corrigé − generated_at` ; limite `min(maxSnapshotAge, valid_until −
    generated_at) + tol` ; égal à la limite admis (`SNAPSHOT_TOO_OLD` au-delà).
  - #6 à #9 : états du bracelet, du lot et du portefeuille lus À LA VERSION utilisée (jamais l'état
    courant, R-12) ; #9 `pack_verified === false` -> `PACK_NOT_VERIFIED` (absent = faux).
  - #10 : annulation seulement ; cible absente ou d'un autre terminal -> `REVERSAL_TARGET_NOT_FOUND`
    ; déjà annulée -> `ALREADY_REVERSED`.
- **`rules/period.ts`** : `checkPeriod` (signature § 9) rend `PERIOD_CLOSED` si `occurredAt <=
  lockedUntil` ; `LEDGER_LOCKED` si `ledgerStatus === 'LOCKED'` ; `SYNC_DEADLINE_PASSED` pour une
  vente ou une annulation quand l'événement est `SETTLING` ou après (`CLOSING`, `RECONCILING` :
  ventes acceptées). Anomalie rendue : `PERIOD_CLOSED_OPERATION` pour les deux premiers,
  `LATE_OFFLINE_SYNC` pour le troisième. Premier échec seulement (ordre ci-dessus). `VOID` et
  `ONLINE_REF` ne subissent que les deux premiers contrôles. Appliquée à `CONFIRMED` aussi
  (l'appelant ne l'exempte pas).
- **`rules/loss-bearer.ts`** : `lossBearer` : `PLATFORM` et `OPERATOR` -> `OPERATOR`, `ORGANIZER` ->
  `ORGANIZER`, `MERCHANT` -> `MERCHANT` (`data-model.md` ligne 126). Valeur hors liste : `Error`.
- **Critère** : voir T071.

### T071 — Tests unitaires par table

- **Fichiers** :
  `test/unit/offline/{offline-time,conflict-outcome,compliance,period,loss-bearer}.spec.ts`.
- Un tableau `it.each` par règle, une ligne = un cas nommé (reprendre les libellés du protocole).
  Cas obligatoires : −100 s accepté ; +2 h et −2 h corrigés avec `CLOCK_SKEW` ; `blockTime` inconnue
  ; chaque borne de plafond (égal admis, +1 refusé) ; deux échecs simultanés (premier en `reason`,
  second en `detail`) ; `exempt` ; `TOPUP_CASH` ; `SETTLING` refuse une vente et accepte un `VOID` ;
  `CLOSING` accepte une vente ; `locked_until` égal à `occurredAt`.
- Le test d'architecture vérifie par lecture de texte qu'aucun fichier de `rules/` n'importe `pg`,
  `nest`, `../db`, ni n'appelle `Date.now`, `new Date()` sans argument, `Math.random`.
- **Critère** : `npm test -w @cashless/api -- unit/offline` vert, sans base.

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1). Ici, tout choix qui fait
  payer moins le terminal ou desserre un contrôle (borne exclue au lieu d'incluse du mauvais côté,
  raison omise, `blockTime` inconnue traitée comme « jamais bloqué ») en est un.
- Points sensibles : erreur d'une milliseconde sur une borne de tolérance ; plafond comparé sans le
  montant courant ; `Number` utilisé pour un montant ou un numéro (tout en `bigint`) ; `detail` qui
  fuit un identifiant de personne ; défaut « conforme » quand un champ manque (un champ absent
  refuse).
- Fichiers à faire relire par une personne : aucun, mais `conflict-outcome.ts` décide qui perd de
  l'argent : le relecteur compare la table ligne à ligne avec le protocole.

## Tests

- Cinq suites unitaires ci-dessus, sans base. Commande : `npm test -w @cashless/api --
  unit/offline`.
- Base de lot `cashless_wp17` non nécessaire ; ne lance ni pgTAP ni la suite d'intégration.
  L'orchestrateur relance en série.

## Ce que le relecteur doit casser

1. `occurredAt` à `recorded + 120 000 ms` puis `+ 120 001 ms` : le second est corrigé, pas le
   premier.
2. Opération au plafond par terminal exactement, puis plafond + 1 centime : refus du seul second.
3. `blockTime = 'UNKNOWN'` ou `null` avec bracelet `BLOCKED` : jamais de part couverte au-delà du
   solde quand rien ne prouve que le blocage est postérieur.
4. `covered + shortfall !== amount` sur une grille aléatoire de montants (y compris `0n` et très
   grands).
5. Deux contrôles en échec : le `reason` est le premier du tableau, l'autre est dans `detail`.
6. `exempt: true` : aucune donnée de la base n'est relue ; `exempt: false` sur `CONFIRMED`
   introuvable : conformité complète.
7. Événement `SETTLING` : une vente est refusée (`LATE_OFFLINE_SYNC`), un `VOID` ne l'est pas.
8. Ajouter un import `pg` ou un `Date.now()` dans `rules/` : le test d'architecture rougit.

## Definition of Done

- [ ] Cinq règles pures aux signatures de `interfaces.md` § 9, `ComplianceInput` défini et
  documenté.
- [ ] Tables de `compliance.md` couvertes ligne à ligne, bornes ±tolérance testées.
- [ ] Aucun accès base, horloge ou réseau dans `offline/rules/` (test).
- [ ] `npm test -w @cashless/api -- unit/offline` vert.
- [ ] Rapport : les deux hypothèses de T069, l'écart R-12 / R-30.3, les champs de `ComplianceInput`.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendance : WP01. Worktree attribué
par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP17 --agent claude --mission
hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks

