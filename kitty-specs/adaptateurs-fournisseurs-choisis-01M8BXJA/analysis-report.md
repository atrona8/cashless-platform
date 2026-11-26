---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
mission_id: 01M8BXJA32Q43G7G9PBG231J2X
generated_at: '2026-11-26T13:27:46.367728+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/spec.md
    sha256: eba4a61c348370e8343dbe1bccc96c75e2dd3d30379109a43109a741d348da95
  plan.md:
    path: kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/plan.md
    sha256: 72148d479228caeb6835df592c92bbeb1a49b1ab55c35d1e8fde0c56137f6426
  tasks.md:
    path: kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/tasks.md
    sha256: d50c3ea6a46fdd18a58dc3f2e093664a7a0effd94410ebacfaf325988c0625c4
  charter:
    path:
    sha256:
verdict: blocked
issue_counts:
  low: 3
  critical: 0
  high: 1
  medium: 4
  info: 0
findings:
- id: I1
  severity: high
  category: inconsistency
  summary: 'Mode par défaut en production : défaut fake + « fake refusé en production » contredit le comportement actuel (PSP indisponible, démarrage permis) repris par WP10 T044.'
- id: I2
  severity: medium
  category: inconsistency
  summary: "PspSecretBinding sans fournisseur : WP08 exige le contrôle du fournisseur mais renvoie à une retouche hors carte d'un fichier de WP02."
- id: C1
  severity: medium
  category: coverage
  summary: NFR-005 (aucun double crédit, pour chaque PSP) n'est testé qu'avec le faux signal (WP03).
- id: C2
  severity: medium
  category: coverage
  summary: Cas limite « coffre ou KMS indisponible au démarrage » sans sous-tâche.
- id: U1
  severity: medium
  category: underspecification
  summary: 'FR-006 : « au montant et à la devise confirmés par PayDunya » alors que la confirmation ne rend pas de devise (WP06 force XOF).'
- id: L1
  severity: low
  category: underspecification
  summary: "Borne d'une relecture par recharge et par minute tenue en mémoire de chaque processus : multipliée par le nombre d'instances."
- id: L2
  severity: low
  category: coverage
  summary: C-006 (fichiers générés intacts) attribué à WP13 sans vérification explicite.
- id: L3
  severity: low
  category: underspecification
  summary: La garde réseau de WP01 peut casser des suites existantes qui appellent le réseau ; seule la consigne « signaler » est prévue.
---

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | HIGH | contracts/production-guard.md §2 ; data-model.md (tableau des réglages) ; interfaces.md §2 ; WP10 T044 | Défaut `fake` partout ; en production `fake` → refus. Un déploiement qui ne pose pas `PSP_ADAPTERS` refuserait de démarrer, alors qu'aujourd'hui la production démarre avec les PSP indisponibles ; WP10 T044 dit « comportement actuel » | Règle unique : en production, réglage absent = `real` ; `fake` posé explicitement → refus ; `real` hors liste → PSP et coffre indisponibles (actuel), KMS et copie refusent (actuel) |
| I2 | Inconsistency | MEDIUM | interfaces.md §4 ; WP08 T034 ; WP03 T012 | `PspSecretBinding` ne porte pas le fournisseur | Ajouter `provider: PspProviderName` à `PspSecretBinding` dans WP02 ; WP03 le passe |
| C1 | Coverage | MEDIUM | spec NFR-005 ; WP03 T015 ; WP05, WP07 | Double crédit testé seulement avec le faux signal | Test de 100 notifications identiques par PSP réel (Wave, Stripe : notification ; PayDunya : signal) contre le faux serveur, en WP03 ou dans les lots d'adaptateurs |
| C2 | Coverage | MEDIUM | spec Edge Cases ; WP10 | Indisponibilité du coffre ou de KMS au démarrage non traitée | WP10 : vérifier et tester que le comportement est celui du faux actuel (coffre : refus neutre à l'usage ; KMS : erreur à l'usage, pas au démarrage), sans appel au démarrage |
| U1 | Underspecification | MEDIUM | spec FR-006 ; WP06 T026 | Devise non rendue par PayDunya | Préciser : devise = celle de la configuration (XOF), montant = celui confirmé ; noter « à confirmer à l'essai » |
| L1 | Underspecification | LOW | research R-07 ; WP03 T014 | Borne en mémoire par processus | Consigner la limite (WP13) |
| L2 | Coverage | LOW | spec C-006 ; WP13 | Pas de vérification nommée | WP13 : `npm run check:generated` (ou équivalent) dans les preuves |
| L3 | Underspecification | LOW | WP01 T004 | Suites existantes qui appellent le réseau | Garder la consigne : signaler sans affaiblir ; l'orchestrateur décide |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 port fidèle | Oui | T006-T011 | WP02, WP03 |
| FR-002 session Wave | Oui | T019 | |
| FR-003 notification Wave | Oui | T020, T023 | |
| FR-004 statut/annulation/relevé Wave | Oui | T021, T022 | |
| FR-005 facture PayDunya | Oui | T024 | |
| FR-006 signal PayDunya | Oui | T025, T026, T012-T015 | U1 |
| FR-007 paiement Stripe | Oui | T029 | |
| FR-008 notification/statut/relevé Stripe | Oui | T030-T032 | |
| FR-009 coffre | Oui | T034-T037 | I2 |
| FR-010 KMS | Oui | T038-T040 | |
| FR-011 S3 | Oui | T041 | |
| FR-012 attestations | Oui | T052-T054 | no-op permis |
| FR-013 garde | Oui | T043-T045 | I1 |
| FR-014 essais | Oui | T048-T051 | |
| FR-015 paramètres à poser | Oui | T057 | |
| FR-016 non décidés inchangés | Oui | T043 (OUT_OF_SCOPE), T044 | |
| NFR-001 à NFR-004 | Oui | T003-T005, T010, T023, T028, T033 | |
| NFR-005 crédit unique | Partiel | T015 | C1 |
| C-001 à C-006 | Oui | T016-T018, T045, T055, T001, T040 | L2 |

**Charter Alignment Issues:** charte absente (`.kittify/charter/charter.md` introuvable) ; règles du porteur (CLAUDE.md) vérifiées : écart D2 consigné (WP06 test de borne, WP13 OP/ADR), aucun faux en production (WP10), dette nommée (WP13).

**Unmapped Tasks:** aucune.

**Metrics:** 16 FR, 5 NFR, 6 C, 4 SC ; 59 sous-tâches, 13 lots ; couverture 100 % (NFR-005 partielle) ; ambiguïtés 2 ; doublons 0 ; critiques 0.

**Next Actions:** corriger I1 (bloquant), puis I2, C1, C2, U1 (texte de `interfaces.md`, contrats, prompts WP02, WP03, WP06, WP10 et spec FR-006), puis relancer `/spec-kitty.analyze`.
