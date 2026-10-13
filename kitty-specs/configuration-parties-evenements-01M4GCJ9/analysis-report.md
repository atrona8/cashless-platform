---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: configuration-parties-evenements-01M4GCJ9
mission_id: 01M4GCJ9223VETS7PV6G233HYT
generated_at: '2026-10-09T13:39:22.832973+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md
    sha256: 322230a769055d4a27f9dfb00fdf0ed7f3cb7d4c46cd3b36f4a03bab1896011f
  plan.md:
    path: kitty-specs/configuration-parties-evenements-01M4GCJ9/plan.md
    sha256: f0d812d2bd370453c0fba85b6d912ff90be4a44fff025be5631322e4a5e3e67f
  tasks.md:
    path: kitty-specs/configuration-parties-evenements-01M4GCJ9/tasks.md
    sha256: 9bb82dd7be569c44a888b7f83933bbfc1d535f4537add6660a3cf33106ff4745
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  critical: 0
  low: 2
  medium: 4
  high: 0
  info: 0
findings:
- id: U1
  severity: medium
  category: underspecification
  summary: "Rattachement d'un événement LIVE à une nouvelle version de profil de législation (cas limite de la spec) : la clé jurisdiction_id n'est pas rangée dans le catalogue des réglages (rôle, action à deux)."
- id: U2
  severity: medium
  category: underspecification
  summary: 'WP06 T024 laisse kyc_threshold du profil Sénégal « à préciser » : valeur provisoire à tirer de SPECIFICATION §6.3 ou à marquer explicitement absente.'
- id: C1
  severity: medium
  category: coverage
  summary: "WP12 rejoue le scénario sur une configuration construite par l'API, mais les comptes A-PSP-* et A-CAISSE-* (missions PSP et caisses) ne sont créés par aucune route : la fixture doit les poser en propriétaire, ce qui n'est pas écrit dans la fiche."
- id: I1
  severity: medium
  category: inconsistency
  summary: app.module.ts est possédé par WP07 mais modifié d'une ligne par WP08, WP09, WP12 (hors liste de propriété) ; risque de conflit atténué par la chaîne linéaire de dépendances, à surveiller au merge des lanes.
- id: L1
  severity: low
  category: inconsistency
  summary: 'plan.md annonce ~45 opérations ; contracts/openapi-additions.md en liste 46 (en comptant chaque méthode) : chiffre à recaler sur le contrat réel en WP04.'
- id: L2
  severity: low
  category: underspecification
  summary: "WP09 teste la modification à deux pendant LIVE avant l'existence de la route de statut (WP11) : passage LIVE par fixture propriétaire, à remplacer par la route en WP13."
---

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | MEDIUM | spec.md (Edge Cases) ; WP06 T023 ; WP09 T040 | `jurisdiction_id` d'un événement LIVE : ni rôle ni action définis | En WP06, ajouter `jurisdiction_id` au catalogue (`EVENT_COLUMN`, réglé par `OPERATOR_ADMIN`, donc `EVENT_OPERATOR_SETTINGS_CHANGE` pendant LIVE) |
| U2 | Underspecification | MEDIUM | WP06 T024 | `kyc_threshold` Sénégal « à préciser » | Lire §6.3 ; si aucune valeur, NULL et `provisional` avec `confirm_by: juriste` |
| C1 | Coverage | MEDIUM | WP12 T052 | Comptes A-PSP-*, A-CAISSE-* non créables par l'API | Fixture propriétaire pour ces comptes (comme portefeuilles et bracelets), documentée dans le test |
| I1 | Inconsistency | MEDIUM | WP07-WP12 (owned_files) | `app.module.ts` modifié hors propriété | Modification d'une ligne par WP, justifiée dans le commit ; lanes enchaînées |
| L1 | Inconsistency | LOW | plan.md (Scale/Scope) | Nombre d'opérations approximatif | Recaler en WP04 / doc post-review |
| L2 | Underspecification | LOW | WP09 T041 | LIVE par fixture avant WP11 | Parcours réel couvert par WP13 |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 rôle plateforme distinct | Oui | T010-T013, T018-T022 | |
| FR-002 profils de législation | Oui | T001, T003, T028 | |
| FR-003 valeurs provisoires | Oui | T024, T028 | U2 |
| FR-004 prestataires | Oui | T029 | |
| FR-005 organisateurs | Oui | T034 | |
| FR-006 commerçants | Oui | T034 | |
| FR-007 contrats versionnés | Oui | T003, T030, T035 | |
| FR-008 règles de frais | Oui | T002, T003, T030, T036, T044 | |
| FR-009 événements | Oui | T001, T002, T038-T040 | |
| FR-010 réglages par qui de droit | Oui | T023, T026, T040 | U1 |
| FR-011 grand livre à la création | Oui | T006, T038 | |
| FR-012 participations | Oui | T001, T002, T007, T042 | |
| FR-013 points de vente | Oui | T002, T043 | |
| FR-014 cascade versionnée | Oui | T003, T025, T033 | |
| FR-015 bornes de la législation | Oui | T004, T026 | |
| FR-016 version pour les écritures | Oui | T050-T053 | C1 |
| FR-017 conditions visibles | Oui | T008, T046 | |
| FR-018 passage par set_event_status | Oui | T047 | |
| FR-019 double validation | Oui | T010, T021, T031, T035, T040, T045, T048 | |
| FR-020 audit | Oui | T021, T029-T049, T054 | |
| FR-021 contrat et types | Oui | T014-T017, T055 | |
| NFR-001 isolation | Oui | T013, T037, T041, T045, T055 | |
| NFR-002 rôle plateforme cloisonné | Oui | T011, T013, T019 | |
| NFR-003 latence | Oui | T056 | |
| NFR-004 atomicité | Oui | T038, T041 | |
| NFR-005 messages FR/EN | Oui | T026, T027 | |
| NFR-006 suites vertes | Oui | chaque DoD, T057 | |

**Charter Alignment Issues:** aucune — pas de charte (`.kittify/charter/` absent) ; règles de `CLAUDE.md` respectées
(contradictions X-1 à X-5 signalées, `.sql` générés intouchables, `roles.sql` non modifié).

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 21 FR + 6 NFR + 8 C
- Total Tasks : 57 (13 WP)
- Coverage % : 100 % (FR et NFR avec au moins une tâche)
- Ambiguity Count : 2 (U1, U2)
- Duplication Count : 0
- Critical Issues Count : 0

### Next Actions

Aucun point bloquant. Les quatre points moyens sont traités dans les WP concernés au moment de l'implémentation
(U1, U2 en WP06 ; C1 en WP12 ; I1 au merge des lanes), par délégation du porteur du projet.
