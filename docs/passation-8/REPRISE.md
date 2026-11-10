# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 10/11/2026, 13 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 39). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (10/11, 13 h 30 UTC)

- Approuvés (19) : WP01 à WP13, WP16 à WP20, WP23.
- Reprise après la pause (serveur de l'app festivalier livré, PR #11 fusionnée dans `main`, `7584f714`). Décisions
  40 à 42 (ADR-182, ADR-183). Lancés le 10/11 vers 13 h 20 :
  - WP15 fin de lot (lane-o) : T068, migration `0067` (ADR-183) ;
  - WP21 correction cycle 2 (lane-u), sans NFR-005 (décision 42, reportée à WP25) ;
  - WP22 correction cycle 2 (lane-v), lecture d'`edge_terms` (fusion de la lane-l si besoin) ;
  - WP14 implémentation (lane-n).
- Ensuite : relectures de ces lots ; WP24 (après WP21, WP22) ; WP25 ; revue de mission, docs, accept, merge.
- Numéros : central `0065` WP12, `0066` WP13, `0067` WP15, `0068` libre (WP14 si besoin) ; `0080` pris par `main`
  (serveur festivalier) ; passerelle `edge-0009` libre. ADR suivant libre : ADR-184 (ADR-180, ADR-181 sur `main`).
- Fusion avec `main` à prévoir avant le merge de la mission (0080, ADR-180/181, OP-N120/121).
- API partagée : `exports/cashless-api`, lancée en fond (`demarrer-local.sh --fond`), arrêt par `arreter-local.sh`.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
