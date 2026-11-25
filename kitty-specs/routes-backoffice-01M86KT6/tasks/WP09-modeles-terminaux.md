---
work_package_id: WP09
title: Modèles de téléphone et terminaux
dependencies: [WP01, WP03, WP05]
requirement_refs:
- FR-015
- FR-016
- FR-017
- FR-018
- NFR-003
- NFR-005
- C-003
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-routes-backoffice-01M86KT6
base_commit: 8b2d8c483ec92f2eef984ed13d3c5aab1ac930b8
created_at: '2026-11-25T09:56:31.788454+00:00'
subtasks: [T034, T035, T036, T037]
phase: Phase 2 - Routes
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/devices/phone-models/
create_intent:
- apps/api/src/devices/phone-models/phone-models.controller.ts
- apps/api/src/devices/phone-models/phone-models.service.ts
- apps/api/src/devices/phone-models/phone-models.dto.ts
- apps/api/src/devices/phone-models/nfc-level.ts
- apps/api/src/devices/phone-models/phone-models.module.ts
- apps/api/test/integration/backoffice/phone-models.spec.ts
- apps/api/test/integration/backoffice/phone-models-devices.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/phone-models.cases.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/devices/phone-models/**
- apps/api/src/devices/devices.module.ts
- apps/api/src/devices/enrollment/enrollment.dto.ts
- apps/api/src/devices/enrollment/enrollment.service.ts
- apps/api/src/devices/heartbeat/heartbeat.dto.ts
- apps/api/src/devices/heartbeat/heartbeat.controller.ts
- apps/api/src/devices/admin/device-admin.dto.ts
- apps/api/src/devices/admin/device-admin.service.ts
- apps/api/test/integration/backoffice/phone-models*.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/phone-models.cases.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 : Modèles de téléphone et terminaux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` §1, §2 (WP01 : `phone_model`, `upsert_phone_model`, `delete_phone_model`, `normalize_phone_model`,
  colonnes `device.manufacturer`/`model`, `set_device_model`), §3 (A6, rôles), §4 (`nfcLevelFor`, audit) ; `research.md`
  D2, D9 ; `contracts/backoffice-routes.md` A6 ; **la migration `0101` telle que fusionnée** et la note de lane de WP01
  (elle dit si l'enrôlement et le signal de vie passent par de nouvelles versions de `enroll_device` et
  `record_device_heartbeat` ou par `set_device_model`) ;
- à modifier : `apps/api/src/devices/enrollment/enrollment.dto.ts` et `enrollment.service.ts` (l. 160-200 : appel à
  `enroll_device` à 15 paramètres), `heartbeat/heartbeat.dto.ts` (`parseHeartbeat`) et `heartbeat.controller.ts` (appel à
  `record_device_heartbeat`), `admin/device-admin.dto.ts` (`DEVICE_ADMIN_COLUMNS`, ligne de liste et de fiche) et
  `admin/device-admin.service.ts`, `devices/devices.module.ts` ;
- accès de plateforme : `apps/api/src/organization/platform/platform-access.ts` (`PlatformAccess.platform(req)`,
  `reader(req, rôles)`) et `platform.module.ts` ; `apps/api/test/unit/architecture.spec.ts` l. 47-60 (qui peut importer
  `PlatformTx`) ; `apps/api/src/idempotency/platform-person.ts` ;
- `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` et `device-auth-cases/registry.ts` ; `test/support/fake-device.ts`.

## Objective

La liste des modèles de téléphone tenue par la plateforme (3 routes), le modèle déclaré par le terminal à
l'enrôlement et au signal de vie (facultatif, jamais un refus : C-003), et le niveau NFC calculé sur la fiche et la liste
des terminaux.

## Subtasks

### T034 — `listPhoneModels`, `upsertPhoneModel`, `deletePhoneModel`

1. `PhoneModelsModule` (contrôleur, service, dto, `nfc-level.ts`), importé par `DevicesModule` (`devices.module.ts`, une
   ligne).
2. **Contrainte d'architecture** : `architecture.spec.ts` n'autorise `PlatformTx` que sous `db/`, `idempotency/`,
   `approval/`, `organization/platform/` et deux familles de `configuration/`. `devices/phone-models/` n'en fait pas
   partie, et le test n'est pas dans ta carte. **N'importe donc pas `PlatformTx`** : passe par `PlatformAccess`
   (`organization/platform/platform-access.ts`, exporté par `PlatformModule`) : `access.platform(req)` pour les écritures
   (`PLATFORM_ADMIN` seul, sinon `403`), `access.reader(req, ['OPERATOR_ADMIN','ORGANIZER_ADMIN'])` pour la lecture. Si
   cela ne suffit pas, signale-le dans la note de lane (contradiction avec `interfaces.md` §1) au lieu d'élargir le test.
3. Écriture : `SELECT * FROM upsert_phone_model($1,$2,$3,$4,$5)` / `delete_phone_model($1,$2,$3)` avec l'identifiant de
   l'acteur ; **aucun `INSERT`/`UPDATE` direct sur `phone_model`**. Chemin : `/phone-models/{manufacturer}/{model}`, les
   deux segments décodés puis normalisés par `normalize_phone_model` côté base (`samsung/galaxy a15` et `Samsung/Galaxy  A15`
   désignent la même ligne) ; 1 à 100 caractères, sinon `422`. `PUT` : corps `{ nfc_level: RECOMMENDED|TOLERATED,
   measured_at }` (date, pas dans le futur) ; `DELETE` d'un modèle absent : `404`.
4. Audit `PHONE_MODEL_UPSERTED` / `PHONE_MODEL_DELETED` (auteur, fabricant, modèle, niveau), même transaction.
5. Lecture : `GET /phone-models`, pagination §4 (tri fabricant, modèle ; curseur opaque, `limit` 1..200).
6. `nfcLevelFor(manufacturer?, model?)` (§4) : normalise comme la base, `RECOMMENDED`/`TOLERATED` si la paire est dans
   `phone_model`, sinon `UNTESTED` (aussi quand fabricant ou modèle manque). Le calcul se fait en SQL (jointure) pour les
   listes ; la fonction TypeScript sert aux cas unitaires et ne duplique pas la règle de normalisation : appelle
   `normalize_phone_model` ou teste l'égalité avec la base.
7. Mutation : écriture directe au lieu de la fonction (test de droits échoue) ; `OPERATOR_ADMIN` autorisé à `PUT` (le test
   de refus échoue).

### T035 — `device_model` à l'enrôlement et au signal de vie

1. `DeviceEnrollmentRequest` et `HeartbeatRequest` : propriété facultative `device_model { manufacturer, model }`
   (`enrollment.dto.ts`, `heartbeat.dto.ts`). Absente : comportement inchangé, octet pour octet.
2. **Jamais de refus** (C-003) : une valeur mal formée (type incorrect, vide, > 100 caractères) est **ignorée** (le
   terminal est enrôlé ou son signal enregistré sans modèle), jamais `4xx`. Un modèle absent de `phone_model` passe.
3. Écriture par le chemin choisi par WP01 (lis sa note) : nouvelle version de la fonction d'enrôlement et de signal de
   vie, ou appel à `set_device_model($1,$2,$3)` dans la même transaction. **Aucun `GRANT` ni droit de colonne**
   (`tests_execute_grants.sql` reste vert). Le modèle déclaré est informatif et non vérifié (limite à consigner en WP11).
4. Le signal de vie met à jour le modèle à chaque appel où il est fourni ; absent, il ne l'efface pas.
5. Mutation : refus d'une valeur invalide (le test « aucun refus » échoue).

### T036 — `nfc_level` et `device_model` dans `listDevices` / `getDevice`

`DeviceAdminDetail` et l'élément de `DevicePage` : `device_model` (si connu) et `nfc_level` (`RECOMMENDED`, `TOLERATED`,
`UNTESTED`). Ajoute `d.manufacturer, d.model` à `DEVICE_ADMIN_COLUMNS` (colonnes nommées une à une, règle du fichier) et la
jointure `phone_model` dans `device-admin.service.ts` ; la lecture reste sous la portée et la RLS existantes. Aucun
filtre ni tri nouveau. Les champs sont facultatifs dans le contrat : un terminal sans modèle porte `UNTESTED` et pas de
`device_model`. Mutation : jointure sans normalisation (`Galaxy A15` ne se retrouve plus : le test échoue).

### T037 — Tests et cas d'isolement

`phone-models.spec.ts` : recette n° 5 ; `PUT` puis `GET` ; remplacement par un second `PUT` ; `DELETE` ; tous les
rôles autres que `PLATFORM_ADMIN` refusés à l'écriture (`OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`) ;
`SUPERVISOR`, `CASHIER`, festivalier et terminal refusés à la lecture ; audit présent pour chaque écriture ;
`cashless_app` ne peut ni `INSERT` ni `UPDATE` ni `DELETE` sur `phone_model` (connexion directe) ; normalisation.
`phone-models-devices.spec.ts` : enrôlement avec et sans `device_model` (même réponse), avec valeur invalide, avec modèle
inconnu : toujours enrôlé ; signal de vie idem ; fiche et liste montrent `TOLERATED`, `RECOMMENDED`, `UNTESTED` ; un
organisateur ne voit que les terminaux de sa portée (inchangé) ; autre prestataire : `404`. `backoffice-isolation-cases/
phone-models.cases.ts` : un cas par opération (3), sans toucher `registry.ts` (§5) ; mutation : retirer un cas fait échouer
`backoffice-isolation.spec.ts`. Lance aussi `device-auth-matrix.spec.ts` (doit rester vert : les routes d'enrôlement et de
signal de vie changent de corps, pas d'authentification), `device-isolation.spec.ts` et `device-journey.spec.ts`.

## Retouches hors carte permises

Aucune. Si `device-admin.controller.ts` ou `enrollment.controller.ts` doivent changer (ils ne devraient pas), nomme-le
dans la note de lane : la carte les attribue à personne, aucun autre lot n'y touche.

## Definition of Done

- [ ] 3 routes conformes ; ajouts facultatifs seuls aux schémas existants ; aucun refus nouveau à l'enrôlement.
- [ ] `phone-models*.spec.ts`, `device-auth-matrix.spec.ts`, `backoffice-isolation.spec.ts`, `architecture.spec.ts`,
      `test/unit/contracts` verts ; `PlatformTx` non importée par ton dossier.
- [ ] Mutations notées (écriture directe, rôle, valeur invalide refusée, normalisation, cas retiré).

## Ce que le relecteur doit casser

- Un enrôlement ou un signal de vie refusé à cause du modèle (absent, inconnu, mal formé, énorme).
- Un `OPERATOR_ADMIN`/`ORGANIZER_ADMIN` qui écrit la liste ; une écriture de `phone_model` hors fonctions de la base.
- Un droit de colonne ou de table nouveau pour `cashless_app` (pgTAP de droits), ou `PlatformTx` importée hors des
  dossiers permis.
- Le modèle déclaré qui écrase un modèle existant avec du vide ; le niveau qui diffère selon la casse.
- Un terminal d'un autre prestataire visible avec son niveau.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP09 --agent claude --mission routes-backoffice-01M86KT6`
