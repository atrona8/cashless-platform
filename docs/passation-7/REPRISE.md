# Reprise — mission 7 (hors-ligne-snapshots-lots-01M645RN)

État au 30/10/2026 : **plan finalisé** sur `feat/hors-ligne-snapshots-lots` (`e38c1ce0`, `8fd1e037`), addendum
documentaire fait (`beb00e94`). Prochaine étape : `/spec-kitty.tasks` (fichier d'interfaces commun d'abord, prompts de
lots de 150 à 250 lignes, voir la mémoire « prompts allégés »), puis `/spec-kitty.analyze`.

## Décisions du porteur (Decision Moments dans `kitty-specs/…/decisions/`)

- 29/10 : KMS simulé jusqu'à 12b ; vendeur hors ligne = session en ligne valable 12 h ; trou de plus de 24 h = alerte ;
  OP-N57/58/68/69/75 levés ; seuils (lot 500 en 60 s p95, FULL 50 000 en 30 s, DELTA 2 s p95).
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
