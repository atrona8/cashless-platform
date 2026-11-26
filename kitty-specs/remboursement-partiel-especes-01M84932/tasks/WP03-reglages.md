---
work_package_id: WP03
title: 'Réglages : le prestataire autorise, l''organisateur active'
dependencies: [WP01, WP02]
requirement_refs:
- FR-004
- FR-005
- FR-013
- NFR-003
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
subtasks: [T008, T009, T010, T011]
phase: Phase 2 - Réglages et seuil
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/configuration/
create_intent:
- apps/api/test/integration/configuration/partial-refund-settings.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/configuration/settings-catalog.ts
- apps/api/src/configuration/bounds-validator.ts
- apps/api/src/events/events.dto.ts
- apps/api/src/events/events.service.ts
- apps/api/test/integration/configuration/partial-refund-settings.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Réglages — le prestataire autorise, l'organisateur active

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/remboursement-partiel-especes-01M84932/interfaces.md` (noms figés, règle croisée) et
  `research.md` D1 ;
- `apps/api/src/configuration/settings-catalog.ts` en entier (229 lignes : `column`, `setting`, `cappedBy`,
  `cash_refund_single_max` et `cash_refund_single_max_cap` sont tes modèles) ;
- `apps/api/src/configuration/bounds-validator.ts` l. 150-260 (cap d'un niveau supérieur, « Règles croisées ») ;
- `apps/api/src/configuration/cascade.service.ts` l. 150-200 (résolution des niveaux) ;
- `apps/api/src/events/events.dto.ts`, `events.service.ts` et `event-approval-actions.ts` (`EVENT_SETTINGS_CHANGE` en
  `LIVE`) : comment une colonne réglée par l'organisateur est lue, validée et modifiée ;
- `apps/api/test/integration/configuration/cascade.spec.ts` (« catalogue et schéma ») pour le style des tests.

## Objective

Exposer les deux réglages refusés par défaut : l'autorisation du prestataire (clé de cascade, niveau `OPERATOR`) et
l'activation par événement (colonne réglée par l'organisateur), avec la règle croisée qui empêche d'activer sans
autorisation. Rien d'autre (l'opération de rendu est en WP05).

## Subtasks

### T008 — Catalogue

1. `column('cash_partial_refund_enabled', <type booléen>, 'ORGANIZER_ADMIN', { default: false })` dans le bloc des
   réglages de l'organisateur. Si le catalogue n'a pas de type booléen, ajoute-le au type `SettingType`
   (`{ kind: 'boolean' }`) avec sa validation dans `typeViolation` : c'est la seule extension permise.
2. `setting('cash_partial_refund_allowed', ['OPERATOR'], <booléen>, 'OPERATOR_ADMIN', { default: false })` à côté de
   `cash_refund_single_max_cap`, avec un commentaire (décision du porteur du 23/11/2026).
3. Le test « catalogue et schéma » de `cascade.spec.ts` doit rester vert (il compare le catalogue au schéma d'`event`,
   colonne de WP01).

### T009 — Règle croisée `operator.cash_partial_refund_allowed`

Dans « Règles croisées » de `bounds-validator.ts` : si la modification met `cash_partial_refund_enabled` à `true` et
que la valeur résolue de `cash_partial_refund_allowed` (contexte `resolved`) n'est pas `true`, ajoute la violation
`{ field: 'cash_partial_refund_enabled', rule: 'operator.cash_partial_refund_allowed', requested: true, limit: false,
source: <niveau> }`. Passer à `false` est toujours permis. Mutation : retire la règle → T011 échoue.

### T010 — Événement : lecture et modification

1. La colonne apparaît dans la réponse `Event` (lecture) et est acceptée par `updateEvent` comme clé de
   l'`ORGANIZER_ADMIN` (clé d'un autre rôle : `403`, comme les autres).
2. En `LIVE`, la modification passe par l'opération à deux personnes existante (`EVENT_SETTINGS_CHANGE`) sans code
   nouveau : vérifie que la clé y est prise en charge (liste des clés, application à l'approbation) ; sinon, ajoute-la
   au même endroit que `cash_refund_single_max`.
3. Ligne d'audit existante (`EVENT_UPDATED`) : la clé y figure comme les autres.

### T011 — Tests `partial-refund-settings.spec.ts`

Cas à prouver (base `cashless_wp03`) :
- défauts : événement neuf → `cash_partial_refund_enabled = false` ; configuration résolue → `cash_partial_refund_allowed
  = false` ;
- l'organisateur active sans autorisation → `422 VALIDATION_FAILED`, violation `operator.cash_partial_refund_allowed` ;
- le prestataire autorise (version de configuration prestataire) puis l'organisateur active → `200`, valeur `true` ;
- un `OPERATOR_ADMIN` qui tente de régler `cash_partial_refund_enabled` → `403` ; un `ORGANIZER_ADMIN` qui tente
  `cash_partial_refund_allowed` → refus ;
- en `LIVE` : demande à deux personnes (`202`), approbation par une autre personne → appliquée ;
- isolation : un `OPERATOR_ADMIN` d'un autre prestataire ne voit ni ne modifie rien (NFR-003).

## Definition of Done

- [ ] Deux réglages au catalogue, défaut `false` ; règle croisée ; colonne lue et modifiable par l'organisateur.
- [ ] `partial-refund-settings.spec.ts` et `cascade.spec.ts` verts ; mutations notées (règle croisée, défaut).
- [ ] Aucune route ni schéma du contrat modifié par ce lot (WP02 s'en charge).

## Ce que le relecteur doit casser

- Activer sans autorisation par un chemin détourné (création d'événement, version de configuration organisateur,
  approbation `LIVE` d'une demande faite avant le retrait de l'autorisation).
- Un défaut `true` quelque part (catalogue, colonne, résolution).
- Une clé de cascade réglable à un niveau inférieur au prestataire (l'organisateur s'autoriserait lui-même).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission remboursement-partiel-especes-01M84932`
