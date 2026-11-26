---
work_package_id: WP13
title: 'Consignation : OP, ADR, libellés 12b, paramètres à poser, preuves'
dependencies: [WP04, WP11, WP12]
requirement_refs:
- FR-015
- SC-001
- C-003
- C-006
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T055, T056, T057, T058, T059]
phase: Phase 3 - Garde, essais, consignation
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: docs/passation-12b-1/
create_intent:
- docs/passation-12b-1/preuves.md
- docs/passation-12b-1/note-equipes.md
execution_mode: code_change
model: sonnet
owned_files:
- docs/SERVICES-EXTERNES.md
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
- PRD.md
- PROMPTS-A-ENVOYER.md
- docs/passation-12b-1/preuves.md
- docs/passation-12b-1/note-equipes.md
- apps/api/test/integration/invariants-cloture/consignation.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 — Consignation : OP, ADR, libellés 12b, paramètres à poser, preuves

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/spec.md`, `<M>/plan.md` (D1 à D9), `<M>/research.md` (points « à confirmer à l'essai »), notes de lane et
  comptes rendus de relecture des lots (`<M>/tasks/WP*/`) ;
- `docs/POINTS_OUVERTS.md` (§ le plus récent, forme d'une entrée), `docs/DECISIONS_ADR.md` (dernier ADR : ADR-236),
  `docs/SERVICES-EXTERNES.md`, `test/integration/invariants-cloture/consignation.spec.ts` ;
- modèle : `docs/passation-11b/preuves.md` et `note-equipes.md`.

## Objective

Dette nommée (règle 3 du porteur) et livrables documentaires : chaque écart a son OP, son ADR, son test de borne
et son report ; il ne reste au porteur que les paramètres à poser (FR-015, SC-001).

Dépendances : WP04, WP11, WP12. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP13 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T055 — OP et ADR

Numéros suivants (vérifie le dernier OP-N et ADR). À créer au minimum :
- **PayDunya, preuve d'origine fixe (D2)** : risque (qui connaît la valeur forge un signal), raison (fonctionnement de
  PayDunya), compensation (signal seul, confirmation authentifiée, une relecture par minute), test de borne (nom exact
  de WP06 et WP03), mission qui le lève (aucune tant que PayDunya ne signe pas ; à réexaminer à l'essai), condition.
- **Carte PayDunya non créditée (D7)** : conséquence fonctionnelle, réexamen après l'essai en bac à sable.
- **Rapprochement PayDunya manuel** (aucun relevé documenté).
- **Points « à confirmer à l'essai »** (statuts PayDunya `failed`/`cancelled`, échéance de facture, XOF sans décimale
  chez Stripe, éligibilité Sénégal chez Stripe) : un OP qui les liste, levé par les essais.
- **Wave sans clé d'idempotence** (reprise par recherche) : limite.
- Écarts relevés par les relectures (notes de lane) : un OP chacun s'ils restent ouverts.

### T056 — Libellés « 12b »

Dans `SERVICES-EXTERNES.md`, `POINTS_OUVERTS.md` (OP-N81, OP-N89, OP-N41, OP-N73…), `DECISIONS_ADR.md` (ADR-131…) :
précise « 12b-1 » pour ce que la mission livre et « 12b » (reste) pour les fournisseurs non décidés et Orange Money.
N'efface aucune information ; un OP levé par la 12b-1 est marqué « levé côté code, en attente de l'essai réel ».

### T057 — `SERVICES-EXTERNES.md`

Par service (Wave, PayDunya, Stripe, Secrets Manager, KMS, S3) : identifiants et clés à poser, où (coffre, nom du
secret, forme JSON), adresse de notification à déclarer, commande d'essai, levée de la garde (D6). État : « adaptateur
conforme, à essayer ». Orange Money : « documentation non publique (portail Sonatel par compte) » inchangé.

### T058 — PRD, PROMPTS, garde de consignation

Report des limites dans `PRD.md` (§2.8) et `PROMPTS-A-ENVOYER.md` (12b-1 : état ; 12b : héritages). Étends
`consignation.spec.ts` aux OP et ADR nouveaux (même mécanisme que pour OP-N185 à OP-N198).

### T059 — Preuves et note

`preuves.md` : tableau critère → lot → test → commande → résultat (FR-001 à FR-016, NFR, C, SC), à partir des notes de
lane. `note-equipes.md` : ce qui change pour les équipes (PayDunya : notification en formulaire ; Stripe : événements
à déclarer ; aucune route nouvelle), et pour le porteur (étapes du `quickstart.md`).

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un écart de sécurité sans OP, ADR ou test de borne ; un OP levé sans preuve ; un libellé 12b qui efface un héritage
non livré ; un secret ou un identifiant réel dans la doc ; la garde de consignation non étendue.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
