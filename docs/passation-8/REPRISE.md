# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## État au 12/11/2026, 21 h 15 UTC (limite d'usage atteinte)

- Mission acceptée (311af360), consolidée (9d5e4592), revue après fusion faite (`rapports/revue-mission-8.md`,
  publiable avec réserves ; C1 consigné en OP-N122/ADR-188). Lot de correction et tests de CI corrigés, chacun relu.
- **CI entièrement verte** sur c441288e (run 43305550802 : `ledger` et `gateway-e2e`). `feat/passerelle-locale`
  poussé sur origin à c441288e.
- **Fusion de main (PR #11, app festivalier) dans feat : dcd4684e, NON poussée, NON testée.** Conflits résolus :
  `post-roles.sql` (sections 9 et 10 gardées, indépendantes), `app.module.ts` (les deux modules), docs (union),
  `tools/export/files` (version de main). `npm ci` refait (node_modules = lockfile).
- Batterie locale complète lancée sur dcd4684e (résultat dans le scratchpad de la session, perdu) : à relancer.

## Pour reprendre

1. Relancer en local, sur `cashless_wp25` (URL vérifiées) : lint, format, tsc, pgTAP complet (hors `_*.sql`), Jest
   complet du central (`--maxWorkers=2`), passerelle, `tools/edge-admin`. Corriger ce qui tombe (relecture distincte
   pour toute retouche de code ou de sécurité ; faire relire `post-roles.sql` fusionné).
2. Pousser feat, attendre la CI verte, ouvrir la PR vers main ; supprimer la branche `ci/m8-gateway-e2e`.
3. Règle `main protege` : contournement admin ou second relecteur (porteur).
4. Restes : ADR-161/OP-N106, alias `Loose`, `claim-code-order` instable, nettoyage des worktrees des lanes.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
