# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 09/11/2026, 17 h 15 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 39). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (17 h 15 UTC)

- Approuvés (17) : WP01 à WP11, WP16 à WP20, WP23.
- En relecture : WP21 (lane-u), WP13 (lane-m ; sera renvoyé pour la migration `0066`, décisions 38-39).
- En correction : WP12 cycle 2 (lane-l : constats, décisions 36 + plafond, 37, migration `0065`).
- Rejeté, à corriger APRÈS WP12 : WP22 (constats `rapports/feedback/wp22-cycle1.md` + lecture des conditions de
  caution et du plafond répliqués).
- Correctif d'intégration WP18 × WP20 dans u, v, w (voir `suivi-lots.md`) : à garder à la fusion de WP24, WP25.
- Numéros : passerelle `edge-0009` libre ; central `0065` WP12, `0066` WP13, `0067` libre.
- Ensuite : WP14, WP15 ; WP24 ; WP25.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
