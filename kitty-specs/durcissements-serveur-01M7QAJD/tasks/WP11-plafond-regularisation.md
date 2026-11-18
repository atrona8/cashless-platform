---
work_package_id: WP11
title: Plafond de la régularisation des frais (OP-N141)
dependencies: []
requirement_refs: [FR-017]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: f3cfd183b91f8df9c584791e849f8d88c3d26914
created_at: '2026-11-18T15:13:23.848599+00:00'
subtasks: [T043, T044, T045]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/ledger/builders/closing/fees.ts
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/ledger/builders/closing/fees.ts
- apps/api/test/unit/builders/closing/closing-builders.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 : Plafond de la régularisation des frais (OP-N141)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- `kitty-specs/durcissements-serveur-01M7QAJD/plan.md` IC-06 ; `spec.md` FR-017 ;
  `research/R-9b-iban-remboursements-versements.md` §4 (état actuel et conception) ;
- `apps/api/src/ledger/builders/closing/fees.ts` en entier (155 lignes) : `OperatorFeePayload` (l. 89-100) et
  `buildOperatorFee` (l. 102-128, branche de régularisation l. 110-114) ;
- `apps/api/src/closing/calculators/operator-fee.ts` l. 25-50 (`feeTotal`, `readBases`) et
  `apps/api/src/closing/calculators/operator-fee-regularization.ts` l. 21-84 (seul appelant : `delta`, commande
  `{variant: 'REGULARIZATION', bases: gross, regularization: true, amount: delta}`, l. 51-67) ;
- `apps/api/src/ledger/builders/festival/lines.ts` l. 1-20 (`requirePositive`, `BuildError`) ;
- tests : `apps/api/test/unit/builders/closing/closing-builders.spec.ts` (contexte `ctx`, `command`, `expectBalanced`,
  test existant « OPERATOR_FEE en régularisation » l. 315), `apps/api/test/unit/closing/calculators.spec.ts`
  l. 167-205, `apps/api/test/integration/closing/closing-variants.spec.ts` l. 33-48 et 91 (lecture seule).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

L'écart explicite d'une régularisation `OPERATOR_FEE` (variante `REGULARIZATION`) ne peut jamais dépasser les frais
bruts
du prestataire, calculés par la même arithmétique que la branche normale. Le plafond est posé dans le constructeur,
le seul endroit où toute écriture `OPERATOR_FEE` passe, pour qu'une valeur corrompue ou une commande forgée par un
futur appelant échoue avant d'écrire au grand livre.

## Context

- Point ouvert levé : **OP-N141** (mission 9b, ADR-205 : « limite résiduelle OP-N141 »). Condition de levée : écart
  borné par les frais bruts de l'événement.
- Aujourd'hui la seule borne est `amount > 0` (`requirePositive`). Le calculateur interne ne dépasse jamais le plafond
  (`delta <= grossFees` par monotonie de `fee`) : le plafond protège contre une valeur fausse, pas contre l'usage
  normal. Aucun changement de comportement d'une route (C-002), aucun droit, aucune migration, aucun code d'erreur
  exposé nouveau (`VALIDATION_FAILED` existe déjà).
- Lot **sans dépendance** : il peut partir dès que la lane est créée, en parallèle de la phase 1.
- Montants TTC : `amount` et les frais bruts sont tous deux TTC (`creditWithTax` extrait ensuite la taxe) ; la
  comparaison se fait donc en TTC des deux côtés, jamais sur un montant hors taxe.
- **Interface possédée** : `operatorFeeTotal(config, bases): bigint` exportée de `fees.ts` (nom proposé ; si le fichier
  contient déjà un nom plus naturel, garde-le et signale-le dans la note de lane).
- **Retouche hors carte autorisée, une seule, listée dans la note de lane** :
  `apps/api/src/closing/calculators/operator-fee.ts`, où `feeTotal` devient un appel à `operatorFeeTotal` (un seul
  calcul, pas de dérive entre le calculateur et le constructeur). Si cette retouche se révèle impossible sans toucher
  la signature de `feeTotal`, ne touche pas le fichier : laisse les deux calculs et signale le risque de dérive.
- Chemin corrigé par la préparation : la recherche cite `closing/fees.ts`, le fichier réel est
  `apps/api/src/ledger/builders/closing/fees.ts` ; il n'existe pas de `closing/fees.spec.ts`, les constructeurs de
  clôture sont testés dans `closing-builders.spec.ts` (étendu ici, aucun fichier nouveau).

## Subtasks

### T043 : `fees.ts` : plafond aux frais bruts, `feeTotal` factorisé

- **But** : FR-017. `buildOperatorFee`, branche `regularization && amount !== undefined`, refuse `amount > grossFees`.
- **Étapes** :
  1. Extraire dans `fees.ts` une fonction exportée `operatorFeeTotal(config, bases)` :
     `Σ_{config.operatorFees} (basis === 'PER_MEDIA' ? (bases.PER_MEDIA ?? 0n) * fee(0n, rule) :
     fee(bases.TOPUP_AMOUNT ?? 0n, rule))`. C'est exactement l'arithmétique de la branche normale (l. 115-121) : la
     branche normale doit **l'utiliser aussi** si le résultat reste identique ligne par ligne (elle écrit une ligne par
     règle, jamais fusionnées, avec `tagFee` : ne change pas ce comportement, ne réutilise la fonction que pour la
     somme du plafond si la factorisation complète casserait les lignes).
  2. Dans la branche de régularisation, après `requirePositive(amount, …)` et **avant** toute ligne écrite, calculer
     `gross = operatorFeeTotal(config, bases)` ; si `amount > gross`, lever
     `BuildError('VALIDATION_FAILED', 'écart de régularisation : supérieur aux frais bruts')` (même type d'erreur que
     les refus voisins, voir l'usage de `BuildError` dans le fichier).
  3. `amount === gross` reste admis (tout remboursé : net 0, écart = frais bruts).
  4. `bases` absent ou vide, ou `config.operatorFees` vide : plafond `0n` : tout `amount > 0` est refusé (le
     calculateur renvoie déjà `notApplicable` pour une liste de règles vide, donc ce cas n'est pas atteint en usage
     normal).
  5. Aucun champ nouveau dans `OperatorFeePayload` : `bases` est déjà dans la commande (calculateur l. 62-67).
- **Fichiers** : `apps/api/src/ledger/builders/closing/fees.ts` ; retouche hors carte :
  `closing/calculators/operator-fee.ts`.
- **Validation** : `npx jest test/unit/builders/closing test/unit/closing --runInBand` (aucune base nécessaire pour les
  unitaires) ; puis `closing-variants.spec.ts` (intégration, base `cashless_wp11`) inchangé et vert.
- **Pièges** : `bigint` partout, jamais `Number` ; `PER_MEDIA` multiplie un **nombre de supports** par `fee(0n, rule)`
  (montant fixe par support) et n'applique pas le pourcentage, ne pas confondre avec `TOPUP_AMOUNT` ; ne pas arrondir
  deux fois ; ne pas changer l'ordre des lignes ni les étiquettes de `tagFee` (le scénario de référence 31 est figé).

### T044 : unitaires du plafond ; `closing-variants.spec.ts` vert

- **Étapes** : dans `closing-builders.spec.ts`, près du test « OPERATOR_FEE en régularisation : sens inverse »
  (l. 315), ajouter un bloc `describe('OPERATOR_FEE régularisation : plafond (OP-N141)')` :
  - écart = frais bruts (calculés par `operatorFeeTotal` sur les mêmes `bases` et `ctx`) : accepté, écriture équilibrée
    (`expectBalanced`), sens inverse ;
  - écart = frais bruts + 1 : `BuildError` de code `VALIDATION_FAILED` (vérifier `toThrow(BuildError)` **et** le
    message), **aucune** ligne produite ;
  - `bases` vides avec `amount > 0` : refus ;
  - un cas par assiette : `PER_MEDIA` seul, `TOPUP_AMOUNT` seul, les deux ensemble (règles min/max/fixe de la
    configuration du `ctx` de test : lire la configuration avant d'écrire les valeurs, ne pas les deviner) ;
  - `amount` nul ou négatif : toujours refusé par `requirePositive` (non-régression de la borne existante) ;
  - **contrôle positif** : le même appel sans `regularization` (branche normale) reste inchangé, ce qui prouve que le
    plafond ne s'applique qu'à la régularisation ;
  - cohérence : `operatorFeeTotal(ctx.config, bases)` égale `feeTotal(ctx.config, bases)` du calculateur pour les trois
    jeux de `bases` ci-dessus (garde contre toute dérive future).
- Le test existant (l. 315) ne doit pas changer : son `amount` implicite n'est pas posé, il passe par la branche normale
  inversée (vérifie-le en le lisant avant de continuer).
- **Validation** : `closing-builders.spec.ts`, `calculators.spec.ts`, `status-matrix.spec.ts` verts ;
  `closing-variants.spec.ts` (écart 200 < brut, rejeu) vert sans modification.

### T045 : mutation du plafond consignée

- **But** : NFR-004. Montrer que les tests de T044 échouent sans le contrôle.
- **Étapes** : (1) retire la comparaison `amount > gross` ; lance les unitaires ; constate l'échec de « brut + 1 » et de
  « bases vides » ; (2) remets le contrôle ; (3) seconde mutation : remplace `>` par `>=` ; constate l'échec du cas
  « écart = frais bruts : accepté » ; remets. Note les deux mutations et leur résultat (nom des tests en échec) dans la
  note de lane, avec la sortie résumée.
- **Piège** : une mutation qui laisse tous les tests verts est un constat : ajoute le cas manquant avant de conclure.

## Branch Strategy

Planification et fusion sur `feat/durcissements-serveur`. Le worktree de lane est calculé par `lanes.json`
(`.worktrees/durcissements-serveur-01M7QAJD-lane-x`) ; travaille uniquement dedans. Implémentation :

```
LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission durcissements-serveur-01M7QAJD
```

Les unitaires n'ont pas besoin de la base. Pour `closing-variants.spec.ts` : `export PGDATABASE=cashless_wp11;
source ../../tools/dev-db/env.sh; env | grep DATABASE_URL` dans le même appel, puis
`SKIP_LATENCY=1 npx jest test/integration/closing/closing-variants.spec.ts --runInBand --forceExit` depuis `apps/api`
de la lane ; `reset-db` après.

## Definition of Done

- [ ] `buildOperatorFee` refuse en régularisation un écart supérieur aux frais bruts, avant d'écrire une ligne.
- [ ] `amount` égal aux frais bruts admis ; `bases` vides ou règles absentes : plafond zéro, refus.
- [ ] `operatorFeeTotal` exportée ; `feeTotal` du calculateur la réutilise (ou l'écart est signalé).
- [ ] Unitaires : brut accepté, brut + 1 refusé, `PER_MEDIA`, `TOPUP_AMOUNT`, les deux, branche normale inchangée.
- [ ] Scénario de référence (31, 32) et `closing-variants.spec.ts` inchangés et verts.
- [ ] Deux mutations (retrait du contrôle, `>` pour `>=`) vérifiées et notées dans la note de lane.
- [ ] Aucun changement de contrat, de migration ou de droit ; lignes de 100 caractères au plus.
- [ ] La retouche hors carte (`operator-fee.ts`) est listée dans la note de lane, ou son absence justifiée.

## Risks

- Factorisation qui change l'arithmétique d'une ligne de la branche normale : le scénario de référence le verrait ;
  lancer `closing-builders.spec.ts` entier, pas seulement le bloc nouveau.
- Plafond trop strict si la configuration résolue d'une régularisation diffère de celle du calcul brut (un taux changé
  entre la clôture et la régularisation) : le calculateur passe `bases` brutes **écrites en SETTLING** et la même
  `config` du contexte ; signale tout cas où le `ctx` du constructeur n'est pas celui du calculateur.
- Le plafond ne se déclenche jamais en usage normal : le test unitaire est la seule preuve qu'il est actif ; d'où les
  deux mutations.

## Ce que le relecteur doit casser

1. Forger une commande `{regularization: true, amount: brut + 1}` (et `amount` énorme, `bases` vides, `bases` à zéro)
   et vérifier le refus avant toute ligne écrite et avant toute écriture du grand livre.
2. Vérifier la borne exacte : `brut` passe, `brut + 1` échoue ; `bigint` sans arrondi, les deux assiettes ensemble.
3. Chercher un contournement : un autre constructeur ou chemin qui écrit `OPERATOR_FEE` sans passer par
   `buildOperatorFee` (grep de `'OPERATOR_FEE'` dans `ledger/` et `closing/`).
4. Relancer les deux mutations de la note et constater les échecs annoncés ; chercher un test qui passerait sans le
   plafond (comparaison au mauvais montant, HT au lieu de TTC).
5. Contrôler que la branche normale produit les mêmes lignes qu'avant (scénario de référence) et que `feeTotal` et
   `operatorFeeTotal` ne divergent pas.
6. Écart non signalé : fichier hors `owned_files` modifié autre que `operator-fee.ts`, dépendance, code d'erreur exposé.
