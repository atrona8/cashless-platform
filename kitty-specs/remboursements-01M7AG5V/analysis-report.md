---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: remboursements-01M7AG5V
mission_id: 01M7AG5VMS4GNWVA9DH2JQ0E05
generated_at: '2026-11-13T14:46:43.101285+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/remboursements-01M7AG5V/spec.md
    sha256: e183f26eb73b90933e6ab6c9e35d16f4ccf066a4b1d6666f2765aa6374305017
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
  high: 0
  low: 3
  critical: 0
  medium: 5
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: research.md R-03 (Decision) parle encore d'une garde de statut de la base ; seule la précision du 13/11 et interfaces.md disent que l'élargissement est dans le moteur.
- id: I2
  severity: medium
  category: inconsistency
  summary: research.md R-05 prévoit X-Test-Otp-Code sur la réponse de création ; l'arbitrage du 13/11 (interfaces.md) l'exclut, les tests lisent le code par un OtpSender d'enregistrement.
- id: I3
  severity: medium
  category: inconsistency
  summary: spec.md ne dit pas que la création sur le portefeuille d'autrui rend 422 REFUND_NOT_ALLOWED (arbitrage, faute de 404 au contrat) ; le cas limite ne vise que la lecture d'une demande (404).
- id: U1
  severity: medium
  category: underspecification
  summary: 'Guichet de retour : caution, solde payé et espèces dues peuvent chacun rester sous cash_refund_single_max alors que leur somme le dépasse ; aucune règle (question au porteur prévue dans WP06).'
- id: U2
  severity: medium
  category: underspecification
  summary: "Codes à usage unique : quota d'envoi et blocage partagés entre connexion et remboursement ; un tiers qui déclenche des codes peut gêner la connexion ou la création (risque résiduel non consigné en OP)."
- id: C1
  severity: low
  category: coverage
  summary: "acceptance-matrix.json n'appartient à aucun lot (interdit sous kitty-specs) : l'orchestrateur l'écrit à partir des preuves de suivi-lots.md ; à ne pas oublier avant accept."
- id: S1
  severity: low
  category: inconsistency
  summary: spec.md garde le statut Draft alors que le plan et les lots sont finalisés.
- id: S2
  severity: low
  category: inconsistency
  summary: plan.md cite SPECIFICATION §12.1 comme à amender (ADR-189) sans lot propriétaire ; WP07 le propose au compte rendu seulement.
---

## Specification Analysis Report

Mission `remboursements-01M7AG5V` (9a). Pas de charte (`.kittify/charter/` absent) : règles tenant lieu = `CLAUDE.md`
(écarts de sécurité, aucun faux en production, dette nommée) et SPECIFICATION §0.3.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | research.md:83 ; contracts/interfaces.md (Arbitrages) | R-03 « Decision » décrit encore une garde en base | Réécrire la phrase de R-03 (moteur seulement) |
| I2 | Inconsistency | MEDIUM | research.md:133 | `X-Test-Otp-Code` sur la création | Aligner R-05 sur l'arbitrage (OtpSender d'enregistrement) |
| I3 | Inconsistency | MEDIUM | spec.md:157 ; contracts/served-operations.md | 422 pour le portefeuille d'autrui non dit dans la spec | Ajouter un cas limite à la spec |
| U1 | Underspecification | MEDIUM | tasks/WP06 ; research.md R-08 | Fractionnement sous le seuil au guichet | Question au porteur pendant WP06 (déjà prévue), consigner la réponse |
| U2 | Underspecification | MEDIUM | tasks/WP03 ; research.md R-05 | Quotas et blocage OTP partagés | Consigner en OP au WP07 (risque résiduel) ou décider d'un quota par usage |
| C1 | Coverage | LOW | tasks/WP07 T041 | Matrice d'acceptation sans propriétaire | Orchestrateur, avant `accept` |
| S1 | Inconsistency | LOW | spec.md:5 | Statut Draft | Passer à « Planned » à la prochaine retouche de la spec |
| S2 | Inconsistency | LOW | plan.md ; tasks/WP07 | Amendement §12.1 sans lot | Décider au WP07 / revue |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001, FR-003 | Oui | T001-T006 | WP01 |
| FR-002, FR-004 à FR-007, FR-010, FR-014, FR-020 | Oui | T018-T024 | WP04 |
| FR-008, FR-009, FR-019 | Oui | T025-T030 (et T007-T010 pour la matrice) | WP05, WP02 |
| FR-011, FR-012, FR-013 | Oui | T012-T017 | WP03 |
| FR-015, FR-016, FR-017 | Oui | T031-T035 | WP06 |
| FR-018 | Oui | T009, T011 (+ test API WP06) | WP02 |
| NFR-001 à NFR-005 | Oui | T030, T037, T038, T016 | WP05, WP07, WP03 |
| SC-001 à SC-005 | Oui | T036 | WP07 |
| C-001 à C-008 | Oui | toutes (règles communes, fiche) | — |

**Charter Alignment Issues:** aucune charte. Règles de `CLAUDE.md` : aucun écart qui affaiblit la sécurité prévu ;
élargissement de la matrice décidé par le porteur et à consigner (ADR-189, WP07) ; renforcements listés dans
`contracts/interfaces.md`.

**Unmapped Tasks:** aucune (41 sous-tâches, chacune dans un lot ; `finalize-tasks` : 20/20 FR, 5/5 SC rattachés).

**Metrics:**

- Total Requirements : 20 FR, 5 NFR, 8 C, 5 SC
- Total Tasks : 41 sous-tâches, 7 lots (195 à 268 lignes)
- Coverage : 100 % des FR et NFR
- Ambiguity Count : 2 (U1, U2)
- Duplication Count : 0
- Critical Issues Count : 0

**Next Actions:** aucun constat bloquant ; l'implémentation peut commencer. I1 à I3 et S1 sont des alignements de texte
à faire avant le lot concerné (ils ne changent aucune décision) ; U1 sera soumis au porteur pendant WP06 ; U2 consigné
au WP07.
