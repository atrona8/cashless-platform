---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: identite-enrolement-terminaux-01M52R6H
mission_id: 01M52R6HAZ8DFYP97C5FFTDGSY
generated_at: '2026-10-19T11:23:33.493787+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md
    sha256: ad2f9cb0106c9888d05a015fd64371fc0a21e14246ac0317c4a646905553390f
  plan.md:
    path: kitty-specs/identite-enrolement-terminaux-01M52R6H/plan.md
    sha256: e6383d7881ea7ae414a90f630b2526ff423f6c7aaccaf44f0128186826a0b568
  tasks.md:
    path: kitty-specs/identite-enrolement-terminaux-01M52R6H/tasks.md
    sha256: 96362b1fcf553d603776ad81d5cbfb0183d50d5e715751401ded28280d10b465
  charter:
    path:
    sha256:
verdict: blocked
issue_counts:
  high: 1
  critical: 0
  low: 4
  medium: 3
  info: 0
findings:
- id: U1
  severity: high
  category: underspecification
  summary: "DeviceConfig du contrat exige un objet event non nul, alors qu'un code d'enrôlement (FR-001) peut ne lier aucun événement : un terminal sans événement ne peut pas recevoir sa configuration (FR-018, US6 #1 intestable), et aucune route ne l'affecte ensuite à un événement."
- id: I1
  severity: medium
  category: inconsistency
  summary: "Numérotation des migrations : plan.md (IC-04, IC-05, structure) et contracts/database-debts.md disent 0023 consume_tap, 0024 retrait de clé, 0025 clé d'accord ; tasks.md et les WP disent 0023 jetons et nonces, 0024 consume_tap, 0025 retrait de clé, sans migration pour OP-N63."
- id: I2
  severity: medium
  category: inconsistency
  summary: SC-007 (aucune ligne des routes de la mission 4 ne change) contredit WP12 T061, qui change le décorateur de /media/auth-keys pour la borne iOS d'OP-N64.
- id: I3
  severity: medium
  category: inconsistency
  summary: "apps/api/src/errors/sqlstate-map.ts appartient à WP14, mais WP12 (avant WP14) a besoin de la traduction des refus de assert_device_active (DEVICE_SUSPENDED) et WP06 introduit un CL nouveau : propriétaire mal placé dans l'ordre des dépendances."
- id: I4
  severity: low
  category: inconsistency
  summary: 'Signature de consume_device_nonce : data-model.md (device, nonce, created) contre WP04 (p_device, p_nonce, p_created, p_tolerance_seconds) ; plan.md place device_request_nonce dans 0022, WP04 dans 0023.'
- id: C1
  severity: low
  category: coverage
  summary: WP16 T078 teste la configuration et le battement de cœur d'un terminal suspendu, servis par WP17 dont WP16 ne dépend pas ; le test est conditionnel.
- id: C2
  severity: low
  category: coverage
  summary: La matrice des preuves (WP18) couvre /media/auth-keys, servie par le processus des clés de bracelet ; startHttpsApp (WP08) ne dit pas qu'il sait démarrer ce processus en HTTPS.
- id: S1
  severity: low
  category: inconsistency
  summary: Entités clés de spec.md sans « Nonce de requête » ni « Essai d'enrôlement », présentes dans data-model.md.
---

## Specification Analysis Report

Mission `identite-enrolement-terminaux-01M52R6H` · 19/10/2026 · artefacts : `spec.md`, `plan.md`, `research.md`,
`data-model.md`, `contracts/`, `tasks.md`, 18 WP. Aucune charte (`.kittify/charter/` absent) : pas de contrôle de charte ;
les règles de `CLAUDE.md` en tiennent lieu (aucune violation trouvée).

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | HIGH | spec.md FR-001, FR-018, US6 ; openapi.yaml `DeviceConfig.required` (`event`) ; WP17 | Un terminal enrôlé sans événement ne peut pas recevoir de `DeviceConfig` conforme ; aucune route ne l'affecte ensuite | Décision du porteur : rendre `event_id` obligatoire sur un code d'enrôlement en V1 (recommandé), ou servir un refus explicite (ex. `409`) à un terminal non affecté ; reporter dans spec, contrat (WP01), WP03, WP14, WP17 |
| I1 | Inconsistency | MEDIUM | plan.md IC-04, IC-05, structure ; contracts/database-debts.md ; tasks.md (en-tête) | Deux numérotations des migrations | Aligner `plan.md` et `database-debts.md` sur `tasks.md` |
| I2 | Inconsistency | MEDIUM | spec.md SC-007 ; WP12 T061 ; ADR-106 | La borne iOS change une ligne d'une route de la mission 4 | Préciser SC-007 : « hors la borne iOS d'OP-N64 » |
| I3 | Inconsistency | MEDIUM | WP14 (owned `errors/sqlstate-map.ts`) ; WP03 T011 ; WP04 T019 ; WP06 T025 ; WP12 | La carte SQLSTATE est possédée par un lot qui vient après ceux qui en ont besoin | Donner `sqlstate-map.ts` à WP12 (ou WP08) et y regrouper les `CL` de WP03, WP04, WP06 |
| I4 | Inconsistency | LOW | data-model.md (Fonctions, Nonce) ; plan.md structure ; WP04 T018 | Signature et migration de la table des nonces divergentes | Aligner `data-model.md` et `plan.md` sur WP04 |
| C1 | Coverage | LOW | WP16 T078 ; WP17 | Test conditionnel à la fusion de WP17 | Déplacer ce cas dans WP17 (T082) ou WP18 |
| C2 | Coverage | LOW | WP08 T039 ; WP18 T083 | Démarrage HTTPS du processus des clés en test non précisé | Préciser dans WP08 T039 que `startHttpsApp` accepte le module racine du processus |
| S1 | Inconsistency | LOW | spec.md Key Entities ; data-model.md | Deux entités absentes de la spec | Ajouter les deux entités à la spec |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 code d'enrôlement | Oui | WP03 T011, WP13 T064, WP14 T066 | voir U1 (événement facultatif) |
| FR-002 refus `PAIRED_TPE` | Oui | WP03 T011-T012, WP14 T068 | |
| FR-003 enrôlement | Oui | WP03 T012, WP14 T068 | |
| FR-004 consommation atomique | Oui | WP03 T012, WP14 T068, T070 | |
| FR-005 attestation Android | Oui | WP10 | |
| FR-006 attestation iOS | Oui | WP11 | limite OP-N64 |
| FR-007 `serial` et ré-enrôlement | Oui | WP03 T010, T012 | |
| FR-008 clé d'accord à l'enrôlement | Oui | WP03 T012, WP07 T032 | |
| FR-009 certificat client | Oui | WP09 T041, WP08 T037 | |
| FR-010 jeton lié | Oui | WP09 T043 | |
| FR-011 rafraîchissement | Oui | WP04 T016, WP15 | |
| FR-012 trois preuves | Oui | WP12 T056-T058 | |
| FR-013 identité derrière le port | Oui | WP12 T059, T062 | voir I2 |
| FR-014 statut relu | Oui | WP04 T019, WP12 T058 | |
| FR-015 suspension, réactivation | Oui | WP03 T013, WP16 T076 | |
| FR-016 révocation | Oui | WP03 T013, WP16 T076 | |
| FR-017 liste et fiche | Oui | WP16 T075 | |
| FR-018 configuration | Oui | WP17 T079-T080 | voir U1 |
| FR-019 battement de cœur | Oui | WP03 T013, WP17 T081 | |
| FR-020 OP-N59 | Oui | WP02, WP07 T031 | |
| FR-021 OP-N44 | Oui | WP07 T029-T030 | |
| FR-022 OP-N50 | Oui | WP05 | |
| FR-023 OP-N54 | Oui | WP13 T063 | |
| FR-024 OP-N62 | Oui | WP06 | |
| FR-025 audit | Oui | WP14 T069, WP16 T077, WP15 T073 | |
| FR-026 contrat | Oui | WP01 | |
| NFR-001 à NFR-011 | Oui | WP08, WP09, WP12, WP14, WP17, WP18 | NFR-009 mesuré en local seulement |

**Charter Alignment Issues:** aucune charte. Règles de `CLAUDE.md` : écarts de sécurité consignés (OP-N64, OP-N65), aucun
faux en production (NFR-001, WP08, WP09, WP12), fichiers générés modifiés par leurs générateurs seulement (WP07).

**Unmapped Tasks:** aucune (chaque sous-tâche est rattachée à un lot qui porte au moins une exigence).

**Metrics:**

- Total Requirements : 49 (26 FR, 11 NFR, 12 C)
- Total Tasks : 87 sous-tâches dans 18 lots
- Coverage % : 100 % des FR et des NFR ont au moins une sous-tâche
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0 (1 HIGH)

## Next Actions

- U1 (HIGH) est à trancher avant l'implémentation : c'est une décision de produit (le terminal sans événement), pas de
  sécurité. Recommandation : `event_id` obligatoire sur le code d'enrôlement en V1 ; puis mise à jour de `spec.md`
  (FR-001), `contracts/enrollment.md`, WP01, WP03, WP14, WP17.
- I1 à I3 (MEDIUM) : retouches de `plan.md`, `contracts/database-debts.md`, `spec.md` (SC-007) et de la propriété de
  `sqlstate-map.ts` (WP12) — sans changement de fond.
- LOW : à corriger dans la même passe si le porteur le souhaite.
