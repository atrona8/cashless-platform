# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 10/11/2026, 13 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 39). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (11/11, après-midi)

- Approuvés (24) : WP01 à WP24. Décisions du 11/11 : 49 à 52 (OP-N118, OP-N119, ADR-186, ADR-187).
- WP25 (lane-y, `in_progress`) : partie A faite (décisions 45, 50, 51, OP-N117, isolation WP13) ; T112 faite ; session
  B3 en cours : décision 52 (clé d'origine complétée à 4 chiffres, migration `0070`), puis fin de T113. Restent :
  T114 (charge, NFR-005 à deux processus), T115-T116 (pannes, sécurité), T117 (CI, consignation) puis
  `move-task --to for_review` et relecture. Une session par bloc, jamais deux dans la lane-y en même temps.
- Ensuite : levée d'OP-N117 et OP-N119 dans les docs, revue de mission, `spec-kitty-docs-maintain`, fusion avec
  `main`, accept, merge. Reste à consigner pour WP24 : ligne de `docs/08-pile-logicielle.md`, ADR-161/OP-N106,
  balayage de vulnérabilités ; documenter que `central_url` d'enrôlement finit par `/v1`.
- Numéros libres : central `0071`, passerelle `edge-0010`, ADR-188, OP-N122 (OP-N120/121 et `0080` pris sur `main`).
- API partagée : `exports/cashless-api`, en fond (`demarrer-local.sh --fond`, arrêt `arreter-local.sh`).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
