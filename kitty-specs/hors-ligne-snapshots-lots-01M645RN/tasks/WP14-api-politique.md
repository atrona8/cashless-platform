---
work_package_id: WP14
title: 'API : politique hors ligne (plafond du prestataire, trois portées, risque)'
dependencies: [WP01, WP02, WP08]
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-043
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T057, T058, T059]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/policy/
create_intent: [apps/api/src/offline/policy/offline-policy.module.ts, apps/api/src/offline/policy/offline-policy.controller.ts, apps/api/src/offline/policy/offline-policy.service.ts, apps/api/src/offline/policy/offline-policy.dto.ts, apps/api/test/integration/offline/policy.spec.ts, apps/api/test/integration/offline/policy-isolation.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/policy/**, apps/api/test/integration/offline/policy*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – API : politique hors ligne

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-001 à FR-005, FR-027,
FR-042, FR-043, NFR-009, NFR-010, NFR-014), `research.md` R-02, R-03 et R-30.2, `data-model.md`
(section `offline_policy`), `contracts/openapi-additions.md` (tableau des routes et schémas),
`contracts/interfaces.md` § 1 (CL045 à CL047), § 2 (fonctions), § 8 (audit) et § 10. Code de
référence : voir les renvois ci-dessous. Priorité des sources : SPECIFICATION §0.3 ; toute
contradiction est signalée, jamais tranchée en silence. Les `.sql` générés ne bougent pas.

## Objective

Exposer par l'API ce que WP02 a posé en base : le plafond du prestataire, la politique à trois
portées (organisation, événement, terminal) et le risque maximal d'un événement. L'API ne calcule
rien de métier : elle appelle les fonctions `set_offline_policy`, `clear_offline_policy`,
`offline_policy_level`, `offline_max_exposure` et `effective_offline_policy`, traduit leurs
SQLSTATE et audite. L'historique des politiques reste écrit par le déclencheur de la base (OP-N58).

## Périmètre et arbitrages

- Dans le lot : les onze `operationId` de `interfaces.md` § 10 (`getOfflineCeiling`,
  `setOfflineCeiling`, `get/set{Organizer,Event,Device}OfflinePolicy`, `getEventOfflineRisk`).
- Hors lot : les fonctions SQL (WP02), le contrat et les messages (WP01), les droits (WP08), la
  lecture de la politique servie au terminal (WP15), la plomberie `app.module.ts` (retouche hors carte).
- Décisions du porteur : aucune recharge espèces hors ligne (R-02) : `cash_topup_offline: true`
  est refusé en `422 VALIDATION_FAILED` à la couche DTO ET par la base (`CL047`) ; la réponse rend
  toujours `false`. L'historique n'est jamais écrit par l'API.
- Modèle de contrôleur et d'acteur : `cash-sessions/cash-deposit.controller.ts:16-48`
  (`@Idempotent({ scope: 'bo:', keyUuid: true })`, `TenantAccess.actor`) et
  `organization/tenant/tenant-access.ts:37-47`. Modèle de lecture :
  `cash-sessions/event-cash-sessions.controller.ts:12-35`.

## Subtasks

### T057 — Module et routes du plafond et des trois portées

- **But** : module `offline-policy` (`OfflinePolicyModule`, importé dans `app.module.ts` : retouche
  hors carte, une ligne de rapport), contrôleur, service, DTO.
- **Rôles** (`openapi-additions.md`) : plafond : écriture `OPERATOR_ADMIN`, lecture `OPERATOR_ADMIN`
  et `ORGANIZER_ADMIN` du prestataire ; organisation, événement, terminal : écriture
  `ORGANIZER_ADMIN`, lecture `ORGANIZER_ADMIN` et `OPERATOR_ADMIN` ; `OPERATOR_ADMIN` peut en plus
  couper un terminal (`offline_enabled: false` seul sur la portée `DEVICE`, rien d'autre).
  Rôle absent : `403`. Objet hors périmètre : `404` neutre (jamais `403`, jamais un message qui
  dit si l'objet existe ailleurs).
- **Périmètre lu en base** (sous la transaction du prestataire, RLS) : événement -> organisateur,
  terminal -> événement -> organisateur. Un `ORGANIZER_ADMIN` dont l'organisateur n'est pas celui de
  l'objet reçoit `404`. N'utilise pas `assertOrganizerScope` (`tenant-access.ts:75-81`) : il lève
  `403`, le contrat veut `404`. Le corps ne porte jamais l'identifiant de portée : il vient du chemin.
- **`PUT`** : corps `OfflinePolicyLevel` (six champs facultatifs, nul ou absent = hérite) plus
  `version` attendue (`null` ou absente = création). Appel `set_offline_policy(scope_type, scope_id,
  values, expected_version, actor)`. Corps sans aucun champ de politique : `clear_offline_policy`
  (niveau effacé). Traduction des SQLSTATE par `errors/sqlstate-map.ts` (WP01) : `CL045` -> `404`,
  `CL046` -> `409 CONFLICT_STATE`, `CL047` -> `422`. Champ inconnu : `422` (liste fermée).
  `Idempotency-Key` UUID obligatoire (`keyUuid: true`).
- **`GET`** : `offline_policy_level` ; niveau absent : `200` avec `policy` vide et `version: 0`
  si le contrat WP01 le dit, sinon `404` (lis le schéma, ne devine pas).
- **Critère** : les 11 routes répondent comme le contrat ; un `PUT` rejoué (même clé) rend la même
  réponse sans second appel de `set_offline_policy` (compteur de `version` inchangé).

### T058 — `getEventOfflineRisk` et risque dans la réponse des `PUT`

- **But** : `GET /events/{event_id}/offline-risk` rend `OfflineRisk {event_id, currency,
  max_total_risk, offline_devices, devices[{device_id, serial, max_total_per_device, capped}],
  computed_at}` à partir de `offline_max_exposure(p_event)` (`interfaces.md` § 2).
- **Étapes** : somme des `max_total_per_device` en `bigint` (jamais `Number` avant la somme) ;
  conversion finale vers un nombre JSON avec contrôle `Number.isSafeInteger` (sinon `500` interne
  journalisé, pas de valeur arrondie) ; `offline_devices` = nombre de lignes ; `currency` lue sur
  l'événement ; `computed_at` = heure de la base (`clock_timestamp()`), pas celle de Node.
- La réponse d'un `PUT` sur la portée `EVENT` porte `risk` ; sur la portée `DEVICE`, `effective` =
  `effective_offline_policy(device)` (`capped` ne concerne que les trois montants, contrat WP01).
- **Cas limites** : événement sans terminal éligible : `max_total_risk: 0`, `devices: []` ; terminal
  plafonné : `capped: true` rendu tel quel ; événement d'un autre prestataire : `404`.
- **Critère** : le risque d'un événement de test égale la somme attendue calculée à la main ;
  `capped` vrai quand le plafond du prestataire borne la valeur de l'organisateur.

### T059 — Audit, tests d'intégration et d'isolation

- **Audit** : `OFFLINE_POLICY_SET` et `OFFLINE_POLICY_CLEARED` ajoutés en fin de l'union
  `AuditAction` (`audit/audit.service.ts:8-107`, une ligne chacune, retouche hors carte). Écrits avec
  le client de la transaction du `PUT` (`AuditService.record`, `audit.service.ts:144-166`) :
  `objectType: 'offline_policy'`, `before`/`after` = valeurs de politique et version, aucun secret.
  Un `PUT` refusé (`404`, `409`, `422`) n'écrit pas d'audit de succès.
- **`policy.spec.ts`** (HTTPS non requis, comme `cash-sessions`) : parcours des trois portées et du
  plafond ; héritage (champ vide hérite) ; plafond du prestataire qui borne (`capped`) ; version
  attendue fausse -> `409` ; `cash_topup_offline: true` à chaque portée -> `422` et ligne inchangée ;
  `OPERATOR_ADMIN` coupe un terminal mais ne change pas ses montants (`403`) ; audit présent ;
  l'historique contient une ligne par modification SANS que l'API l'ait écrite (la ligne vient du
  déclencheur : vérifie qu'un `UPDATE` direct par le propriétaire en écrit aussi une).
- **`policy-isolation.spec.ts`** : chaque route nouvelle appelée par une personne du prestataire B
  (et par un `ORGANIZER_ADMIN` d'un autre organisateur du même prestataire) sur les objets de A :
  jamais `2xx`, `404` ; sans jeton `401`. Les routes sont lues dans `openapi.yaml`, jamais listées
  en dur (modèle : `test/integration/end-to-end/isolation-sweep.spec.ts:21-40`) ; une route du
  contrat sans cas fait échouer le test.
- **Critère** : `npx jest apps/api/test/integration/offline/policy` vert sur la base du lot.

## Sécurité

- Écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté) : le dire au porteur
  AVANT de coder, avec risque et options (règle 1 de `CLAUDE.md`). Rien n'est prévu ici.
- Points sensibles : `404` neutre (pas d'oracle d'existence) ; la portée vient du chemin et de la
  base, jamais du corps ; l'API ne touche jamais `offline_policy_history` ; aucune écriture directe
  en SQL sur `offline_policy` (la fonction seule) ; `cash_topup_offline` ne peut jamais être vrai.
- Aucun fichier de ce lot n'exige une relecture humaine particulière.

## Tests

- Suites : `policy.spec.ts` et `policy-isolation.spec.ts` seulement. `test/unit/offline/` est à
  WP17 : pas de test unitaire du DTO là ; couvre-le dans `policy.spec.ts`.
- Base de lot `cashless_wp14` (voir la fiche d'implémentation). Commande :
  `DATABASE_URL=... npm test -w @cashless/api -- offline/policy`. Le lot ne lance pas Jest sur
  `cashless_test` ; l'orchestrateur relance en série.

## Ce que le relecteur doit casser

1. `PUT` avec `cash_topup_offline: true` à chacune des quatre portées : jamais accepté.
2. `ORGANIZER_ADMIN` de l'organisateur B sur l'événement de A (même prestataire) : `404`, pas `403`.
3. Même `Idempotency-Key`, corps différent : refus d'idempotence, aucune écriture.
4. Deux `PUT` concurrents avec la même version attendue : un seul gagne, l'autre `409`.
5. `OPERATOR_ADMIN` qui tente de monter un plafond de terminal : `403`.
6. Valeur énorme (`max_total_per_device` = 2^60) : somme du risque sans perte de précision, ou
   refus net, jamais un nombre arrondi.
7. Terminal d'un autre prestataire cité par son identifiant : `404`.
8. Audit présent pour chaque succès, absent pour chaque refus.

## Definition of Done

- [ ] Les 11 routes servies, conformes à `openapi.yaml` (test de balayage vert).
- [ ] Aucune écriture SQL directe sur `offline_policy` ni `offline_policy_history` dans `src/`.
- [ ] Audit `OFFLINE_POLICY_SET`/`CLEARED` dans la transaction du `PUT`.
- [ ] Tests d'intégration et d'isolation verts sur `cashless_wp14`.
- [ ] Rapport : retouches hors carte (`app.module.ts`, `audit.service.ts`), contradictions relevées.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP01, WP02, WP08.
Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP14
--agent claude --mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
