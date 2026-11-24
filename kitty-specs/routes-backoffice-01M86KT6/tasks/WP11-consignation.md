---
work_package_id: WP11
title: Spécification, ADR et consignation
dependencies: [WP06, WP07, WP08, WP09, WP10]
requirement_refs:
- C-002
- C-003
- C-004
- C-005
- FR-018
- C-006
- SC-001
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T041, T042, T043, T044]
phase: Phase 3 - Preuves transverses et consignation
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: docs/passation-11b/
create_intent:
- docs/passation-11b/preuves.md
- docs/passation-11b/note-equipes.md
execution_mode: code_change
model: sonnet
owned_files:
- docs/SPECIFICATION.md
- docs/DECISIONS_ADR.md
- docs/POINTS_OUVERTS.md
- PRD.md
- PROMPTS-A-ENVOYER.md
- docs/passation-11b/preuves.md
- docs/passation-11b/note-equipes.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 : Spécification, ADR et consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). `execution_mode: code_change` comme le lot de consignation de la 9c : il touche `PRD.md` à la racine. Lis ensuite
la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `spec.md` (FR, NFR, C, SC), `research.md` (D1 à D10, « Contradiction à signaler »), `interfaces.md`,
  `contracts/backoffice-routes.md`, `data-model.md` ;
- les notes de lane de WP01 à WP10 (`git log` de chaque lane) et les retours de relecture
  (`<coord>/kitty-specs/routes-backoffice-01M86KT6/tasks/*/review-*`) : source de toute limite, mutation et mesure ;
- `docs/SPECIFICATION.md` §12.2 (« Contrôles permanents ») et le tableau des types d'anomalie (chercher `SEQ_GAP` et
  `CASH_DIFF`), §15 (exigences non fonctionnelles), §0.3 (priorité) ; `docs/DECISIONS_ADR.md` ADR-232 à ADR-234 (format le
  plus récent) ; `docs/POINTS_OUVERTS.md` (tableau, OP-N170, OP-N182 à OP-N184, section 12) ;
- `PROMPTS-A-ENVOYER.md` (« Mission 11 », « Mission 11b ») et `PRD.md` (paragraphe de 11b) ;
- modèles : `docs/passation-9c/preuves.md`, `docs/passation-9c/note-equipes.md` (forme), `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`.

## Objective

Documentation normative juste après la livraison : spécification amendée, décisions et limites consignées (règle 3 de
`CLAUDE.md`), OP-N170 levé, reports faits, preuves rassemblées avec leur source. Aucun code ni test (hors vérification).

## Subtasks

### T041 — `SPECIFICATION.md` §12.2 et §15

1. **§12.2** : le tableau des types d'anomalie passe à **23 types** : ajoute `CASH_TOPUP_OVER_LIMIT` et
   `PSP_TOPUP_NOT_CREDITED` (présents dans le schéma, absents du texte) ; ajoute une colonne « classable » (vrai pour les 10
   types de D1, faux pour les 13 autres, sans en retirer ni en ajouter : C-005). Note datée du 24/11/2026 (décision du
   porteur) : contradiction constatée avec le schéma, **le schéma prime (§0.3)**, renvoi à ADR-235. Vérifie le nombre de
   types contre `packages/ledger-sql/` (le CHECK de `anomaly.kind`) avant d'écrire « 23 ».
2. **§15** : modèles de téléphone (liste tenue par la plateforme), niveau NFC (`RECOMMENDED`, `TOLERATED`, `UNTESTED`
   calculé), modèle **déclaré par le terminal** donc informatif et non vérifié, jamais un refus d'enrôlement (C-003).
3. **Ne change pas la ligne de version** de la SPECIFICATION (décision du porteur, comme en 9c).

### T042 — ADR-235, ADR-236, OP-N170 levé, points ouverts

> Renforcement décidé aux tâches (orchestrateur, 24/11/2026) à consigner dans ADR-235 : `PLATFORM_ADMIN` n'a pas
> `searchCustomerByPhone` (une recherche sans prestataire porterait sur tous les prestataires).

1. **ADR-235** (format d'ADR-232 à ADR-234) : mission 11b, décisions D1 à D10 du porteur du 24/11/2026 (10 types
   classables tenus par la base ; modèle déclaré par le terminal, exception à C-001 limitée à deux requêtes et deux
   réponses ; matrice échantillon `x-roles` ; retrait du droit direct de clore une anomalie ou garde — **dis lequel
   WP01 a retenu**, renforcement ; audit de la recherche par numéro sans numéro ; table de plateforme ; aucun code
   d'erreur nouveau), ajouts au contrat (A1 à A6, `contract-baseline.json`), alternatives écartées.
2. **ADR-236** : limites acceptées, une par point ouvert ci-dessous (risque, raison, mission qui la lève, condition de
   levée, test de borne cité ou absence assumée).
3. **OP-N170 levé** : colonne de levée renseignée (mission 11b, ADR-235) ; le texte de la ligne n'est pas réécrit.
4. **Points ouverts nouveaux, à partir d'OP-N185** (OP-N184 est le dernier ; vérifie `main` et la coordination avant de
   numéroter) : au minimum (a) résolutions d'anomalie qui écrivent de l'argent, **reportées type par type** (les 13 non
   classables, dont `PSP_TOPUP_NOT_CREDITED`, `CASH_TOPUP_OVER_LIMIT`) ; (b) modèle déclaré par le terminal, non
   vérifié ; (c) matrice `x-roles` par échantillon : un rôle oublié mais refusé à juste titre n'est pas détecté (+ toute
   dérive trouvée par WP10) ; (d) recherche par numéro : limite de débit par personne, pas par numéro ; (e) niveau NFC
   calculé à la lecture, sans historique ; (f) tout écart ou constat des notes de lane et des relectures. Chaque point :
   colonne « bloque la production » honnête, mission qui le lève (la mission suivante des résolutions pour (a)).
5. **Section 12** de `POINTS_OUVERTS.md` : fichiers à faire relire par une personne, complète au regard de
   `git diff --name-only <base>..HEAD` : au moins `0101_anomaly_classification_phone_models.sql` (fonctions `SECURITY
   DEFINER`, retrait de droit), `search.service.ts` et `search-rate-limit.ts` (donnée personnelle), `anomalies.service.ts`,
   `phone-models.service.ts` (connexion de plateforme), `tools/contract-stability/x-roles/roles.json`.

### T043 — Reports et note aux équipes

1. `PROMPTS-A-ENVOYER.md` : entrée 11b cochée avec son état ; **Mission 11** : routes disponibles (liste des 11
   opérations, `x-roles`, `contract-baseline.json`), écrans à construire sur elles ; **mission suivante des résolutions
   d'anomalie** : héritage de la limite (a) (OP-N185) avec commandes déjà rédigées comme pour les autres missions.
2. `PRD.md` : paragraphe de 11b passé à « livrée » ; périmètre de la mission des résolutions enrichi. **Ne touche pas
   `docs/06-docs-status.md`** (hors de ton lot : signale-le dans la note de lane).
3. `docs/passation-11b/note-equipes.md` : note courte à l'équipe du back-office web (et à celle de l'app terminal pour
   `device_model`) : chaque opération (méthode, chemin, rôles, filtres), pagination (curseur opaque, `limit` ≤ 200),
   codes et `reason` (`ANOMALY_KIND_NOT_CLASSIFIABLE`, `409 CONFLICT_STATE`, `429` + `Retry-After`), `classifiable` à lire
   plutôt qu'une liste recopiée, masque du numéro, `x-roles` pour masquer les actions, niveau NFC jamais bloquant.

### T044 — `docs/passation-11b/preuves.md`

Tableau FR / NFR / SC / C → tests, **commande exacte, base (`cashless_wpXX`), résultat, mutation**, repris des notes de lane
et des relectures. **Chaque chiffre (p95, nombre d'appels, durée, effectifs) cite sa commande et sa source (note de lane
ou relecture)** ; ce qu'aucune note n'établit est écrit « non établi » (renvoi du WP06 de la 9c : chiffres sans source).
Inclure : p95 sur 200 000 ventes (WP06), recherche (WP08), pagination 1 000 ventes, grand livre inchangé (WP07), droit
`UPDATE anomaly` retiré (WP07, WP01), audit sans numéro (WP08), matrice (WP10), pgTAP (à la CI de la PR, décision du
porteur).

## Retouches hors carte permises

Aucune.

## Definition of Done

- [ ] §12.2 (23 types, colonne « classable ») et §15 amendés, version inchangée ; ADR-235 et ADR-236 ; OP-N170 levé ;
      OP-N185 et suivants ; section 12 à jour ; reports faits ; `preuves.md` sans affirmation non établie.
- [ ] `SKIP_LATENCY=1 npx jest test/integration/invariants-cloture/consignation.spec.ts --runInBand` vert (chaque test cité
      existe ; ADR et OP cohérents).

## Ce que le relecteur doit casser

- Une limite des notes de lane sans point ouvert ni ADR (constat bloquant, règle 4) ; un écart de sécurité non consigné.
- Des numéros d'OP ou d'ADR en collision avec `main` (dernier connu : ADR-234, OP-N184).
- Un chiffre de `preuves.md` qui ne se retrouve dans aucune note, ou sans commande.
- Le numéro de version de la SPECIFICATION changé ; un type d'anomalie ajouté ou retiré au lieu d'être documenté (C-005).
- Un test cité inexistant (lance `consignation.spec.ts`) ; la résolution d'anomalie d'argent présentée comme livrée.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission routes-backoffice-01M86KT6`
