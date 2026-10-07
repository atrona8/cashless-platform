---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: fondations-grand-livre-01M4AY8M
mission_id: 01M4AY8MPQ5JPN1DBF8D7SMZYX
generated_at: '2026-10-07T16:22:31.137306+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs\fondations-grand-livre-01M4AY8M\spec.md
    sha256: 3b7e04906950f3257f98194eccc0fe38f7e928a5b2a21409109f9c9a250cf719
  plan.md:
    path: kitty-specs\fondations-grand-livre-01M4AY8M\plan.md
    sha256: 638ea44ed6c7cfe48176220a0b73d43028d8814edebd4dfe91e5d33e753c6636
  tasks.md:
    path: kitty-specs\fondations-grand-livre-01M4AY8M\tasks.md
    sha256: 2951fde5082514e57c7f28053b1d4453f66950526617250054986fd61dd7d95d
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  high: 0
  medium: 4
  critical: 0
  low: 4
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: FR-012 publie GET /v1/health alors que C-009 interdit d'ajouter une route à openapi.yaml, qui est le contrat de l'API (§10).
- id: A1
  severity: medium
  category: ambiguity
  summary: WP11 T054 laisse ouverte dans le texte la règle d'une clé COMPLETED expirée ; la décision retenue doit être tranchée avant le code.
- id: A2
  severity: medium
  category: ambiguity
  summary: WP13 T070 délibère sur l'ordre du second rejeu (avant CLOSED ou après LOCKED) ; FR-021 ne précise pas à quel moment le second rejeu a lieu.
- id: C1
  severity: medium
  category: coverage
  summary: NFR-006 (boucle locale pgTAP < 5 min) n'a aucune sous-tâche de mesure explicite ; seule la durée CI (NFR-007) est relevée en T073.
- id: A3
  severity: low
  category: ambiguity
  summary: 'Matrice des statuts : DEPOSIT_TAKEN synchronisé en CLOSING/RECONCILING est une lecture de sync_protocol §7.5, marquée à confirmer.'
- id: U1
  severity: low
  category: underspecification
  summary: WP10 T053 introduit une exception (TenantTx.ping hors prestataire) à la règle « tout accès base par withTenantTx » sans la reporter dans plan.md.
- id: F1
  severity: low
  category: inconsistency
  summary: 'Deux éditions hors carte prévues (app.module.ts en WP11, research.md en WP13) : justifiées dans les fiches, à vérifier en review.'
- id: F2
  severity: low
  category: inconsistency
  summary: La décision specify « pgTAP chargé en SQL » est remplacée par le cluster privé au plan ; la spec (FR-003) reste compatible mais ne le mentionne pas.
---

## Specification Analysis Report

Mission `fondations-grand-livre-01M4AY8M` · 2026-10-07 · charte : absente (`.kittify/charter/` inexistant), contrôle
de charte sans objet ; les sources normatives du kit (SPECIFICATION §0.3) tiennent lieu de référence.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | spec.md FR-012, C-009 ; tasks/WP10 T053 | Route de santé publiée mais hors contrat | Garder hors contrat (route d'exploitation) et le noter dans `docs/07` (déjà fait) ; ou l'ajouter à `openapi.yaml` dans une mission ultérieure |
| A1 | Ambiguity | MEDIUM | tasks/WP11 T054 | Clé `COMPLETED` expirée : règle non tranchée | Retenir : une clé expirée n'est jamais réutilisée (réponse rejouée si même empreinte, `IDEMPOTENCY_KEY_REUSED` sinon) jusqu'à la purge |
| A2 | Ambiguity | MEDIUM | tasks/WP13 T070 ; spec FR-021 | Moment du second rejeu | Second rejeu avant `CLOSED` (le moteur renvoie les transactions existantes) + test séparé après `LOCKED` par `post_transaction` |
| C1 | Coverage | MEDIUM | spec NFR-006 ; tasks WP02 | Pas de mesure de la boucle locale | Chronométrer `reset-db.sh` + `test:pgtap` en WP03/WP14 et consigner |
| A3 | Ambiguity | LOW | contracts/status-type-matrix.md | Lecture de `DEPOSIT_TAKEN` en clôture | Garder la lecture stricte, commentaire `FR-024` |
| U1 | Underspecification | LOW | tasks/WP10 T053 | Exception `ping` hors prestataire | La documenter dans le code (lecture `SELECT 1`, aucune table) |
| F1 | Inconsistency | LOW | tasks/WP11, WP13 | Éditions hors carte | Vérifier en review qu'elles se limitent à l'import du module et à la section de `research.md` |
| F2 | Inconsistency | LOW | decisions DM-01M4AYCM…, DM-01M4B0BA… | Décision specify affinée au plan | Rien à faire : la décision de plan référence celle de specify |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 monorepo | Oui | T001-T005 | |
| FR-002 migrations | Oui | T011-T013 | |
| FR-003 outillage pgTAP local | Oui | T006-T010 | |
| FR-004 suites en CI | Oui | T072 | |
| FR-005 garde des générés | Oui | T015, T072 | |
| FR-006 connexion cloisonnée | Oui | T048, T059 | |
| FR-007 prestataire déduit | Oui | T049 | |
| FR-008 erreurs normalisées | Oui | T052, T059 | |
| FR-009 idempotence S21 | Oui | T016-T019, T054-T058 | |
| FR-010 X-Request-Id | Oui | T050 | |
| FR-011 Accept-Language | Oui | T051 | |
| FR-012 santé | Oui | T053 | I1 |
| FR-013 26 constructeurs | Oui | T029-T042 | |
| FR-014 délégation SQL | Oui | T041, T061 | |
| FR-015 ordre de traitement | Oui | T029, T045, T060 | |
| FR-016 calculs entiers | Oui | T023-T027 | |
| FR-017 19 cas | Oui | T028 | |
| FR-018 types selon statut | Oui | T043-T044, T060 | |
| FR-019 écritures de back-office | Oui | T039, T042 | |
| FR-020 rejeu | Oui | T065-T069 | |
| FR-021 second rejeu | Oui | T070 | A2 |
| FR-022 types générés | Oui | T020-T022, T072 | |
| FR-023 tests TS en CI | Oui | T072 | |
| FR-024 contradictions | Oui | T071 | |
| NFR-001 exactitude | Oui | T028, T035, T042, T069 | |
| NFR-002 rejeu idempotent | Oui | T070 | |
| NFR-003 suites vertes | Oui | T014, T018, T075 | |
| NFR-004 aucune fuite SQL | Oui | T052, T059 | |
| NFR-005 isolation | Oui | T059 | |
| NFR-006 boucle locale < 5 min | Partiel | — | C1 |
| NFR-007 CI < 15 min | Oui | T073 | |
| NFR-008 durées du rôle | Oui | T059 | |

**Charter Alignment Issues:** aucune (pas de charte).

**Unmapped Tasks:** aucune (T074 documentation et T075 contrôle final relèvent de FR-004/FR-023 et SC-001 à SC-003).

**Metrics:**

- Total Requirements : 24 FR + 8 NFR + 10 C
- Total Tasks : 75 sous-tâches, 14 WP
- Coverage % : 100 % des FR ; 97 % des NFR (NFR-006 partiel)
- Ambiguity Count : 3
- Duplication Count : 0
- Critical Issues Count : 0

### Next Actions

Aucun point bloquant : l'implémentation peut commencer. A1, A2 et C1 sont tranchés à l'implémentation selon les
recommandations ci-dessus (WP11, WP13, WP03/WP14) et consignés dans `research.md` (FR-024).
