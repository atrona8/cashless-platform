# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 09/11/2026, 16 h 25 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 35). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots

- Approuvés (16) : WP01 à WP11, WP16 à WP20.
- En cours (implémenteurs relancés à 16 h 25 après une interruption vers 15 h 16 ; travail sur disque, non commité si
  l'interruption se répète : relancer un implémenteur « en reprise » sur la lane) :
  WP12 (lane-l), WP13 (lane-m), WP21 (lane-u), WP22 (lane-v), WP23 (lane-w).
- Migrations de la passerelle : `edge-0006` WP21, `edge-0007` WP22, `edge-0008` WP23 ; prochain libre `edge-0009`.
- Ensuite : relecture de chacun ; WP14, WP15 ; WP24 ; WP25.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
