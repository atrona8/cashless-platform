---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: durcissements-serveur-01M7QAJD
mission_id: 01M7QAJDZWVP1GG5NT4DDYWD37
generated_at: '2026-11-18T15:08:08.096022+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/spec.md
    sha256: 49266a522d511d1168aba1733dd84b3e67509cb711ae80a934da0aff0c2a4fbb
  plan.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/plan.md
    sha256: bf4c520cb726d1adbf1fcda0407e70184fd3368f7babcc63b31a7f1c24306f7f
  tasks.md:
    path: kitty-specs/durcissements-serveur-01M7QAJD/tasks.md
    sha256: bf53b9aab8e9689e9b5eb3e11a5da514e6f4bd8910fb8e8e6d9b890567190120
  charter:
    path:
    sha256:
verdict: blocked
issue_counts:
  low: 3
  medium: 1
  high: 2
  critical: 0
  info: 0
findings:
- id: I1
  severity: high
  category: inconsistency
  summary: Spec C-006, Assumptions and Decisions still say the IBAN is encrypted with the existing key service, contradicting porteur decision 1 (config keyring in the API) recorded in plan.md.
- id: I2
  severity: high
  category: inconsistency
  summary: NFR-005 and the edge case require existing plaintext IBAN rows to be encrypted by the migration; plan IC-07 / research R-07 decide no row migration (CHECK NOT VALID, no real data before production).
- id: I3
  severity: medium
  category: inconsistency
  summary: SC-005 says 0 right added to cashless_app while NFR-003 (amended) allows narrow EXECUTE grants on DEFINER functions.
- id: I4
  severity: low
  category: inconsistency
  summary: plan.md and data-model.md place the cashless_pin role in roles.sql; WP03 creates it in post-roles.sql (sections 8b/9a model).
- id: I5
  severity: low
  category: inconsistency
  summary: Spec C-002 still allows a possible App Attest contract addition; plan settles on no contract change (verifier not wired).
- id: C1
  severity: low
  category: coverage
  summary: FR-010 is mapped to WP02 and WP09 but payout.iban encryption is delivered by WP10, which does not list FR-010 in requirement_refs.
---

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | HIGH | spec.md C-006 (l.253), Assumptions (l.288), Decisions (l.298) ; plan.md « Décisions différées » 1 | Chiffrement de l'IBAN « par le service de clés existant » dans la spec, alors que le porteur a tranché le 18/11/2026 pour une clé de configuration dans l'API. | Amender C-006, l'hypothèse et la section Decisions (décision 1, limite résiduelle). |
| I2 | Inconsistency | HIGH | spec.md NFR-005 (l.242), Edge Cases (l.200) ; plan.md IC-07 partie B ; research.md R-07 | La spec exige le chiffrement des lignes existantes par la migration ; le plan ne reprend aucune ligne (une migration SQL ne peut pas chiffrer, la clé est hors base ; aucune donnée réelle avant la production) et pose un `CHECK NOT VALID`. | Reformuler NFR-005 : « 0 écriture d'IBAN en clair acceptée par la base après la migration (contrôle `CHECK`) ; aucune donnée réelle avant la production, bases de développement recréées » ; même correction du cas limite. |
| I3 | Inconsistency | MEDIUM | spec.md SC-005 (l.280) ; NFR-003 (l.240) | SC-005 garde l'ancienne formulation « 0 droit ajouté ». | Aligner SC-005 sur NFR-003 amendé (0 droit de table ou de colonne ; `EXECUTE` en liste figée). |
| I4 | Inconsistency | LOW | plan.md IC-03 ; data-model.md « Rôle nouveau » ; WP03 | Lieu de création du rôle `cashless_pin`. | Sans effet sur le code ; WP03 fait foi, WP14 aligne la doc. |
| I5 | Inconsistency | LOW | spec.md C-002 ; plan.md Technical Context | Ajout possible au contrat pour App Attest, écarté au plan. | Garder C-002 tel quel (formulation conditionnelle) ; noter que l'ajout ne se produit pas. |
| C1 | Coverage | LOW | WP10 frontmatter ; FR-010 | `payout.iban` chiffré par WP10 sans référence à FR-010. | Ajouter FR-010 aux `requirement_refs` de WP10 (non bloquant). |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001..FR-003 lots par fonctions | Oui | T002, T003, T011, T018 | WP01, WP03, WP05 |
| FR-004 routes de lot inchangées | Oui | T020 | WP05 |
| FR-005..FR-007 processus du PIN | Oui | T010-T012, T022-T030 | WP03, WP06, WP07 |
| FR-008 vendeur dans la clé | Oui | T001, T004 | WP01 |
| FR-009 masque IBAN | Oui | T031, T033 | WP08 |
| FR-010 IBAN chiffré | Oui | T006, T032, T034, T035, T038 | voir C1 |
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
| NFR-005 rien en clair | Oui | T006, T037 | voir I2 |

**Charter Alignment Issues:** aucune charte (`.kittify/charter/` absent) ; règles normatives de `CLAUDE.md` respectées par
le plan (écarts de sécurité soumis et tranchés le 18/11/2026, aucun faux nouveau, `.sql` générés intacts).

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 21 FR, 5 NFR, 8 C, 5 SC
- Total Tasks : 56 sous-tâches, 14 lots
- Coverage : 100 % des FR et NFR ont au moins une sous-tâche
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0 (2 HIGH)

## Next Actions

- Résoudre I1, I2 et I3 par des amendements de la spec conformes aux décisions déjà prises par le porteur (aucune
  décision nouvelle), puis relancer `/spec-kitty.analyze`.
- I4, I5, C1 : non bloquants ; C1 peut être corrigé avec `map-requirements`.
