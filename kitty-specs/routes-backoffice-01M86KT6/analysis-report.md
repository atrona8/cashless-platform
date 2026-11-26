---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: routes-backoffice-01M86KT6
mission_id: 01M86KT6JR372SV3SK41E5ZQJX
generated_at: '2026-11-24T15:45:05.929435+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/routes-backoffice-01M86KT6/spec.md
    sha256: aea17b53513932b1f86eb49a98ec1a87027d601f6be651533954cd63d3f2a0a3
  plan.md:
    path: kitty-specs/routes-backoffice-01M86KT6/plan.md
    sha256: 12c9b1a3c05b7074a1e7483010851ced4f295f8488170271024c580a562f1e6c
  tasks.md:
    path: kitty-specs/routes-backoffice-01M86KT6/tasks.md
    sha256: 644b3bbfedffb8634e5cebf113c373a715a2af40c4f79fc4ec36692a5146bbe1
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  high: 0
  critical: 0
  medium: 3
  low: 4
  info: 0
findings:
- id: F1
  severity: medium
  category: inconsistency
  summary: 'NFR-005 (aucun droit nouveau pour cashless_app sans décision) contre GRANT SELECT sur sale_overview, anomaly_overview, phone_model et EXECUTE des fonctions nouvelles (WP01, WP02) : couverts par D5 et D9 validées, mais à citer explicitement dans ADR-235.'
- id: F2
  severity: medium
  category: inconsistency
  summary: 'WP04 retouche openapi.yaml, contract-baseline.json et les types générés, propriété de WP03, depuis une autre lane (lane-d contre lane-c) : risque de contenu non attribuable à la consolidation.'
- id: F3
  severity: medium
  category: underspecification
  summary: "Anomalies sans grand livre (ledger_id NULL, signaux de sécurité d'un bracelet sans portefeuille) : pas d'événement, donc invisibles et non classables pour ORGANIZER_ADMIN ; comportement attendu non écrit (FR-008, FR-009)."
- id: F4
  severity: low
  category: inconsistency
  summary: Retrait de PLATFORM_ADMIN de searchCustomerByPhone (renforcement des tâches) absent de spec.md ; à consigner dans ADR-235 (prévu par WP11 T042).
- id: F5
  severity: low
  category: inconsistency
  summary: Exception à C-001 (device_model et nfc_level sur quatre schémas existants, D2 et A6) non reportée dans le texte de C-001 de spec.md ; consignée dans research et contrat, à reprendre dans ADR-235.
- id: F6
  severity: low
  category: inconsistency
  summary: 'WP04 annonce « ~227 à 230 » opérations ; après WP03 le contrat en comptera environ 241. Sans effet : le script compte.'
- id: F7
  severity: low
  category: inconsistency
  summary: "SPECIFICATION §12.2 liste 21 types d'anomalie, le schéma 23 : contradiction §0.3 connue, amendement prévu en WP11 T041."
---

## Specification Analysis Report

Mission `routes-backoffice-01M86KT6` (11b), le 24/11/2026. Charte Spec Kitty absente (`.kittify/charter/` introuvable) :
règles du projet appliquées à la place (`CLAUDE.md` règles 1 à 4, SPECIFICATION §0.3, contrat stable). Artefacts lus :
spec, plan, research (D1-D10 validées par le porteur), data-model, contracts, interfaces, tasks et les 11 prompts.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| F1 | Inconsistency | MEDIUM | spec.md NFR-005 ; WP01 l. 69, 110, 156 ; WP02 l. 76, 85, 104 | Droits `SELECT` sur les vues et `phone_model`, `EXECUTE` des fonctions nouvelles, contre « aucun droit nouveau sans décision » | Droits couverts par D5 et D9 ; WP11 les liste nommément dans ADR-235 ; aucun autre droit |
| F2 | Inconsistency | MEDIUM | tasks.md WP04 ; lanes.json (lane-d dépend de lane-c) | Fichiers de WP03 retouchés par WP04 dans une autre lane | Consolidation : chaîner les lanes en `--no-ff` (précédent 10a) ; relecture de WP04 sur le diff exact de ces fichiers |
| F3 | Underspecification | MEDIUM | spec.md FR-008, FR-009 ; interfaces.md §2 `anomaly_overview` | Anomalies sans grand livre : aucune règle de portée écrite | WP07 : les réserver à `OPERATOR_ADMIN` (lecture et classement), le tester et le noter ; WP11 le consigne |
| F4 | Inconsistency | LOW | interfaces.md §3 ; contracts A5 ; spec.md FR-013 | `PLATFORM_ADMIN` retiré de la recherche par numéro | Consigner (WP11 T042) |
| F5 | Inconsistency | LOW | spec.md C-001 ; research D2 ; contracts A6 | Exception à C-001 hors du texte de la spec | Consigner (ADR-235) |
| F6 | Inconsistency | LOW | WP04 l. 60 | Nombre d'opérations approximatif | Aucun : le script compte |
| F7 | Inconsistency | LOW | SPECIFICATION §12.2 ; schéma `anomaly` | 21 types contre 23 | Amendement WP11 T041 |

**Coverage Summary Table**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001, FR-002 profil | Oui | T018, T019 | WP05 |
| FR-003, FR-004 x-roles | Oui | T014-T016, T038-T040 | WP04, WP10 |
| FR-005 à FR-007 ventes | Oui | T006, T008, T021-T024 | WP02, WP06 |
| FR-008 à FR-010 anomalies | Oui | T001, T002, T007, T025-T028 | WP01, WP02, WP07 (F3) |
| FR-011 à FR-014 recherche | Oui | T005, T029-T033 | WP01, WP08 |
| FR-015, FR-016 modèles | Oui | T003, T004, T034-T037 | WP01, WP09 |
| FR-017 cloisonnement | Oui | T020, T024, T028, T033, T037 | balayage de la mission |
| FR-018 traçabilité | Oui | T017, T026, T031, T034 | WP05, WP07-WP09 |
| NFR-001 à NFR-006 | Oui | T008, T023, T024, T032, T033 et pgTAP | NFR-005 : F1 |
| C-001 à C-006, SC-001 à SC-004 | Oui | WP03, WP11, tests des lots | C-006 et SC-001 rattachés à WP11 |

**Charter Alignment Issues** : aucune (charte absente). Règle 1 de `CLAUDE.md` : aucun écart qui affaiblit la sécurité ;
deux renforcements (D4, retrait de `PLATFORM_ADMIN` de la recherche par numéro) à consigner.

**Unmapped Tasks** : aucune.

**Metrics** : 18 exigences fonctionnelles, 6 non fonctionnelles, 6 contraintes, 4 critères de réussite ; 44 sous-tâches
dans 11 lots ; couverture 100 % ; ambiguïtés 1 (F3) ; doublons 0 ; problèmes critiques 0.

**Next Actions** : verdict `ready`. F3 et F1 se règlent dans les lots (consigne à WP07 et à WP11), F2 à la consolidation.
