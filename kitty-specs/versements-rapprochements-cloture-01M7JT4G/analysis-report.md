---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: versements-rapprochements-cloture-01M7JT4G
mission_id: 01M7JT4GPZBGJHSPDC3XGECZZW
generated_at: '2026-11-17T07:03:46.591664+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/versements-rapprochements-cloture-01M7JT4G/spec.md
    sha256: 62b8d9ec0de88093c6cedb4ae1cf4c5223de6eaee0a612d2c85ad56951431005
  plan.md:
    path: kitty-specs/versements-rapprochements-cloture-01M7JT4G/plan.md
    sha256: 82f6cdae0a81f78395cea5ba60d8c697a7524c68545f0c1d7b0ae2fe471922e9
  tasks.md:
    path: kitty-specs/versements-rapprochements-cloture-01M7JT4G/tasks.md
    sha256: 457fa807eab1be35dfec76d888f6d48e1abd2898a348fb43faeebba87c7c873b
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  low: 2
  medium: 5
  critical: 0
  high: 0
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: C-011 dit « pas de pg_read_all_stats » alors que R-13 fait du propriétaire de ops_long_transactions un membre de pg_read_all_stats ; WP05/WP06 tranchent (aucun rôle cashless_*, réglage de déploiement consigné par WP14).
- id: I2
  severity: medium
  category: inconsistency
  summary: data-model.md met transaction_type nullable dans la PK de account_mapping (impossible en PostgreSQL) ; WP05 impose une sentinelle ou un index unique avec coalesce.
- id: I3
  severity: medium
  category: inconsistency
  summary: ops_verify_audit_chain ajoutée aux tâches (T020, WP05, WP12) mais absente de research.md R-11 ; renforcement à consigner par WP14.
- id: U1
  severity: medium
  category: underspecification
  summary: "expected.after_closing du scénario de référence peut ne pas prévoir les versements ni les relevés : WP14 doit justifier tout écart de after_tx au lieu de l'ajuster."
- id: C1
  severity: medium
  category: charter
  summary: 'Contrôle de chemins src/ et tests/ de la mission software-dev non réglé pour le monorepo (avertissements de finalize-tasks) : à régler avant accept, pas par --lenient.'
- id: E1
  severity: low
  category: coverage
  summary: C-009 (chemins du monorepo) n'est cité par aucune tâche ; les owned_files le respectent tous.
- id: A1
  severity: low
  category: ambiguity
  summary: "NFR-004 (95 % < 1 s sur 100 000 transactions) : la mesure par WP07, WP08 et WP13 dépend de SKIP_LATENCY ; à relancer sans ce drapeau avant l'acceptation."
---

## Specification Analysis Report

Mission `versements-rapprochements-cloture-01M7JT4G`. Pas de charte de projet (`.kittify/charter/charter.md`
absent) : les règles de `CLAUDE.md` (sécurité, aucun faux en production, dette nommée) servent de référence.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | spec.md C-011 ; research.md R-13 ; WP05, WP06 | `pg_read_all_stats` : refusé au rôle de maintenance, requis pour le propriétaire de la fonction | Garder la lecture de WP05/WP06 ; WP14 consigne le réglage de déploiement (12b) |
| I2 | Inconsistency | MEDIUM | data-model.md `account_mapping` ; WP05 T022 | PK avec colonne nullable | Sentinelle `'*'` ou index unique `coalesce`, choix noté par WP05 |
| I3 | Inconsistency | MEDIUM | research.md R-11 ; tasks.md T020 ; WP05, WP12 | Fonction ajoutée hors de la liste de recherche | Renforcement consigné par WP14 (ADR) |
| U1 | Underspecification | MEDIUM | WP14 T062 ; scenario_reference.json `after_closing` | Le scénario attendu peut ne pas couvrir versements et relevés | Comparer les soldes ; justifier `after_tx` sans modifier le scénario (fichiers générés intouchables) |
| C1 | Charter | MEDIUM | finalize-tasks (avertissements) | Convention `src/`/`tests/` contre `apps/`/`packages/` | Régler la configuration avant `accept` (mémoire de la 5a) |
| E1 | Coverage | LOW | spec.md C-009 | Contrainte non citée | Aucune action : chemins conformes |
| A1 | Ambiguity | LOW | NFR-004 ; WP07, WP08, WP13 | Mesure sous `SKIP_LATENCY` | Passe sans le drapeau avant l'acceptation |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs / WPs | Notes |
|-----------------|-----------|----------------|-------|
| FR-001 à FR-008 (clôture) | Oui | T007-T012, T028-T034 (WP02, WP07) | FR-002 aussi WP10 |
| FR-009 à FR-012 (versements) | Oui | T013-T016, T035-T039 (WP03, WP08) | FR-011 : WP01 (CSV) |
| FR-013 à FR-015 (relevés) | Oui | T007-T009, T040-T042 (WP02, WP09) | |
| FR-016 (réclamations tardives) | Oui | T043-T046 (WP10) | |
| FR-017 à FR-019 (dettes 9a) | Oui | T017-T019, T047-T051 (WP04, WP11) | |
| FR-020, FR-021 (scellement, contrôles) | Oui | T020-T021, T052-T057 (WP05, WP12) | |
| FR-022, FR-023 (relevés, export) | Oui | T022, T058-T061 (WP05, WP13) | |
| FR-024 (audit) | Oui | WP06 à WP10, WP13 | |
| NFR-001 à NFR-006 | Oui | WP03, WP07-WP09, WP12-WP14 | voir A1 |
| C-001 à C-011 | Oui sauf C-009 | WP01-WP14 | voir E1 |
| SC-001 à SC-006 | Oui | WP03, WP08, WP09, WP12, WP14 | |

**Charter Alignment Issues:** aucune charte ; règles de `CLAUDE.md` reprises dans chaque prompt (fiche commune) et
par WP14 (dette nommée : OP, ADR, test, report).

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 24 FR + 6 NFR + 11 C + 6 SC = 47
- Total Tasks : 65 (14 WPs)
- Coverage : 100 % (C-009 implicite)
- Ambiguity Count : 1
- Duplication Count : 0
- Critical Issues Count : 0

## Next Actions

Aucun constat bloquant : l'implémentation peut commencer (phase 1 : WP01 à WP05). Les constats MEDIUM sont déjà
traités dans les prompts (I1, I2, I3, U1) ou à régler avant `accept` (C1).
