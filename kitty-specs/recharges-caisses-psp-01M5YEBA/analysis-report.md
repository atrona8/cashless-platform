---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: recharges-caisses-psp-01M5YEBA
mission_id: 01M5YEBA0MXD3B78FN6Q3RNPZ0
generated_at: '2026-10-27T12:27:06.614441+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/recharges-caisses-psp-01M5YEBA/spec.md
    sha256: da4dc1b2af7127d956d2a88c9ea48ff84de918a58374d4fbd4e656de3565a6db
  plan.md:
    path: kitty-specs/recharges-caisses-psp-01M5YEBA/plan.md
    sha256: ba592baf5e140629d8695be900a0419152c05da560ba64e1d96e33ce317c0751
  tasks.md:
    path: kitty-specs/recharges-caisses-psp-01M5YEBA/tasks.md
    sha256: 7796b33507337787fde34b5e80fd282e2eecf608e9fc3134130b065c4ff0344c
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  high: 0
  medium: 7
  low: 5
  critical: 0
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: 'contracts/psp.md et R-20 donnent 409 WALLET_BLOCKED ; openapi.yaml et sqlstate-map donnent 422 (CL039). Tâches : 422 conservé, écart signalé.'
- id: I2
  severity: medium
  category: inconsistency
  summary: contracts/database-rights.md déclare account_purpose_guard SECURITY DEFINER (garde neutralisée) ; WP02 le fait SECURITY INVOKER (renforcement).
- id: I3
  severity: medium
  category: underspecification
  summary: openapi-additions.md n'a pas de route de demande pour PSP_CONFIGURATION, CASH_DEPOSIT, WALLET_UNBLOCK, LATE_CHARGEBACK ni la portée de frais PSP_CONFIGURATION ; contracts/cash.md cite un createApprovalRequest inexistant. WP01 les ajoute.
- id: I4
  severity: medium
  category: inconsistency
  summary: data-model.md ne prévoit pas les colonnes ajoutées par WP04 (psp_event.normalized, psp_topup.succeeded_at/created_at, psp_chargeback.anomaly_id, psp_configuration.supersedes_id...).
- id: I5
  severity: medium
  category: inconsistency
  summary: contracts/psp.md règle 9 (succès après annulation = non crédité) contredit R-20 A3 (crédité si recevable) ; R-20 fait foi.
- id: I6
  severity: medium
  category: underspecification
  summary: open_psp_accounts (décision du porteur du 27/10/2026, SECURITY DEFINER) absente du plan et du data-model ; ADR à écrire (WP14), relecture humaine de 0037.
- id: I7
  severity: medium
  category: inconsistency
  summary: "R-20 A5 « le processus public démarre en production » n'est vrai que pour la partie PSP : createCustomerIdentity lève encore FakeInProductionError."
- id: I8
  severity: low
  category: inconsistency
  summary: Le champ provider de PspTopupRequest porte la méthode (WAVE|ORANGE_MONEY|CARD) alors que data-model nomme method ; non renommé (rupture pour les apps).
- id: I9
  severity: low
  category: underspecification
  summary: R-09 PspAdapter sans méthode d'annulation ; WP07 ajoute cancel(query, secrets).
- id: I10
  severity: low
  category: inconsistency
  summary: "Plafond par carte : jour de l'événement (R-11) contre jour UTC (R-20) ; R-20 retenu."
- id: I11
  severity: low
  category: coverage
  summary: "AuditAction (audit.service.ts) sans propriétaire, modifié par WP08-WP13 : risque de conflits d'union à la fusion (règle posée dans tasks.md)."
- id: I12
  severity: low
  category: coverage
  summary: Risque de parallélisme 0,36 entre lane-b et lane-c (dossiers packages/ledger-sql partagés, fichiers distincts).
---

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | contracts/psp.md ; research.md R-20 ; WP01, WP07, WP11 | 409 contre 422 pour WALLET_BLOCKED | Garder 422 (contrat existant, tests exécutables) ; corriger contracts/psp.md au review |
| I2 | Inconsistency | MEDIUM | contracts/database-rights.md ; WP02 | DEFINER neutraliserait current_user | INVOKER ; consigner le renforcement (WP14) |
| I3 | Underspecification | MEDIUM | contracts/openapi-additions.md, contracts/cash.md ; WP01, WP08, WP10, WP13 | Routes de demande et portée de frais absentes | Ajoutées par WP01 (chemins figés dans tasks.md) |
| I4 | Inconsistency | MEDIUM | data-model.md ; WP04 | Colonnes complémentaires | Recaler data-model.md et 09-class-diagram au review |
| I5 | Inconsistency | MEDIUM | contracts/psp.md règle 9 ; R-20 A3 ; WP04, WP11 | Succès après annulation | R-20 fait foi ; contrat à corriger au review |
| I6 | Underspecification | MEDIUM | plan.md ; data-model.md ; WP03, WP05, WP14 | open_psp_accounts nouvelle | ADR par WP14, relecture humaine de 0037 |
| I7 | Inconsistency | MEDIUM | research.md R-20 A5 ; WP07 | Démarrage en production | WP07 prouve que la partie PSP n'ajoute aucun refus |
| I8 | Inconsistency | LOW | openapi-additions.md ; data-model.md | provider/method | Description du champ ; renommage éventuel en mission 12 |
| I9 | Underspecification | LOW | research.md R-09 ; WP07, WP11 | cancel | Ajouté par WP07 |
| I10 | Inconsistency | LOW | R-11 ; R-20 ; WP04, WP11 | Jour du plafond | Jour UTC |
| I11 | Coverage | LOW | tasks.md ; audit.service.ts | Union sans propriétaire | Ajouts en fin d'union, conflits résolus par l'orchestrateur |
| I12 | Coverage | LOW | lanes.json | lane-b/lane-c | Fichiers distincts, aucune action |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 à FR-031 | Oui | WP01-WP13 (requirement_refs) | 31/31 |
| NFR-001 à NFR-010 | Oui | WP02, WP04, WP05, WP07, WP09, WP12, WP14 | 10/10 |
| C-001 à C-010 | Oui | WP01-WP05, WP07, WP11, WP14 | 10/10 |
| SC-001 à SC-008 | Oui | WP14 (T069-T074) | prouvés de bout en bout |

**Charter Alignment Issues:** aucun charter dans le projet (`charter/charter.md` absent) ; règles de `CLAUDE.md` (sécurité, faux en production, dette nommée) reprises dans chaque prompt de lot.

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 51 (31 FR, 10 NFR, 10 C) + 8 SC
- Total Tasks : 74 (14 lots)
- Coverage : 100 %
- Ambiguity Count : 0 (aucun marqueur TODO / NEEDS CLARIFICATION)
- Duplication Count : 0
- Critical Issues Count : 0

**Next Actions :** aucun bloquant ; implémentation possible. Les écarts I1-I7 sont tranchés dans les arbitrages des lots ; recaler les artefacts du plan (contrats, data-model) à l'addendum post-review.
