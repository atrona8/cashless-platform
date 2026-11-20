---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: serveur-app-festivalier-01M7WB69
mission_id: 01M7WB69J2GKJHCP39J5CVTHAT
generated_at: '2026-11-20T14:33:13.690604+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/serveur-app-festivalier-01M7WB69/spec.md
    sha256: e7a4de24a4fb60f1183aea81a06a979dab82e59769f5e84a3d90c3688d4679df
  plan.md:
    path: kitty-specs/serveur-app-festivalier-01M7WB69/plan.md
    sha256: 360d2135b196d3f2d0e26e247088acb97367a2c472c2c9f4aefcff95b0fbe3cf
  tasks.md:
    path: kitty-specs/serveur-app-festivalier-01M7WB69/tasks.md
    sha256: c1c089f0aef9f1f7321e72084d0c4ffa93ae145ea0c2efb2ae9b1073561abec6
  charter:
    path:
    sha256:
verdict: blocked
issue_counts:
  medium: 2
  low: 2
  high: 1
  critical: 0
  info: 0
findings:
- id: F1
  severity: high
  category: inconsistency
  summary: register_personalized_media dite versionnée (tasks.md T007 '(6)', T031, risques 'six' ; interfaces.md l.39 et l.46 ; WP04 l.138) alors qu'interfaces.md l.31, WP02 et WP07 la disent inchangée (cinq fonctions).
- id: F2
  severity: medium
  category: inconsistency
  summary: plan.md annonce un seul ajout au contrat ; DM-01M7WGNJK39C2XVDFYTXVR8YEK et WP09 en ajoutent un second (deux valeurs d'énumération, ADR-225), validé par le porteur.
- id: F3
  severity: medium
  category: coverage
  summary: "Retouches hors carte nombreuses (post-roles.sql WP02/WP04, kyc.module.ts WP05/WP06, app.module.ts, redact.ts, claims.dto.ts, lost-media.service.ts, types générés, production-guard.spec, device-latency.spec) : déclarées mais exposées au refus 'lane stale' à la consolidation."
- id: F4
  severity: low
  category: underspecification
  summary: "spec.md Assumptions : printed_number 'à confirmer au plan' alors que le plan l'a tranché (3e colonne facultative)."
- id: F5
  severity: low
  category: inconsistency
  summary: plan.md IC-02 liste approval/action-registry.ts comme surface modifiée ; WP06 ne fait que s'y enregistrer par le constructeur (lecture seule).
---

## Specification Analysis Report — mission 10a (serveur-app-festivalier-01M7WB69)

Pas de charte Spec Kitty (`.kittify/charter/` absent) : règles de `CLAUDE.md` et SPECIFICATION §0.3 appliquées.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| F1 | Inconsistency | HIGH | tasks.md T007, T031, l.80, l.116 ; interfaces.md l.39, l.46 ; WP04 l.138 contre interfaces.md l.31, WP02 T007, WP07 l.90 et T031 | `register_personalized_media` tantôt versionnée (« six fonctions », « nouvelle signature »), tantôt inchangée (« cinq »). WP04 risque de figer dans les listes de droits une signature qui n'existe pas, ou un agent de la créer. | Aligner sur « inchangée, cinq fonctions » : tasks.md (T007 « (5) », T031 « inchangée », risques), interfaces.md l.39 et l.46, WP04 l.138 (signature actuelle). |
| F2 | Inconsistency | MEDIUM | plan.md l.37-39, l.44 ; DM-01M7WGNJK… ; WP09 l.94-97 | Plan : « un seul ajout » au contrat ; décision du porteur : aussi deux valeurs de `ClaimCodeAssociationResult.reason`. | Mettre à jour plan.md (Constraints, Scale) avec le second ajout et ADR-225. |
| F3 | Coverage | MEDIUM | WP02, WP05, WP06, WP07, WP09, WP10 | Fichiers modifiés hors carte de propriété ; les paires partagées sont sérialisées par les dépendances (WP02→WP04, WP05→WP06), le reste est disjoint. | Garder la liste dans chaque note de lane ; chaînage `--no-ff` à la consolidation (parade 9b/11a). |
| F4 | Underspecification | LOW | spec.md Assumptions §1 | Hypothèse résolue au plan, encore formulée comme à confirmer. | Noter « confirmé au plan le 20/11/2026 ». |
| F5 | Inconsistency | LOW | plan.md IC-02 | `action-registry.ts` listé comme surface modifiée, seulement consommé. | Remplacer par « consommé ». |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 identification-guichet | Yes | WP01, WP05 | |
| FR-002 compte-exige | Yes | WP01, WP05 | |
| FR-003 agent-titulaire-refuse | Yes | WP01, WP05 | |
| FR-004 ecriture-controlee | Yes | WP01, WP04 | |
| FR-005 revocation-a-deux | Yes | WP06 | |
| FR-006 niveau-calcule | Yes | WP01, WP05 | ratchet |
| FR-007 rotation-secret | Yes | WP02, WP07, WP08 | |
| FR-008 reemission-codes | Yes | WP02, WP08 | |
| FR-009 numero-imprime | Yes | WP02, WP09 | |
| FR-010 avis-solde-provisoire | Yes | WP03, WP09 | |
| FR-011 chaine-envoi | Yes | WP10 | |
| FR-012 sms-direct | Yes | WP10 | ratchet |
| FR-013 un-code-par-defi | Yes | WP03, WP10 | |
| NFR-001 bascules-a-l-heure | Yes | WP10 (T045) | |
| NFR-002 aucun-code-en-clair | Yes | WP02, WP07, WP10 | |
| NFR-003 piece-minimale | Yes | WP01, WP05 | |
| NFR-004 lecture-me-p95 | Yes | WP09 (T040) | |
| NFR-005 faux-refuses | Yes | WP10 (T044) | |
| C-001 à C-007 | Yes | WP09, WP06/WP11, WP10, WP04/WP11, WP01/WP11, WP05, WP02 | |

**Charter Alignment Issues:** aucune (pas de charte) ; règles de sécurité de `CLAUDE.md` couvertes (C-004, C-005, NFR-005, WP11).

**Unmapped Tasks:** aucun (WP11 rattaché à C-002, C-004, C-005 et aux SC).

**Metrics:**

- Total Requirements : 25 (13 FR, 5 NFR, 7 C)
- Total Tasks : 48 sous-tâches, 11 lots
- Coverage : 100 %
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0 (1 HIGH)

### Next Actions

- Corriger F1 (texte seulement : tasks.md, interfaces.md, WP04) avant `/spec-kitty.implement`, puis relancer `/spec-kitty.analyze`.
- F2 à F5 : corrections de texte facultatives, à faire dans le même geste.
