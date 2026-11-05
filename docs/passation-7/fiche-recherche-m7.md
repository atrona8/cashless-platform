# Fiche de contexte — recherche du plan, mission 7 (hors-ligne-snapshots-lots-01M645RN)

Dépôt : /Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform (branche feat/hors-ligne-snapshots-lots).
Monorepo npm : apps/api (NestJS 11, TypeScript, Node 22), packages/ledger-sql (PostgreSQL 17, migrations
0001..0042, pgTAP), packages/contracts (openapi.yaml, types TS et Dart générés).

Spec de la mission : kitty-specs/hors-ligne-snapshots-lots-01M645RN/spec.md (ne lire que les sections utiles :
Functional Requirements, Assumptions, Contradictions). Mission précédente comme modèle :
kitty-specs/recharges-caisses-psp-01M5YEBA/{plan.md,research.md,contracts/}.

Règles :
- NE PAS relire CLAUDE.md, README ni SPECIFICATION.md en entier ; lire seulement des sections précises si besoin.
- Lecture seule : n'écrire QUE le fichier de résultats indiqué dans ta tâche. Pas de commit, pas de reset-db,
  pas de Jest ni pgTAP, pas de commande spec-kitty.
- Les `.sql` générés de packages/ledger-sql (schema de référence, tests_grand_livre_cashless.sql,
  scenario_reference_test.sql) ne se modifient jamais à la main (info utile pour tes recommandations).
- Le schéma de référence `schema_grand_livre_cashless.sql` est appliqué comme migration de base (vérifier comment :
  packages/ledger-sql/scripts, package.json « migrate »), puis migrations/00xx, puis post-roles.sql / roles.sql.
- Décisions du porteur déjà prises : KMS simulé (faux de port de clés refusé en production, adaptateurs AWS en 12b) ;
  OP-N57, N58, N68, N69, N75 levés dans la mission ; recharge espèces hors ligne sans session OUVERTE couvrante =
  REJECTED, rien écrit, anomalie portant le montant ; vendeur hors ligne = session ouverte en ligne valable 12 h ;
  trou > 24 h = alerte seulement ; seuils : lot 500 ops en 60 s p95, FULL 50 000 bracelets 30 s, DELTA 2 s p95.

Format du rapport : Markdown en français, phrases courtes, chemins `fichier:ligne`, sections numérotées. Pour
chaque constat : fait vérifié (avec la référence) / écart ou manque / recommandation pour le plan. Signaler toute
contradiction entre sources (sync_protocol.md, schéma, openapi.yaml, SPECIFICATION) sans la trancher.
Longueur visée : 250-450 lignes.
