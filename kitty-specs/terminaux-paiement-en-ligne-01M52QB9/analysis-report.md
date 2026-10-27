---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: terminaux-paiement-en-ligne-01M52QB9
mission_id: 01M52QB9R4QT2EBDG1H74DGHRT
generated_at: '2026-10-22T15:11:04.026168+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/terminaux-paiement-en-ligne-01M52QB9/spec.md
    sha256: 59beb148ad6883f5fe47a29e2ea455428057fc1d6fc2dced8e36979204750f5e
  plan.md:
    path: kitty-specs/terminaux-paiement-en-ligne-01M52QB9/plan.md
    sha256: 835ad50d7265ed50c97592c96bc695448df00c2e6b84094901cc815dec379f9a
  tasks.md:
    path: kitty-specs/terminaux-paiement-en-ligne-01M52QB9/tasks.md
    sha256: 9ad5a0c1c3a003cbf65764be5c4d70b4162ef83412e39cf906833888cd18475a
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  high: 0
  critical: 0
  low: 3
  medium: 10
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: Codes du contrat existant (REVERSAL_NOT_ALLOWED 422, REVERSAL_WINDOW_EXPIRED 409, QR_TOKEN_INVALID 422) contredisent data-model.md et les fiches payments.md / qr-payments.md.
- id: I2
  severity: medium
  category: inconsistency
  summary: FR-004 (bloqué après 5 PIN faux) contre « compter d'abord » de vendors.md (4 faux puis le bon PIN bloquent) ; le contrat est plus strict.
- id: I3
  severity: medium
  category: inconsistency
  summary: "vendors.md : un renvoi de la même clé « refait l'essai » ; openapi-additions.md et l'option transient : 409."
- id: I4
  severity: medium
  category: inconsistency
  summary: openapi-additions.md pose x-process sur les routes servies ; media-isolation.spec.ts traite toute opération marquée comme une opération des bracelets.
- id: I5
  severity: medium
  category: inconsistency
  summary: payments.md appelle record_device_seq « en premier » alors que la fonction exige l'issue et la transaction, connues en fin de requête.
- id: I6
  severity: medium
  category: inconsistency
  summary: FR-017 réserve l'annulation hors fenêtre au SUPERVISOR ; le contrat permet aussi à un ORGANIZER_ADMIN de demander SALE_REVERSAL (approbation à deux).
- id: I7
  severity: medium
  category: inconsistency
  summary: FR-024 « sans rien écrire » contre ADR-117 (audit de tous les refus d'enrôlement).
- id: U1
  severity: medium
  category: underspecification
  summary: Fonctions payment_request_for_token et check_sale_lines nécessaires (WP05, WP13) mais absentes de data-model.md et database-rights.md.
- id: U2
  severity: medium
  category: underspecification
  summary: X-Authority-Epoch facultatif au schéma mais « DOIT » dans le texte du contrat ; refus en cas d'absence non spécifié.
- id: C1
  severity: medium
  category: coverage
  summary: FR-021 à FR-023 reportés à la mission 10 mais rattachés à WP07 pour le seul contrôle de couverture ; risque de les compter comme livrés.
- id: U3
  severity: low
  category: underspecification
  summary: FR-024 parle d'un point de vente supprimé ; la base n'a aucune suppression de point de vente (déjà signalé au plan, R-09).
- id: C2
  severity: low
  category: coverage
  summary: Les SC ne sont pas traçables comme requirement_refs (retirés par finalize-tasks) ; leur suivi repose sur la matrice d'acceptation.
- id: I8
  severity: low
  category: inconsistency
  summary: Le plan place l'annulation dans apps/api/src/payments/ ; tasks.md et WP12 la placent dans apps/api/src/reversals/.
---

## Specification Analysis Report

Mission `terminaux-paiement-en-ligne-01M52QB9` · 22/10/2026 · sources : `spec.md`, `plan.md`, `tasks.md`, `contracts/`,
`data-model.md`, les 14 prompts de lots. Pas de charte dans le projet (`CLAUDE.md` et `docs/SPECIFICATION.md` en
tiennent lieu) : aucun constat de charte.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | `openapi.yaml` ; `data-model.md` (codes CL036) ; `contracts/payments.md:69` ; `contracts/qr-payments.md` | Statuts et codes du contrat existant différents de ceux des fiches | §0.3 : le contrat prime (arbitrage WP01) ; corriger `data-model.md` et les fiches après WP01 |
| I2 | Inconsistency | MEDIUM | `spec.md` FR-004 ; `contracts/vendors.md` | Le 5e essai compté d'abord bloque même avec le bon PIN | Plus strict : garder le contrat, consigner l'écart (arbitrage WP02) |
| I3 | Inconsistency | MEDIUM | `contracts/vendors.md` ; `contracts/openapi-additions.md` | Renvoi de la même clé : nouvel essai ou `409` | `409` avec clé UUID (arbitrage WP01, WP09) ; corriger `vendors.md` |
| I4 | Inconsistency | MEDIUM | `contracts/openapi-additions.md` ; `apps/api/test/integration/end-to-end/media-isolation.spec.ts` | `x-process` casse le décompte des opérations des bracelets | Aucun `x-process` sur la 5b, comme la 5a (arbitrage WP01) ; consigner |
| I5 | Inconsistency | MEDIUM | `contracts/payments.md` | Ordre de `record_device_seq` impossible tel qu'écrit | Terminal pris `FOR UPDATE` en premier, `record_device_seq` en fin de transaction (arbitrage WP11) |
| I6 | Inconsistency | MEDIUM | `spec.md` FR-017 ; `openapi.yaml` (`SALE_REVERSAL`) | `ORGANIZER_ADMIN` admis à demander par le contrat, pas par la spec | §0.3 : le contrat prime (approbation à deux gardée) ; signalé au porteur |
| I7 | Inconsistency | MEDIUM | `spec.md` FR-024 ; ADR-117 | Refus d'enrôlement non audité si « rien écrit » est pris à la lettre | Audit du refus gardé (renforcement, arbitrage WP06) |
| U1 | Underspecification | MEDIUM | `data-model.md` ; `contracts/database-rights.md` | Deux fonctions nécessaires non décrites | Créées par WP03 et WP05, accordées par WP07 (arbitrages) ; compléter les fiches |
| U2 | Underspecification | MEDIUM | `openapi.yaml` (`X-Authority-Epoch`) | Absence de l'en-tête : comportement non fixé | Refus sur les routes de paiement (plus strict, arbitrage WP11) |
| C1 | Coverage | MEDIUM | `tasks/WP07-droits-base.md` | FR-021 à FR-023 rattachés pour la couverture seulement | Laisser « Deferred » dans la matrice d'acceptation, jamais « pass » |
| U3 | Underspecification | LOW | `spec.md` FR-024 | « Point de vente supprimé » sans suppression en base | Déjà traité au plan (R-09) |
| C2 | Coverage | LOW | `tasks/WP06`, `tasks/WP14` | SC non traçables en `requirement_refs` | Suivi des SC dans `acceptance-matrix.json`, tenu au fil des lots |
| I8 | Inconsistency | LOW | `plan.md` (Project Structure) ; `tasks.md` ; WP12 | Chemin de l'annulation | Écart de répartition sans effet de sécurité, consigné dans WP12 |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 à FR-006 (vendeurs, PIN, sessions, attribution) | Oui | T006-T010, T039-T043, T016 | WP02, WP09, WP04 |
| FR-007, FR-008, FR-011, FR-012 (catalogue, lignes) | Oui | T011-T015, T044-T047 | WP03, WP10 |
| FR-009, FR-010, FR-013, FR-014, FR-015, FR-025 (paiement) | Oui | T017, T048-T054 | WP04, WP08, WP11 |
| FR-016, FR-017 (annulation) | Oui | T018, T019, T055-T060 | WP04, WP12 |
| FR-018 à FR-020 (QR) | Oui | T021-T024, T050, T061-T065 | WP05, WP11, WP13 |
| FR-021 à FR-023 (identification) | Reporté | T028 | Mission 10 ; WP07 retire seulement les écritures directes |
| FR-024 (OP-N74) | Oui | T025-T027 | WP06 |
| FR-026 (audit) | Oui | WP02, WP03, WP09, WP10 | |
| FR-027 (contrat) | Oui | T001-T005 | WP01 |
| NFR-001 | Oui | T069 | WP14 (et WP11) |
| NFR-002 à NFR-004 | Oui | T032-T033, T041, T068 | WP08, WP09, WP14 |
| NFR-005, NFR-006 | Oui | T020, T024, T054, T070 | WP04, WP05, WP11, WP14 |
| NFR-007, NFR-008 | Oui | T030, T067, T068 | WP07, WP14 |
| NFR-009, NFR-010 | Oui | T033, T069 | WP08, WP14 |
| C-001 à C-011 | Oui | réparties | C-005, C-006 : hors périmètre, aucun lot requis |

**Charter Alignment Issues:** aucune (pas de charte) ; règles de `CLAUDE.md` reprises dans chaque lot.

**Unmapped Tasks:** aucune.

**Metrics:**

- Total Requirements : 27 FR, 10 NFR, 11 C (48)
- Total Tasks : 72 (14 lots)
- Coverage : 24/24 FR dans la mission (100 %) ; FR-021 à FR-023 reportés
- Ambiguity Count : 2 (U2, U3)
- Duplication Count : 0
- Critical Issues Count : 0

**Next Actions:** aucun constat bloquant ; l'implémentation peut démarrer. Corriger `data-model.md` et les fiches de
contrat (I1, I3, U1) au fil des lots, sans retoucher `spec.md`, `plan.md` ni `tasks.md` pendant l'implémentation
(rapport périmé sinon). I6 est signalé au porteur.
