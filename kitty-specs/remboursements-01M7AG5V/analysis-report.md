---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: remboursements-01M7AG5V
mission_id: 01M7AG5VMS4GNWVA9DH2JQ0E05
generated_at: '2026-11-16T11:04:29.049939+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/remboursements-01M7AG5V/spec.md
    sha256: 83ccc123cfe9348ecfea999ce048f22359aeaa6692aecd7a1033a2aeaa60db69
  plan.md:
    path: kitty-specs/remboursements-01M7AG5V/plan.md
    sha256: 10b53258930855b77ac16c8701b4a38268f64805b7adc739f9564c21a6b7f56a
  tasks.md:
    path: kitty-specs/remboursements-01M7AG5V/tasks.md
    sha256: 1b45b404af4fa51f8bf5eb2e60c74fe4d0ad7a0f3594e4170acfadeeb521429c
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  medium: 1
  critical: 0
  low: 2
  high: 0
  info: 0
findings:
- id: G1
  severity: medium
  category: coverage
  summary: "Lien du titulaire (decideRefundRequestAsHolder) : aucune sous-tâche ne fait parvenir otp_request_id et refund_request_id à l'envoyeur de codes ; correction décidée par le porteur (décision 14), portée par WP03 rouvert (OP-N129)."
- id: S3
  severity: low
  category: inconsistency
  summary: data-model.md l. 51 et le prompt de WP04 l. 200 décrivent encore la branche « sans titulaire → REQUESTED » retirée de FR-012 et du scénario 5 (décision 15).
- id: S2
  severity: low
  category: inconsistency
  summary: plan.md cite SPECIFICATION §12.1 comme à amender (ADR-189) sans lot propriétaire ; WP07 le propose au compte rendu seulement.
---

## Specification Analysis Report

Mission `remboursements-01M7AG5V` (9a), re-analyse du 16/11/2026 après l'amendement de FR-012 et du scénario 5
(décision 15 du porteur, C-001, ADR-194). Pas de charte (`.kittify/charter/` absent) : règles tenant lieu = `CLAUDE.md`
et SPECIFICATION §0.3. Seuls FR-012 et le scénario 5 de `spec.md` ont changé depuis la passe du 13/11 ; `plan.md` et
`tasks.md` sont inchangés.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| G1 | Coverage | MEDIUM | tasks/WP03 ; contracts/interfaces.md l. 94 ; openapi `decideRefundRequestAsHolder` | Lien du titulaire impossible à construire (OP-N129) | WP03 rouvert (décision 14), test de bout en bout sans lecture en base ; OP-N129 levé par WP07 |
| S3 | Inconsistency | LOW | data-model.md l. 51 ; tasks/WP04 l. 200 | Branche retirée encore décrite | Aligner `data-model.md` (orchestrateur) ; prompt de WP04 historique, lot approuvé |
| S2 | Inconsistency | LOW | plan.md ; tasks/WP07 | Amendement §12.1 sans lot | Décider à la revue post-fusion |

Constats de la passe du 13/11 levés : U1 (fractionnement au guichet, décision 11, seuil sur le cumul, ADR-190), U2
(quotas OTP partagés, décision 12b, OP-N125, ADR-193), C1 (matrice d'acceptation tenue par l'orchestrateur au fil des
lots).

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001, FR-003 | Oui | T001-T006 | WP01 |
| FR-002, FR-004 à FR-007, FR-010, FR-014, FR-020 | Oui | T018-T024 | WP04 |
| FR-008, FR-009, FR-019 | Oui | T025-T030 (et T007-T010) | WP05, WP02 |
| FR-011, FR-012, FR-013 | Oui | T012-T017 | WP03 ; FR-012 amendée (décision 15) ; lien du titulaire : G1 |
| FR-015, FR-016, FR-017 | Oui | T031-T035 | WP06 |
| FR-018 | Oui | T009, T011 (+ WP06) | WP02 |
| NFR-001 à NFR-005 | Oui | T030, T037, T038, T016 | WP05, WP07, WP03 |
| SC-001 à SC-005 | Oui | T036 | WP07 |
| C-001 à C-008 | Oui | toutes | — |

**Charter Alignment Issues:** aucune charte. Règles de `CLAUDE.md` : l'amendement renforce (aucun droit élargi) ; les
écarts acceptés (décisions 12a, 12b, 13) sont consignés par WP07.

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 20 FR, 5 NFR, 8 C, 5 SC
- Total Tasks : 41 sous-tâches, 7 lots
- Coverage : 100 % des FR et NFR
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0

**Next Actions:** aucun constat bloquant. Rouvrir WP03 pour G1 (décision 14) ; aligner `data-model.md` (S3) ;
WP07 cycle 2 : clore OP-N127 par ADR-194, lever OP-N129.
