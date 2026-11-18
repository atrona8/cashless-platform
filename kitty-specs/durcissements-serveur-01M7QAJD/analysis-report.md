---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: durcissements-serveur-01M7QAJD
mission_id: 01M7QAJDZWVP1GG5NT4DDYWD37
generated_at: '2026-11-18T15:10:34.154390+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/spec.md
    sha256: 7d2a7494071125cc13e0da3571c9b7153214ff26da0b38c009343f9924a4fff7
  plan.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/plan.md
    sha256: bf4c520cb726d1adbf1fcda0407e70184fd3368f7babcc63b31a7f1c24306f7f
  tasks.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/tasks.md
    sha256: bf53b9aab8e9689e9b5eb3e11a5da514e6f4bd8910fb8e8e6d9b890567190120
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  critical: 0
  medium: 0
  low: 2
  high: 0
  info: 0
findings:
- id: I4
  severity: low
  category: inconsistency
  summary: plan.md and data-model.md place the cashless_pin role in roles.sql; WP03 creates it in post-roles.sql.
- id: I5
  severity: low
  category: inconsistency
  summary: Spec C-002 keeps a conditional App Attest contract addition that the plan rules out (verifier not wired).
---

## Specification Analysis Report (relance après amendements du 18/11/2026)

Constats I1, I2 et I3 résolus par l'amendement de la spec (`2cb0eec2` : C-006, NFR-005, SC-005, cas limite, hypothèses,
décisions, alignés sur les décisions du porteur du 18/11/2026) ; C1 résolu (`8b475a08` : FR-010 référencé par WP10).

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I4 | Inconsistency | LOW | plan.md IC-03 ; data-model.md « Rôle nouveau » ; WP03 | Lieu de création du rôle `cashless_pin`. | WP03 fait foi ; WP14 aligne la doc. |
| I5 | Inconsistency | LOW | spec.md C-002 ; plan.md Technical Context | Ajout conditionnel au contrat pour App Attest, écarté au plan. | Aucun changement ; l'ajout ne se produit pas. |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001..FR-003 lots par fonctions | Oui | T002, T003, T011, T018 | WP01, WP03, WP05 |
| FR-004 routes de lot inchangées | Oui | T020 | WP05 |
| FR-005..FR-007 processus du PIN | Oui | T010-T012, T022-T030 | WP03, WP06, WP07 |
| FR-008 vendeur dans la clé | Oui | T001, T004 | WP01 |
| FR-009 masque IBAN | Oui | T031, T033 | WP08 |
| FR-010 IBAN chiffré | Oui | T006, T032, T034, T035, T038 | WP02, WP08, WP09, WP10 |
| FR-011, FR-012 demande à l'état initial, anciennes signatures | Oui | T005, T009, T012, T037 | WP02, WP03, WP09 |
| FR-013..FR-016 décisions de lot | Oui | T040-T042 | WP10 |
| FR-017 plafond | Oui | T043-T045 | WP11 |
| FR-018, FR-019 App Attest | Oui | T008, T049-T052 | WP02, WP13 |
| FR-020 grand livre d'inscription | Oui | T007, T046-T048 | WP02, WP12 |
| FR-021 levées consignées | Oui | T053-T056 | WP14 |
| NFR-001 latence PIN | Oui | T030 | WP07 |
| NFR-002 export | Oui | T039 | WP10 |
| NFR-003 droits | Oui | T011-T014 | WP03 |
| NFR-004 mutations | Oui | chaque lot de levée, T056 | WP14 consolide |
| NFR-005 rien en clair | Oui | T006, T037, T038 | NFR-005 amendé |

**Charter Alignment Issues:** aucune charte (`.kittify/charter/` absent) ; règles normatives de `CLAUDE.md` respectées par
le plan (écarts de sécurité soumis et tranchés le 18/11/2026, aucun faux nouveau, `.sql` générés intacts).

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 21 FR, 5 NFR, 8 C, 5 SC
- Total Tasks : 56 sous-tâches, 14 lots
- Coverage : 100 % des FR et NFR ont au moins une sous-tâche
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0 (0 HIGH)

## Next Actions

- Verdict prêt : implémentation par `spec-kitty next` / boucle implémentation-relecture.
