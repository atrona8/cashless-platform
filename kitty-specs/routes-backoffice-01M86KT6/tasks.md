# Tasks — Routes serveur du back-office (mission 11b)

Mission `routes-backoffice-01M86KT6`, planification et fusion sur `feat/routes-backoffice`.
Références : `spec.md`, `plan.md` (IC-01 à IC-08), `interfaces.md` (fait foi sur les noms, signatures et
propriétaires), `data-model.md`, `research.md` (D1 à D10, validées par le porteur le 24/11/2026),
`contracts/backoffice-routes.md`, fiche commune `docs/passation-11b/fiche-implementation.md`.

Les lignes `Txxx` sont des références ; l'avancement s'enregistre par `spec-kitty agent tasks mark-status`.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Colonnes de classement d'`anomaly`, `anomaly_classifiable`, `classify_anomaly` | WP01 | |
| T002 | Droit direct de clore une anomalie : preuve d'usage puis retrait (ou garde) | WP01 | |
| T003 | Table `phone_model`, normalisation, `upsert_phone_model` / `delete_phone_model` | WP01 | [P] |
| T004 | Colonnes `device.manufacturer` / `model` et leur chemin d'écriture sans droit nouveau | WP01 | |
| T005 | Index de la limite de débit sur `audit_log` ; pgTAP `tests_backoffice_writes.sql` | WP01 | |
| T006 | Vue `sale_overview` (commerçant, point de vente, vendeur, origine, annulation) | WP02 | |
| T007 | Vue `anomaly_overview` | WP02 | [P] |
| T008 | Index et mesure sur 200 000 ventes (EXPLAIN, p95) | WP02 | |
| T009 | pgTAP `tests_backoffice_read_views.sql` (RLS, `security_invoker`, aucun droit nouveau) | WP02 | |
| T010 | Opérations et schémas A1, A3, A4, A5 dans `openapi.yaml` | WP03 | |
| T011 | A6 : opérations des modèles, `device_model` / `nfc_level` facultatifs | WP03 | |
| T012 | `contract-baseline.json` (décision du porteur du 24/11/2026) et test de gel | WP03 | |
| T013 | Types générés TypeScript et Dart, contrôle de stabilité | WP03 | |
| T014 | Table relue `x-roles/roles.json` : rôles et source de chaque opération | WP04 | |
| T015 | `x-roles/apply.mjs` : annotation du contrat et entrées de référence | WP04 | |
| T016 | Garde : toute opération porte `x-roles`, valeurs dans la liste fermée | WP04 | |
| T017 | Actions d'audit de la mission | WP05 | |
| T018 | `GET /staff/me` (module, service, inscription dans `IdentityModule`) | WP05 | |
| T019 | Tests du profil (deux attributions, aucun rôle, refus festivalier et terminal) | WP05 | |
| T020 | Balayage `backoffice-isolation.spec.ts`, registre, liste `MISSION_11B_OPERATIONS`, exclusion dans `media-isolation` | WP05 | |
| T021 | `listEventSales` : filtres, portée, pagination | WP06 | |
| T022 | `getSale` : lignes, origine, annulation | WP06 | |
| T023 | Tests : filtres, pagination sans doublon, commerçant, autre prestataire, minimisation | WP06 | |
| T024 | Cas d'isolement et mesure de latence (200 000 ventes) | WP06 | |
| T025 | `listAnomalies` : filtres, portée, `classifiable` | WP07 | |
| T026 | `classifyAnomaly` : fonction de la base, codes, audit, idempotence | WP07 | |
| T027 | Tests : classement, refus, concurrence, grand livre inchangé, droit direct retiré | WP07 | |
| T028 | Cas d'isolement | WP07 | [P] |
| T029 | `searchMedia` (UID, code imprimé) | WP08 | |
| T030 | `getWalletOverview` | WP08 | [P] |
| T031 | `searchCustomerByPhone` : exact, masque, audit sans numéro | WP08 | |
| T032 | Limite de débit et refus audités | WP08 | |
| T033 | Tests et cas d'isolement (rôles, préfixe, autre prestataire, bracelet réattribué, aucun numéro en clair) | WP08 | |
| T034 | `listPhoneModels`, `upsertPhoneModel`, `deletePhoneModel` | WP09 | |
| T035 | `device_model` à l'enrôlement et au signal de vie | WP09 | |
| T036 | `nfc_level` et `device_model` dans `listDevices` / `getDevice` | WP09 | |
| T037 | Tests (signalement, aucun refus d'enrôlement, droits plateforme) et cas d'isolement | WP09 | |
| T038 | Cas de la matrice `x-roles` par domaine | WP10 | |
| T039 | `x-roles-matrix.spec.ts` et mutation prouvée | WP10 | |
| T040 | Lancement en série (CI, `SKIP_LATENCY`) | WP10 | |
| T041 | `SPECIFICATION.md` §12.2 (23 types, classement), §15 (modèles) | WP11 | [P] |
| T042 | ADR-235, ADR-236, OP-N170 levé, points ouverts nouveaux | WP11 | |
| T043 | Reports `PRD.md`, `PROMPTS-A-ENVOYER.md`, note aux équipes clientes | WP11 | |
| T044 | `docs/passation-11b/preuves.md` | WP11 | |

## Phase 1 — Fondations

### WP01 — Base : classement des anomalies, modèles de téléphone, modèle du terminal ([WP01-base-ecritures.md](tasks/WP01-base-ecritures.md))

- **Goal**: poser dans la base les règles d'écriture de la mission (types classables, droit direct retiré, modèles).
- **Priority**: P1. **Independent test**: `pg_prove tests/tests_backoffice_writes.sql` vert, `tests_execute_grants.sql` vert.
- **Subtasks**:
  T001 Colonnes de classement d'`anomaly`, `anomaly_classifiable`, `classify_anomaly` (WP01)
  T002 Droit direct de clore une anomalie : preuve d'usage puis retrait (ou garde) (WP01)
  T003 Table `phone_model`, normalisation, fonctions d'écriture (WP01)
  T004 Colonnes `device.manufacturer` / `model` et chemin d'écriture sans droit nouveau (WP01)
  T005 Index de la limite de débit ; pgTAP (WP01)
- **Dependencies**: none.
- **Risks**: D4 (retrait d'un droit utilisé) : prouver l'absence d'usage avant ; les fonctions `waive_seq_gap`, PSP et
  hors ligne qui clôturent par fonction restent valides.

### WP02 — Base : vues de lecture des ventes et des anomalies ([WP02-base-vues-lecture.md](tasks/WP02-base-vues-lecture.md))

- **Goal**: lectures sous RLS, sans droit nouveau, indexées pour 200 000 ventes.
- **Priority**: P1. **Independent test**: `pg_prove tests/tests_backoffice_read_views.sql` vert ; EXPLAIN noté.
- **Subtasks**:
  T006 Vue `sale_overview` (WP02)
  T007 Vue `anomaly_overview` (WP02)
  T008 Index et mesure sur 200 000 ventes (WP02)
  T009 pgTAP (WP02)
- **Dependencies**: WP01 (colonnes de classement, `anomaly_classifiable`).
- **Risks**: commerçant par le compte `MERCHANT` du posting : jointure coûteuse sans index adapté.

### WP03 — Contrat : opérations et schémas de la mission ([WP03-contrat.md](tasks/WP03-contrat.md))

- **Goal**: déclarer A1, A3 à A6 de `contracts/backoffice-routes.md`, et seulement eux.
- **Priority**: P1. **Independent test**: `node tools/contract-stability/check.mjs` 0 refus ; `npm run check -w @cashless/contracts` vert.
- **Subtasks**:
  T010 Opérations et schémas A1, A3, A4, A5 (WP03)
  T011 A6 (WP03)
  T012 Référence de stabilité et test de gel (WP03)
  T013 Types générés (WP03)
- **Dependencies**: none.
- **Risks**: un ajout non déclaré dans la référence fait échouer la CI (PR #18) ; décrire les codes existants seulement (D10).

### WP04 — Contrat : rôles autorisés `x-roles` sur chaque opération ([WP04-x-roles.md](tasks/WP04-x-roles.md))

- **Goal**: chaque opération du contrat porte ses rôles, relus contre le code.
- **Priority**: P2. **Independent test**: `check.mjs` 0 refus ; la garde T016 échoue si une opération perd `x-roles`.
- **Subtasks**:
  T014 Table relue `roles.json` (WP04)
  T015 `apply.mjs` (WP04)
  T016 Garde de présence et de valeurs (WP04)
- **Dependencies**: WP03 (retouche hors carte de `openapi.yaml`, `contract-baseline.json`, même lane).
- **Risks**: rôles déduits d'un contrôle en service : citer fichier:ligne pour chacun ; le doute se note, ne se devine pas.

### WP05 — Socle API : audit, profil du personnel, balayage d'isolement ([WP05-socle-profil.md](tasks/WP05-socle-profil.md))

- **Goal**: ce dont les lots de routes ont besoin avant de commencer, plus `GET /staff/me`.
- **Priority**: P1. **Independent test**: `staff-profile.spec.ts` et `backoffice-isolation.spec.ts` (cas du profil) verts.
- **Subtasks**:
  T017 Actions d'audit (WP05)
  T018 `GET /staff/me` (WP05)
  T019 Tests du profil (WP05)
  T020 Balayage d'isolement de la mission (WP05)
- **Dependencies**: WP03.
- **Risks**: le balayage doit échouer pour une opération de la mission sans cas : le prouver par mutation.

## Phase 2 — Routes

### WP06 — Ventes ([WP06-ventes.md](tasks/WP06-ventes.md))

- **Goal**: lister et lire les ventes d'un événement dans la portée.
- **Priority**: P1. **Independent test**: `sales*.spec.ts` verts ; p95 < 500 ms sur 200 000 ventes.
- **Subtasks**: T021, T022, T023, T024 (WP06)
- **Dependencies**: WP02, WP03, WP05.
- **Risks**: portée du commerçant en requête (D6) ; aucune donnée du festivalier.

### WP07 — Anomalies ([WP07-anomalies.md](tasks/WP07-anomalies.md))

- **Goal**: lister et classer, sans écriture au grand livre.
- **Priority**: P1. **Independent test**: `anomalies*.spec.ts` verts ; nombre de `journal_transaction` inchangé.
- **Subtasks**: T025, T026, T027, T028 (WP07)
- **Dependencies**: WP01, WP02, WP03, WP05.
- **Risks**: deux classements simultanés ; inscription dans `AppModule` (seul lot à toucher ce fichier).

### WP08 — Recherche ([WP08-recherche.md](tasks/WP08-recherche.md))

- **Goal**: retrouver un bracelet, un portefeuille ou un festivalier, sans exposer le numéro.
- **Priority**: P2. **Independent test**: `search*.spec.ts` verts ; aucune ligne d'audit ne contient le numéro.
- **Subtasks**: T029, T030, T031, T032, T033 (WP08)
- **Dependencies**: WP01 (index de débit), WP03, WP05.
- **Risks**: numéro dans une URL ou un journal ; recherche partielle ; débit compté en mémoire (refusé : en base).

### WP09 — Modèles de téléphone et terminaux ([WP09-modeles-terminaux.md](tasks/WP09-modeles-terminaux.md))

- **Goal**: liste des modèles tenue par la plateforme, niveau NFC sur les terminaux, modèle déclaré par le terminal.
- **Priority**: P3. **Independent test**: `phone-models*.spec.ts` verts ; `device-auth-matrix.spec.ts` vert.
- **Subtasks**: T034, T035, T036, T037 (WP09)
- **Dependencies**: WP01, WP03, WP05.
- **Risks**: aucun refus d'enrôlement (C-003) ; aucun droit de colonne nouveau sur `device`.

## Phase 3 — Preuves transverses et consignation

### WP10 — Matrice `x-roles` ([WP10-matrice-x-roles.md](tasks/WP10-matrice-x-roles.md))

- **Goal**: prouver que les rôles déclarés sont fidèles aux contrôles réels (D3).
- **Priority**: P2. **Independent test**: `x-roles-matrix.spec.ts` vert ; une mutation d'un contrôle le fait échouer.
- **Subtasks**: T038, T039, T040 (WP10)
- **Dependencies**: WP04, WP06, WP07, WP08, WP09.
- **Risks**: suite longue (≈ 470 appels) : en série, hors passe parallèle.

### WP11 — Spécification, ADR et consignation ([WP11-consignation.md](tasks/WP11-consignation.md))

- **Goal**: documentation normative juste, dette nommée, OP-N170 levé.
- **Priority**: P2. **Independent test**: `consignation.spec.ts` vert ; chaque test cité existe.
- **Subtasks**: T041, T042, T043, T044 (WP11)
- **Dependencies**: WP06, WP07, WP08, WP09, WP10.
- **Risks**: chiffres sans source dans les preuves (renvoi de WP06 en 9c) : chaque nombre cite sa commande.

## Parallélisme

Phase 1 : WP01 et WP03 en parallèle ; WP02 après WP01 ; WP04 et WP05 après WP03. Phase 2 : WP06 à WP09 en parallèle
dès leurs dépendances approuvées. Phase 3 : WP10 puis WP11. MVP : WP01 + WP03 + WP05 + WP06 (profil et ventes).
