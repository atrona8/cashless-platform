---
schema_version: 1
artifact_type: spec-kitty.analysis-report
command: /spec-kitty.analyze
mission_slug: bracelets-nfc-01M4TD3W
mission_id: 01M4TD3WS72DHMSH9TB2TS5E8W
generated_at: '2026-10-13T12:14:41.056265+00:00'
analyzer_agent: unknown
input_artifacts:
  spec.md:
    path: kitty-specs/bracelets-nfc-01M4TD3W/spec.md
    sha256: 1d065a9ae6af9d47c09c8d75cc4b2a5efb90da7e1e9f916694caaf840ad431c4
  plan.md:
    path: kitty-specs/bracelets-nfc-01M4TD3W/plan.md
    sha256: 91eedf75ae49edabb90b50f424d01be377a5a7aa3285f4839bec1b5def031e24
  tasks.md:
    path: kitty-specs/bracelets-nfc-01M4TD3W/tasks.md
    sha256: 84c83068512c038e1bfd7707cb613396afd32823d6e8c1003af726962e1a6f1b
  charter:
    path:
    sha256:
verdict: blocked
issue_counts:
  medium: 4
  critical: 0
  low: 3
  high: 1
  info: 0
findings:
- id: U1
  severity: high
  category: underspecification
  summary: "Le processus de personnalisation n'a pas le droit de déchiffrer une clé de données : le plan ne dit pas comment il scelle le mot de passe d'un nouveau bracelet sous la clé de données active."
- id: I1
  severity: medium
  category: inconsistency
  summary: La décision 5 (clé de données en clair dans le seul processus des clés) peut être contredite par la solution retenue pour U1.
- id: U2
  severity: medium
  category: underspecification
  summary: Aucune sorte d'anomalie de la liste fermée (§12.2) n'est désignée pour un écart du contrôle quotidien.
- id: U3
  severity: medium
  category: underspecification
  summary: Les routes existantes listMyMedia et reportMyMediaLost ne sont rattachées à aucune exigence de la spec ; le WP17 les sert « si elles tiennent dans le périmètre ».
- id: C1
  severity: medium
  category: coverage
  summary: Les exigences non fonctionnelles et les contraintes ne figurent pas dans requirement_refs des lots ; leur couverture n'est lisible que dans le texte des prompts.
- id: U4
  severity: low
  category: underspecification
  summary: La création d'un portefeuille anonyme à l'activation peut exiger une fonction de base ; le WP15 prévoit alors de retoucher la migration 0013, propriété du WP05.
- id: I2
  severity: low
  category: inconsistency
  summary: Le plan parle de quatre processus alors qu'il y a cinq points d'entrée (la commande d'administration).
- id: U5
  severity: low
  category: underspecification
  summary: Le générateur de types Dart n'est pas éprouvé sur le contrat OpenAPI 3.1 ; un repli est prévu mais non vérifié.
---

## Specification Analysis Report

Mission `bracelets-nfc-01M4TD3W` — analyse du 2026-10-13, après `/spec-kitty.tasks` (20 lots, 87 sous-tâches).
Aucune charte dans le projet ; les règles de `CLAUDE.md` en tiennent lieu (sources normatives, §0.3, écarts de sécurité).

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | HIGH | plan.md IC-09 ; research.md R-04 ; contracts/key-services.md ; tasks/WP13 (sous-tâche « Clé de données pour la personnalisation ») ; SPECIFICATION §3.2, §7.4 | La personnalisation a `GenerateMac` et `GenerateDataKey`, pas `Decrypt`. Elle ne peut donc pas rouvrir la clé de données active d'un index pour sceller un nouveau mot de passe. Le plan (CREATE_DEK puis clair mis à zéro) rend la personnalisation impossible telle quelle. | Décision du porteur requise avant le WP13 (règle C-011) : (A) une clé de données par session de personnalisation, obtenue par `GenerateDataKey` et gardée en mémoire le temps de la session ; (B) donner `Decrypt` à la personnalisation ; (C) faire sceller par le processus des clés. Puis corriger research R-04/R-05, key-services, data-model, WP11 et WP13. |
| I1 | Inconsistency | MEDIUM | research.md R-05 ; spec.md NFR-003 | NFR-003 et R-05 disent qu'une clé de données en clair ne vit que dans le processus des clés. L'option A de U1 en fait vivre une dans le processus de personnalisation. | Aligner NFR-003 et R-05 sur la décision prise pour U1. |
| U2 | Underspecification | MEDIUM | data-model.md (0012) ; tasks/WP19 | Un écart du contrôle quotidien doit « alerter », mais aucune sorte d'anomalie existante ne lui correspond clairement. | Laisser le WP19 soumettre le choix au porteur (déjà prévu) ou le trancher maintenant. |
| U3 | Underspecification | MEDIUM | tasks/WP17 ; spec.md FR-030 à FR-033 | `listMyMedia` et `reportMyMediaLost` existent au contrat mais ne sont couvertes par aucune FR. | Décider : dans la mission (ajouter une FR) ou laissées à la mission 10 (le dire dans la spec). |
| C1 | Coverage | MEDIUM | tasks/WP*.md (frontmatter) | `requirement_refs` ne porte que des FR ; NFR-001 à NFR-010 et C-001 à C-012 sont couvertes dans le texte (voir tableau) mais pas tracées. | Acceptable ; le WP20 vérifie chaque NFR. Ajouter les NFR aux refs si une traçabilité outillée est voulue. |
| U4 | Underspecification | LOW | tasks/WP15 ; WP05 | Retouche possible de la migration 0013 hors du lot propriétaire. | Annoncée comme retouche hors carte ; à défaut, créer une migration 0014. |
| I2 | Inconsistency | LOW | plan.md Summary, IC-06 | « Quatre processus » pour cinq points d'entrée. | Dire « quatre processus et une commande » partout (déjà le cas dans IC-06). |
| U5 | Underspecification | LOW | research.md R-10 ; tasks/WP07 | Outil de génération Dart non éprouvé sur ce contrat. | Essai en début de WP07, repli documenté. |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs / lots | Notes |
|-----------------|-----------|-----------------|-------|
| FR-001 à FR-005 (bibliothèques) | Oui | WP01, WP02 | Vecteurs du kit et test croisé |
| FR-006 (service de clés substituable) | Oui | WP08, WP09 | |
| FR-007 à FR-009 (clés) | Oui | WP04, WP10, WP11 | |
| FR-010 (contrôle quotidien) | Oui | WP04, WP19 | U2 |
| FR-011 à FR-015 (lots, codes) | Oui | WP03, WP05, WP12 | |
| FR-016, FR-017 (personnalisation) | Oui | WP05, WP12, WP13 | **U1** |
| FR-018 à FR-020 (mot de passe, lecture) | Oui | WP14 | |
| FR-021 à FR-024 (activation, caution, consultation) | Oui | WP15 | U4 |
| FR-025 à FR-028 (retour) | Oui | WP16 | |
| FR-029 (liste noire) | Oui | WP04, WP05, WP18 | |
| FR-030 à FR-033 (rattachement) | Oui | WP03, WP17 | U3 |
| FR-034 (identités substituables) | Oui | WP08, WP20 | |
| FR-035 (audit) | Oui | WP05, WP10, WP18, WP20 | |
| FR-036 (contrat) | Oui | WP07, WP20 | U5 |
| NFR-001 | Oui | WP01, WP02, WP20 | |
| NFR-002, NFR-003 | Oui | WP11, WP12, WP13, WP14, WP20 | I1 |
| NFR-004, NFR-005 | Oui | WP06, WP09, WP20 | |
| NFR-006, NFR-007, NFR-008 | Oui | WP20, WP17, WP11/WP12 | |
| NFR-009, NFR-010 | Oui | tous, WP08/WP09 | |
| C-011, C-012 | Oui | tous les prompts, WP08, WP20 | |

**Charter Alignment Issues:** sans objet (pas de charte). Règle de `CLAUDE.md` sur les écarts de sécurité : U1 en relève directement.

**Unmapped Tasks:** aucune ; les 87 sous-tâches appartiennent chacune à un lot.

**Metrics:**

- Total Requirements : 36 FR, 10 NFR, 12 contraintes
- Total Tasks : 87 sous-tâches, 20 lots
- Coverage % : 100 % des FR ont au moins un lot
- Ambiguity Count : 0
- Duplication Count : 0
- Critical Issues Count : 0 (1 HIGH)

## Next Actions

- U1 bloque l'implémentation : obtenir la décision du porteur, corriger le plan et les lots concernés, puis relancer l'analyse.
- U2 et U3 peuvent être tranchés dans le même échange.
- Les autres constats n'empêchent pas de commencer.
