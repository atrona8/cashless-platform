# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## État au 13/11/2026 (reprise du matin)

- Mission acceptée (311af360), consolidée (9d5e4592), revue après fusion faite (`rapports/revue-mission-8.md`,
  publiable avec réserves ; C1 consigné en OP-N122/ADR-188).
- Fusion de main (PR #11, app festivalier) : dcd4684e. **Batterie locale verte** sur `cashless_wp25` : lint, format,
  tsc, pgTAP (70 fichiers, 6052 tests), Jest central (269 suites, 3477 tests), passerelle (72 suites, 865),
  `tools/edge-admin` (4 suites, 29). `post-roles.sql` fusionné relu par un agent distinct : approuvé (sections 9 et
  10 complètes, aucun droit edge sur les objets festivaliers).
- CI rouge sur feat à c441288e (run 43309965846, vert sur `ci/m8-gateway-e2e` au même commit) : course dans
  `test/e2e/crash-points.spec.ts` (le vidage démarre avant `GATEWAY listening`). Corrigé dans le test (215f6ee8,
  relu) : file vidée avant chaque kill ; `during-drain…` se déclenche pendant le vidage en état actif (NFR-004).

## Pour reprendre

1. CI verte sur aee8c172 (run 43408913602). **PR #12 ouverte** vers main ; branche `ci/m8-gateway-e2e` supprimée.
2. Relecture humaine (liste dans la PR), puis fusion.
3. Règle `main protege` : contournement admin ou second relecteur (porteur).
4. Restes : ADR-161/OP-N106, alias `Loose`, `claim-code-order` instable, nettoyage des worktrees des lanes ;
   correction de fond possible : écrire `GATEWAY listening` avant le démarrage du vidage (bootstrap.ts).
5. `apps/api/test/integration/edge/routes/replication-feed.spec.ts` : le cas « trois pages » attend désormais
   l'horizon (CI 43406536917, horizon non avancé sous écritures concurrentes, 0065). Même fragilité, jamais vue en
   échec, signalée par la relecture : « horizon A18 » (l. 145-148), « edge_terms » (l. 219-222), « forme du
   schéma » (l. 82-87), « canari » (l. 175-177, 200). Piste : un assistant `waitHorizon` (au porteur).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
