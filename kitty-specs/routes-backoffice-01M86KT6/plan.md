# Implementation Plan: Routes serveur du back-office

**Branch**: `feat/routes-backoffice` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)
**Input**: Mission specification from `kitty-specs/routes-backoffice-01M86KT6/spec.md`

## Summary

Six familles d'ajouts côté serveur, sans écriture au grand livre : profil du personnel, rôles autorisés par opération
(`x-roles`), lecture des ventes, liste et classement des anomalies, recherche (bracelet, portefeuille, festivalier par
numéro), modèles de téléphone et niveau NFC des terminaux. Les lectures passent par des vues ou requêtes sous la RLS du
prestataire, le filtre de portée étant appliqué en requête ; les écritures (classement, modèles) par des fonctions de
la base. Une migration `0101`.

**Décisions du porteur (24/11/2026)** : research D1 (10 types classables), D2 (modèle déclaré par le terminal,
exception à C-001 pour deux requêtes), D3 (matrice échantillon pour `x-roles`), et l'alignement technique (D5, D6, D8).
**Validés explicitement par le porteur le 24/11/2026, avant `/spec-kitty.tasks`** : D4 (retrait du droit direct de
clore une anomalie, renforcement), D7 (audit de la recherche par numéro sans le numéro), D9 (table de plateforme des
modèles), D10 (aucun code d'erreur nouveau), et dans `contracts/backoffice-routes.md` : `x-roles` sur chaque opération
(forme (a)) et les ajouts facultatifs aux réponses des terminaux (A6).

## Technical Context

**Language/Version**: TypeScript 5.9 sur Node.js 22 (API NestJS 11), SQL PostgreSQL 17 (migrations `packages/ledger-sql`)
**Primary Dependencies**: NestJS, `pg`, gardes d'identité existantes (`identity/roles.guard.ts`, `scope-resolver.ts`), lecture de vente existante (`payments/payment-read.service.ts`), `ClaimHasher` (`kms/claim-hash.ts`), audit (`audit/audit.service.ts`) ; aucune dépendance nouvelle (`docs/08-pile-logicielle.md`, ADR-78)
**Storage**: PostgreSQL 17 : migration `0101` (colonnes de classement sur `anomaly`, table `phone_model`, colonnes `device.manufacturer`/`model`, vues `security_invoker`, fonctions `SECURITY DEFINER`, index de lecture des ventes)
**Testing**: Jest (unitaires et intégration sur base par lot `cashless_wpXX`), pgTAP (droits, fonctions, RLS), contrôle de stabilité du contrat (`check.mjs`, `contract-baseline.json`), matrice échantillon `x-roles`, gardes transverses
**Target Platform**: serveur Linux (AWS) ; appelé par le back-office web (mission 11) et, pour la recherche, par le superviseur
**Project Type**: monorepo (API, paquets partagés) ; aucune interface dans cette mission
**Performance Goals**: p95 < 500 ms côté serveur par page de liste ou recherche, événement de 200 000 ventes (NFR-001)
**Constraints**: contrat stable (ajouts seulement, soumis au porteur) ; aucun droit nouveau pour `cashless_app` (NFR-005) ; aucune donnée personnelle en clair dans les réponses (NFR-006) ; aucune écriture au grand livre (C-002)
**Scale/Scope**: ~11 opérations nouvelles, une extension sur 227 opérations, 4 ajouts facultatifs à des schémas existants, une migration, une ADR, un amendement de SPECIFICATION §12.2

## Charter Check

Charte Spec Kitty absente (`.kittify/charter/charter.yaml` introuvable) : section sautée. Règles appliquées à la place :
`CLAUDE.md` (règles 1 à 4 sur les écarts de sécurité), `docs/SPECIFICATION.md` §0.3 (priorité des sources), contrat
stable depuis le 05/11/2026, `docs/08-pile-logicielle.md`.

## Project Structure

### Documentation (this mission)

```
kitty-specs/routes-backoffice-01M86KT6/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/backoffice-routes.md
└── tasks.md (créé par /spec-kitty.tasks)
```

### Source Code (repository root)

```
packages/ledger-sql/migrations/0101_backoffice_reads.sql        # classement, phone_model, device model, vues, index
packages/ledger-sql/tests/tests_backoffice_reads.sql            # pgTAP : droits, fonctions, RLS
packages/contracts/openapi.yaml                                  # A1 à A6 (après accord), x-roles
tools/contract-stability/contract-baseline.json                  # ajouts déclarés
tools/contract-stability/x-roles/                                # script de production des x-roles et des entrées
apps/api/src/staff-profile/                                      # GET /staff/me
apps/api/src/sales/                                              # liste et détail des ventes
apps/api/src/anomalies/                                          # liste et classement
apps/api/src/search/                                             # bracelet, portefeuille, numéro
apps/api/src/devices/phone-models/                               # modèles, niveau NFC
apps/api/src/devices/enrollment/, apps/api/src/devices/heartbeat # device_model facultatif
apps/api/test/integration/backoffice/*.spec.ts                   # parcours, cloisonnement, minimisation
apps/api/test/integration/end-to-end/x-roles-matrix.spec.ts      # D3
docs/SPECIFICATION.md §12.2, §15 ; docs/DECISIONS_ADR.md ; docs/POINTS_OUVERTS.md
```

**Structure Decision**: un module par famille de routes, à côté des modules existants ; les lectures de vente
réutilisent les jointures de `payment-read.service.ts` (commerçant par participation) au lieu de les recopier.

## Complexity Tracking

Aucune violation. Points d'attention :
- `x-roles` sur 227 opérations : produit par un script à partir d'un tableau relu à la main, opération par opération,
  contre le code ; la matrice échantillon attrape les dérives, pas les rôles « oubliés mais refusés à juste titre ».
- La portée du commerçant passe par le compte `MERCHANT` du posting : la requête de liste doit rester indexée.

## Implementation Concern Map

### IC-01 — Base : classement, modèles, terminal, vues de lecture

- **Purpose**: porter dans la base les règles qui ne doivent pas dépendre de l'API (types classables, droits, RLS).
- **Relevant requirements**: FR-009, FR-010, FR-015, FR-016, FR-017, NFR-001, NFR-003, NFR-005, C-002, C-005
- **Affected surfaces**: migration `0101` (colonnes de classement, `classify_anomaly`, `phone_model` et ses fonctions,
  `device.manufacturer`/`model`, nouvelles versions des fonctions d'enrôlement et de signal de vie, vues
  `sale_overview`/`anomaly_overview`, index), pgTAP.
- **Sequencing/depends-on**: none
- **Risks**: retrait du droit `UPDATE` sur `anomaly` : vérifier d'abord qu'aucun code ne l'utilise (D4) ; index de
  lecture des ventes mesuré sur 200 000 lignes.

### IC-02 — Contrat et `x-roles`

- **Purpose**: déclarer les ajouts A1 à A6 et les rôles de chaque opération.
- **Relevant requirements**: FR-003, FR-004, C-001
- **Affected surfaces**: `openapi.yaml`, types générés TS et Dart, `contract-baseline.json`, script `x-roles`, test de
  gel des ajouts, matrice échantillon.
- **Sequencing/depends-on**: accord du porteur sur `contracts/backoffice-routes.md`
- **Risks**: rôle déclaré faux pour une opération contrôlée en service ; la matrice le révèle seulement si le rôle
  choisi pour l'échantillon tombe dessus.

### IC-03 — Profil du personnel

- **Purpose**: `GET /staff/me`.
- **Relevant requirements**: FR-001, FR-002, NFR-006
- **Affected surfaces**: module `staff-profile`, lecture des attributions de `principal`.
- **Sequencing/depends-on**: IC-02
- **Risks**: aucun.

### IC-04 — Ventes

- **Purpose**: liste filtrée et paginée, détail d'une vente.
- **Relevant requirements**: FR-005, FR-006, FR-007, FR-017, NFR-001, NFR-002, NFR-003, NFR-006
- **Affected surfaces**: module `sales`, vue `sale_overview`.
- **Sequencing/depends-on**: IC-01, IC-02
- **Risks**: portée du commerçant appliquée en requête (D6) ; vente hors ligne datée à son origine.

### IC-05 — Anomalies

- **Purpose**: liste filtrée, classement sans écriture.
- **Relevant requirements**: FR-008, FR-009, FR-010, FR-017, FR-018, C-002
- **Affected surfaces**: module `anomalies`, `classify_anomaly`, audit `ANOMALY_CLASSIFIED`.
- **Sequencing/depends-on**: IC-01, IC-02
- **Risks**: deux classements simultanés : verrou de ligne dans la fonction, un seul gagne (409 pour l'autre).

### IC-06 — Recherche

- **Purpose**: bracelet par UID ou code imprimé, portefeuille, festivalier par numéro exact.
- **Relevant requirements**: FR-011 à FR-014, FR-017, FR-018, NFR-004, NFR-006
- **Affected surfaces**: module `search`, `ClaimHasher`, audit `STAFF_CUSTOMER_SEARCH`, limite de débit (D8).
- **Sequencing/depends-on**: IC-02
- **Risks**: numéro jamais dans une URL ni un journal (POST) ; masque appliqué côté serveur ; bracelet réattribué non
  retrouvé par l'ancien code.

### IC-07 — Modèles de téléphone et terminaux

- **Purpose**: liste tenue par la plateforme, niveau sur la fiche et la liste des terminaux.
- **Relevant requirements**: FR-015, FR-016, C-003
- **Affected surfaces**: module `devices/phone-models`, enrôlement et signal de vie (`device_model` facultatif),
  `listDevices`/`getDevice` (`nfc_level`), matrice d'authentification des terminaux.
- **Sequencing/depends-on**: IC-01, IC-02
- **Risks**: aucun refus d'enrôlement (C-003) ; valeur déclarée par le terminal, donc informative.

### IC-08 — Preuves et consignation

- **Purpose**: tenir la documentation normative et la dette.
- **Relevant requirements**: C-004, C-005, FR-018
- **Affected surfaces**: SPECIFICATION §12.2 (23 types, contradiction signalée), §15 (modèles), ADR, OP-N170 levé,
  points ouverts nouveaux (résolutions d'anomalie qui écrivent de l'argent, reportées), `PRD.md`,
  `PROMPTS-A-ENVOYER.md`, gardes transverses complétées.
- **Sequencing/depends-on**: IC-03 à IC-07
- **Risks**: oubli d'une route dans une matrice transverse (leçon de la 9c) : chaque lot ajoute ses routes aux matrices
  qu'il touche.
