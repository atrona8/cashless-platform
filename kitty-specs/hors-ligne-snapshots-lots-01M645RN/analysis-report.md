---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: hors-ligne-snapshots-lots-01M645RN
mission_id: 01M645RN3VGKZB9AD4NQ9GJJS6
generated_at: '2026-10-30T11:17:49.964524+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/hors-ligne-snapshots-lots-01M645RN/spec.md
    sha256: 4ea8747029654b0e54ee16dd8905e173e06fe5b6f2c8a9e49863abf79d95bcd7
  plan.md:
    path: kitty-specs/hors-ligne-snapshots-lots-01M645RN/plan.md
    sha256: ad9bc5dacd8aa9926723c33a6d6ebd4d4044e236f076b36b50408d669ee55508
  tasks.md:
    path: kitty-specs/hors-ligne-snapshots-lots-01M645RN/tasks.md
    sha256: 7aed50d91fd97a6ed2efe6ccca92aa858e55817a5e8fe850878b4e1072a15b53
  charter:
    path:
    sha256:
verdict: ready
issue_counts:
  medium: 7
  high: 0
  low: 5
  critical: 0
  info: 0
findings:
- id: I1
  severity: medium
  category: inconsistency
  summary: FR-033 demande de traiter un numéro > 2^53 ; R-14 et interfaces.md fixent MAX_DEVICE_SEQ = 2^53−1 et refusent au-delà (422).
- id: I2
  severity: medium
  category: inconsistency
  summary: openapi.yaml (importDeviceJournal) rend le résultat d'import à l'exécution de l'approbation ; R-30.10 traite l'import en asynchrone (travailleur journal-import) ; WP01 ne liste pas cette correction.
- id: I3
  severity: medium
  category: inconsistency
  summary: DeviceConfig.snapshot_keys[].not_after obligatoire au contrat alors qu'une clé ACTIVE n'a pas de date de fin (snapshot_public_keys rend NULL).
- id: I4
  severity: medium
  category: inconsistency
  summary: data-model.md et R-11 décrivent encore complete_offline_batch avec un numéro « retryable dans p_results » ; R-30.11 et interfaces.md exigent une ligne offline_batch_retry.
- id: U1
  severity: medium
  category: underspecification
  summary: 'Table de conflit (§7.3) sans ligne pour les supports RETIRED, REPLACED, RELEASED, lot BATCH_INACTIVE : WP17 les traite en manque entier, choix non inscrit dans spec/research.'
- id: U2
  severity: medium
  category: underspecification
  summary: "WP07 (offline_device_exposure) : source du montant d'une vente non fixée (posting ou sale_line) ; heure de blocage d'un vendeur peut-être non datée."
- id: O1
  severity: medium
  category: ownership
  summary: "Retouches hors carte sur des fichiers possédés par d'autres lots ou sans propriétaire : bootstrap.ts (WP09) par WP18/WP20, ledger-tests.yml (WP21) et migrate.ts, test-pgtap.sh par WP08 : conflits possibles entre lanes."
- id: C1
  severity: low
  category: coverage
  summary: Tests §13-4 et §13-5 (bascule EDGE) reportés en mission 8 (R-30.13) alors que FR-044 renvoie à sync_protocol.md §13 sans exclusion explicite.
- id: D1
  severity: low
  category: drift
  summary: Numéros de migration de data-model.md (0044-0046) différents d'interfaces.md § 1 (0045-0048) ; pointeur ajouté mais tables non renumérotées.
- id: D2
  severity: low
  category: drift
  summary: "research.md R-18 parle d'un processus « snapshots » unique, R-12 d'une exposition à occurred_at − 120 s, R-10 d'un ordre de contrôles différent de batches.md : remplacés par R-30 et les contrats."
- id: D3
  severity: low
  category: drift
  summary: "sync_protocol.md §5.4, §7.5, §8, §11 cas 22 et 39 et SPECIFICATION §9 décrivent encore la recharge espèces hors ligne (ADR-137 : à mettre en accord) ; aucun lot n'en porte la retouche."
- id: S1
  severity: low
  category: style
  summary: Plusieurs prompts (WP03 à WP06, WP19) ont des lignes de plus de 100 caractères ; tasks.md n'a pas de ligne Goal pour WP04 à WP21.
---

## Specification Analysis Report — mission 7 (`hors-ligne-snapshots-lots-01M645RN`)

Charte : aucun fichier `.kittify/charter/charter.md` ; normes appliquées : `CLAUDE.md` (règles 1 à 4 de sécurité,
priorité SPECIFICATION §0.3, `.sql` générés intouchables). Aucune violation relevée : les écarts de sécurité
connus ont leur décision du porteur, leur ADR (137 à 140) et leur point ouvert (OP-N89 à OP-N91).

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | MEDIUM | spec.md FR-033 ; research.md R-14 ; interfaces.md § 8 | « Numéro > 2^53 traité » contre maximum 2^53−1 refusé | Lire FR-033 comme « sans perte de précision : refus exact au-delà de 2^53−1 » ; préciser FR-033 |
| I2 | Inconsistency | MEDIUM | openapi.yaml l.1107-1137, l.14280 ; R-30.10 ; WP01 | Résultat d'import synchrone au contrat, asynchrone au plan | Ajouter à WP01 T002 : `result` = import accepté (`PROCESSING`) et lieu de lecture du résultat final |
| I3 | Inconsistency | MEDIUM | openapi.yaml `DeviceConfig.snapshot_keys` ; interfaces.md § 3 ; WP15 | `not_after` requis, NULL pour une clé `ACTIVE` | WP01 : `not_after` nullable, ou WP15 sert une date calculée ; trancher dans WP01 |
| I4 | Inconsistency | MEDIUM | data-model.md `offline_batch` ; research.md R-11 | Règle de clôture ancienne | Mettre data-model.md au niveau de R-30.11 (WP05 suit déjà R-30.11) |
| U1 | Underspecification | MEDIUM | contracts/compliance.md ; WP17 | États de support absents de la table de conflit | Inscrire « manque entier » pour ces états dans compliance.md (choix prudent déjà retenu) |
| U2 | Underspecification | MEDIUM | WP07 T031 ; R-30.3 | Montant d'une vente pour l'exposition | Fixer la source (lignes `posting` du portefeuille) avant WP07 |
| O1 | Ownership | MEDIUM | WP08, WP18, WP20, WP21 | Retouches hors carte de fichiers d'autres lots | Les ordonner : WP18 après WP09 (déjà), WP08 seul sur `migrate.ts`/`test-pgtap.sh`, WP21 reprend `ledger-tests.yml` en dernier |
| C1 | Coverage | LOW | spec.md FR-044 ; R-30.13 ; WP21 | §13-4/5 hors mission | Mentionner l'exclusion dans FR-044 ; report en mission 8 déjà prévu |
| D1 | Drift | LOW | data-model.md | Numérotation | `interfaces.md` § 1 fait foi (pointeur en tête) |
| D2 | Drift | LOW | research.md R-10, R-12, R-18 | Décisions remplacées | R-30 et contrats font foi (déclaré en tête de research.md) |
| D3 | Drift | LOW | sync_protocol.md ; SPECIFICATION §9 | Recharge espèces hors ligne encore décrite | Retouche documentaire à confier (WP21 ou addendum docs) |
| S1 | Style | LOW | tasks/WP03-06, WP19 ; tasks.md | Lignes longues ; Goal manquants | Sans effet sur l'exécution |

**Coverage Summary Table**

| Requirement | Has Task? | WPs | Notes |
|---|---|---|---|
| FR-001 à FR-005 (politique, risque, historique, configurations) | Oui | WP02, WP07, WP14, WP15 | |
| FR-006 à FR-011 (snapshots) | Oui | WP03, WP04, WP11, WP12, WP13, WP15, WP07 | |
| FR-012 (vendeur hors ligne) | Oui | WP07 | |
| FR-013 à FR-030 (lots, traitement, conflit, conformité) | Oui | WP16 à WP19, WP02 (FR-027) | I1 sur FR-033 |
| FR-031 à FR-036 (trous, import, sonde) | Oui | WP05, WP06, WP13, WP16, WP20, WP21 | I2 sur FR-035 |
| FR-037 à FR-041 (clés, droits, maintenance, bornes) | Oui | WP04, WP08, WP09, WP10 | |
| FR-042 à FR-044 (contrat, audit, tests §13) | Oui | WP01, WP13, WP14, WP21 | C1 |
| NFR-001 à NFR-015 | Oui | WP02, WP03, WP05, WP08, WP09, WP11, WP12, WP18, WP19, WP21 | NFR-003/004 sous `SKIP_LATENCY`, à lancer avant l'accept |

**Unmapped Tasks** : aucune (T001 à T091 rattachées à un lot qui porte au moins une exigence).

**Metrics**
- Exigences : 44 FR + 15 NFR + 14 contraintes ; sous-tâches : 91 ; lots : 21.
- Couverture : 100 % des FR et NFR (44/44 FR enregistrées par `map-requirements`).
- Ambiguïtés : 3 (I1, U1, U2) ; duplications : 0 ; constats critiques : 0 ; élevés : 0.

### Next Actions
- Aucun constat bloquant : l'implémentation peut démarrer (`spec-kitty next --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`).
- Conseillé avant WP01/WP05/WP07 : corriger I2 et I3 dans WP01, I4 dans data-model.md, U2 avant WP07 ; ces
  retouches de planification rendent le rapport périmé et demandent une nouvelle analyse.
