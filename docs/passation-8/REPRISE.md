# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (reprise le 12/11)

- **Mission acceptée le 12/11** (311af360). 25 lots approuvés (WP25 réapprouvé après l'option 1 de NFR-001).
  NFR-001 prouvé en CI (run 43241115603, 108/s). Matrice 59/59 sur la coordination.
- Ensuite : consolidation (`spec-kitty consolidate`, pièges : mémoire `consolidate-and-ci-pitfalls`), puis sur feat
  un lot de correction (implémenteur + relecteur) : lint (142 erreurs), workflow (`M8_PG_CONTAINER` posé par une
  étape, cf. branche `ci/m8-gateway-e2e` b002176d), dépendances (`body-parser`, `multer`, npm retiré de l'image),
  `production-refusals` (mot de passe en CI), non bloquants des relectures (`suivi-lots.md`) ; puis revue de
  mission, CI verte, PR vers main (règle `main protege` : contournement admin ou second relecteur). Reste à
  consigner pour WP24 : ADR-161/OP-N106. Supprimer la branche `ci/m8-gateway-e2e` après le report.
- Numéros libres : central `0073`, passerelle `edge-0011`, ADR-188, OP-N122 (OP-N120/121 et `0080` pris sur `main`).
- API partagée : `exports/cashless-api`, en fond (`demarrer-local.sh --fond`, arrêt `arreter-local.sh`).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
