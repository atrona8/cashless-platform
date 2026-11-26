---
work_package_id: WP06
title: Preuves, spécification et consignation
dependencies: [WP01, WP02, WP03, WP04, WP05]
requirement_refs:
- C-003
- C-004
- FR-013
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
subtasks: [T021, T022, T023, T024]
phase: Phase 4 - Consignation
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: docs/passation-9c/
create_intent:
- docs/passation-9c/preuves.md
- docs/passation-9c/note-equipes.md
execution_mode: code_change
model: sonnet
owned_files:
- docs/SPECIFICATION.md
- docs/DECISIONS_ADR.md
- docs/POINTS_OUVERTS.md
- PROMPTS-A-ENVOYER.md
- PRD.md
- docs/passation-9c/preuves.md
- docs/passation-9c/note-equipes.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Preuves, spécification et consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `spec.md`, `research.md` (D1 à D6, limites L1 et L2), `interfaces.md`, `contracts/partial-cash-refund.md` ;
- les notes de lane des lots WP01 à WP05 (`git log` de chaque lane) et les retours de relecture
  (`<coord>/kitty-specs/remboursement-partiel-especes-01M84932/tasks/*/review-*`) ;
- `docs/SPECIFICATION.md` §8.5 (remboursements) et §17 (valeurs par défaut) ; `docs/DECISIONS_ADR.md` ADR-53, ADR-91,
  ADR-190, ADR-195, ADR-232 (format le plus récent) ; `docs/POINTS_OUVERTS.md` (tableau, OP-N172, section 12) ;
- les entrées « Mission 9c » de `PROMPTS-A-ENVOYER.md` et le paragraphe 9c de `PRD.md` §2.5 ;
- `docs/passation-10a/preuves.md` (format des preuves) et `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md` (format d'une note
  aux équipes clientes).

## Objective

Tenir la documentation normative juste après la livraison : spécification amendée, décisions et limites consignées
(règle 3 de `CLAUDE.md`), reports faits, preuves rassemblées. Aucun code.

## Subtasks

### T021 — `SPECIFICATION.md` §8.5 et §17

1. §8.5, puce « espèces au guichet » : ajoute le rendu partiel sans restitution (conditions : autorisation du
   prestataire, activation par l'organisateur ; montant débité, espèces = montant − frais ; seconde personne au cumul du
   jour du portefeuille ; crédits offerts et caution intacts ; indisponible pendant `EDGE`), amendement daté
   (23/11/2026, décision du porteur) qui renvoie à ADR-233. **Ne change pas le numéro de version** (décision du porteur).
2. §17 : deux lignes de réglage (`cash_partial_refund_allowed`, prestataire, défaut `false` ;
   `cash_partial_refund_enabled`, événement, organisateur, défaut `false`).

### T022 — ADR-233, points ouverts, fichiers à relire

1. ADR-233 au format d'ADR-232 : décision (rendu partiel, deux réglages), décisions du porteur du 23/11/2026 (cumul par
   portefeuille — renforcement —, anonymes avec frais, montant débité), réalise ADR-53 point 3, renvoie à ADR-190 et
   ADR-195, alternatives écartées (research D1 à D5).
2. Chaque limite ou écart des notes de lane et des relectures : un point ouvert (à partir d'**OP-N173** ; OP-N170 et
   OP-N171 réservés) avec ADR, test de borne existant cité ou absence assumée, mission qui le lève. L2 (espèces dues non
   rendues par ce chemin) au moins.
3. Section 12 de `POINTS_OUVERTS.md` : liste des fichiers à faire relire par une personne (au moins
   `partial-refund.service.ts`, `partial-refund-threshold.ts`, la migration `0100`, `bounds-validator.ts`), complète au
   regard de `git diff --name-only <base>..HEAD`.

### T023 — Reports et note aux équipes

1. `PROMPTS-A-ENVOYER.md` : entrée 9c cochée et état ; reports aux missions qui héritent (12 : écran du guichet ;
   11 : réglages au back-office ; 13 : recette).
2. `PRD.md` §2.5 et §8 : 9c livrée ; ligne de fraîcheur dans `docs/06-docs-status.md` **non** (hors de ton lot : signale-la).
3. `docs/passation-9c/note-equipes.md` : note courte aux équipes de l'app terminal et du back-office (opération, deux
   réglages, codes de refus et `reason`, seconde personne, réponse `201`).

### T024 — `docs/passation-9c/preuves.md`

Tableau FR/NFR/SC/C → tests, commande, résultat, mutations, repris des notes de lane ; tout ce qu'aucune note n'établit
est écrit « non établi ». pgTAP : à la CI de la PR (décision du porteur du 23/11/2026).

## Definition of Done

- [ ] §8.5 et §17 amendés, version inchangée ; ADR-233 ; points ouverts et section 12 à jour ; reports faits ;
      `preuves.md` sans affirmation non établie.
- [ ] `SKIP_LATENCY=1 npx jest test/integration/invariants-cloture/consignation.spec.ts --runInBand` vert.

## Ce que le relecteur doit casser

- Une limite des notes de lane sans point ouvert ni ADR (constat bloquant, règle 4).
- Des numéros d'OP ou d'ADR en collision avec `main` (OP-N170, OP-N171 réservés).
- Un chiffre de `preuves.md` qui ne se retrouve dans aucune note.
- Le numéro de version de la SPECIFICATION changé.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission remboursement-partiel-especes-01M84932`
