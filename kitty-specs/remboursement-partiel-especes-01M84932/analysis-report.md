---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: remboursement-partiel-especes-01M84932
mission_id: 01M84932TEMR04GJJ065CAQ0FZ
generated_at: '2026-11-23T14:14:07.577797+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/remboursement-partiel-especes-01M84932/spec.md
    sha256: 19cfc2af4b59205afdec54049d29d08b631edba088669b6d14050856c85b0135
  plan.md:
    path: kitty-specs/remboursement-partiel-especes-01M84932/plan.md
    sha256: db0aeca67750ea20b77b16bc23b0ddb721b509b539db63637355011f6adba6fe
  tasks.md:
    path: kitty-specs/remboursement-partiel-especes-01M84932/tasks.md
    sha256: 24c5c7cba1c2f4e2c4722236c8a4abc21bbabe1026e6c5271974fc7769186c58
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  high: 0
  medium: 1
  critical: 0
  low: 2
  info: 0
findings:
- id: C1
  severity: medium
  category: underspecification
  summary: Le cas limite « événement hors des phases où le guichet rembourse » (spec, Edge Cases et Assumptions) n'a aucun contrôle nommé dans WP05 T016 ; les phases permises ne sont écrites nulle part.
- id: F1
  severity: low
  category: inconsistency
  summary: plan.md Technical Context (Constraints) dit encore « 20 rendus simultanés sur un bracelet » alors que NFR-002 parle d'un portefeuille depuis la décision du porteur.
- id: F2
  severity: low
  category: inconsistency
  summary: spec.md Edge Cases dit « deux rendus simultanés sur le même bracelet » au lieu du portefeuille.
---

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| C1 | Underspecification | MEDIUM | spec.md l. 99 et 162 ; tasks/WP05 T016 | Les phases d'événement où le rendu partiel est permis ne sont ni listées ni contrôlées explicitement par un lot. | Dans WP05 T016, reprendre le contrôle de phase de `releaseMedia` / `refundCashDue` (lire le code, mêmes refus) et le tester ; l'implémenteur le note dans sa note de lane. |
| F1 | Inconsistency | LOW | plan.md l. 29 | « sur un bracelet » au lieu de « sur un portefeuille ». | Corriger au prochain passage du plan ; sans effet sur les lots (WP05 T020 dit portefeuille). |
| F2 | Inconsistency | LOW | spec.md l. 101 | « sur le même bracelet » au lieu de « portefeuille ». | Idem ; NFR-002 et WP05 portent la bonne règle. |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 rendu partiel | Oui | T004, T015-T018 | |
| FR-002 bracelet gardé | Oui | T017, T018 | |
| FR-003 solde payé seulement | Oui | T017, T018 | |
| FR-004 autorisation prestataire | Oui | T008, T011 | |
| FR-005 activation organisateur | Oui | T001, T005, T008-T011 | |
| FR-006 refus explicite | Oui | T004, T016, T018 | |
| FR-007 seconde personne au cumul | Oui | T012-T014, T017, T019 | cumul par portefeuille |
| FR-008 frais à chaque rendu | Oui | T016, T017 | |
| FR-009 anonymes | Oui | T018 | |
| FR-010 contrôle de caisse | Oui | T017, T019 | |
| FR-011 idempotence | Oui | T017, T018 | |
| FR-012 refus pendant EDGE | Oui | T016, T018 | |
| FR-013 traçabilité | Oui | T010, T017, T022 | |
| NFR-001 p95 < 300 ms | Oui | T020 | |
| NFR-002 aucun dépassement | Oui | T003, T014, T020 | |
| NFR-003 cloisonnement | Oui | T011, T018 | |
| NFR-004 aucun droit élargi | Oui | T001, T002 | |
| C-001 contrat stable | Oui | T004-T007 | |
| C-002 guichet de retour inchangé | Oui | T014 (exclusion du cumul), T018 | |
| C-003 spécification amendée | Oui | T021, T022 | |
| C-004 écart de sécurité soumis | Oui | fiche commune, T022 | |
| C-005 espèces seulement | Oui | T016, T017 | |

**Charter Alignment Issues:** charte Spec Kitty absente (`.kittify/charter/charter.md`) ; règles du projet (CLAUDE.md) reprises par la fiche commune.

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 22 (13 FR, 4 NFR, 5 C)
- Total Tasks : 24
- Coverage : 100 %
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0

## Next Actions

Verdict `ready` : implémentation possible. C1 à traiter par l'implémenteur de WP05 (contrôle de phase repris du guichet de retour), F1 et F2 à corriger au prochain passage des artefacts.
