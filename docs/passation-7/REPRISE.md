# Reprise — mission 7 (hors-ligne-snapshots-lots-01M645RN)

État au 30/10/2026 (fin de matinée) : **tâches finalisées et analysées** sur `feat/hors-ligne-snapshots-lots`
(`0d22b8f6` tâches, `64377f6a` interfaces et décisions, `d7fe73ba` analyse : verdict `ready`, 0 critique, 0 élevé,
7 moyens, 5 faibles). 21 lots, 21 lanes, 44/44 FR rattachées. Prochaine étape : traiter (ou non, au choix du
porteur) les constats moyens I2, I3, I4, U2 de `analysis-report.md` (toute retouche de planification impose une
nouvelle analyse), puis `spec-kitty next --agent claude --mission hors-ligne-snapshots-lots-01M645RN`
(un implémenteur et un relecteur distincts par lot ; tests en série par l'orchestrateur).

Verrou du runtime `decisions/index.json.lock` exclu localement (`.git/info/exclude`) : il bloquait
`record-analysis` (`DIRTY_WORKTREE`).
## Décisions du porteur (Decision Moments dans `kitty-specs/…/decisions/`)

- 29/10 : KMS simulé jusqu'à 12b ; vendeur hors ligne = session en ligne valable 12 h ; trou de plus de 24 h = alerte ;
  OP-N57/58/68/69/75 levés ; seuils (lot 500 en 60 s p95, FULL 50 000 en 30 s, DELTA 2 s p95).
- 30/10 (tâches, ADR-140, OP-N91) : `discard_offline_snapshot_draft` et `mark_offline_retry_alerted` au
  signataire, audit `SNAPSHOT_PUBLISHED` écrit par `publish_offline_snapshot` ; `device_journal_imports_processing()`
  (identifiants seuls) à `cashless_app` ; `offline_block_time` = date de blocage la plus ancienne.
- 30/10 : aucune recharge espèces hors ligne (`TOPUP_CASH` d'un lot rejeté par opération) ; exposition = ventes non
  acquittées, stricte ; deux processus de snapshots (`snapshot-content` Decrypt+DataKey, `snapshot-signer` Sign) ;
  trace `RETRY` pour le quatrième `CL007` (ADR-139, OP-N90).

## Où lire

- `kitty-specs/hors-ligne-snapshots-lots-01M645RN/research.md` : **R-30 fait foi** sur R-01 à R-23 et sur les contrats.
- `research-adversarial.md` : 33 constats et leur suite ; rapport complet `docs/passation-7/rapports/plan-adversarial.md`.
- Rapports de recherche (état réel de la base, de l'API, du protocole) : `docs/passation-7/rapports/R-*.md`.
- ADR-137 à ADR-139 ; OP-N89, OP-N90.

## Points à surveiller aux lots

- Migrations `0043` à `0048` ; `0028` reste libre ; ne jamais modifier les `.sql` générés.
- Défaut global `ALTER DEFAULT PRIVILEGES` : 41 suites pgTAP à adapter (`tests/_grants_for_tests.sql`) : lot à faire tôt.
- Fichiers à faire relire par une personne : `post-roles.sql`, migrations 0044, 0045, 0048, `kms/`, `snapshots-content/`,
  `snapshots-signer/`, `wrap_offline_snapshot_key`, `complete_offline_batch` + `offline_batch_retry`, import de journal.
- Commandes spec-kitty avec `LC_ALL=C LANG=C` (git en français casse 4.0.0rc7).
