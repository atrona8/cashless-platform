# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 10/11/2026, 11 h 15 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 39). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (10/11, 11 h 15 UTC)

- Approuvés (17) : WP01 à WP11, WP16 à WP20, WP23.
- Session du 09/11 interrompue : aucun travail en vol commité (lanes l, m, o, u propres). Relancés le 10/11 :
  - WP12 correction cycle 2 (lane-l) : constats `wp12-cycle1.md`, décisions 36 (+ plafond par recharge), 37, `0065` ;
  - WP13 renvoyé par l'orchestrateur (`wp13-cycle1.md`) : décisions 38-39, migration `0066` ;
  - WP15 implémentation (lane-o) ;
  - WP21 relecture (lane-u).
- Rejeté, à corriger APRÈS WP12 : WP22 (constats `rapports/feedback/wp22-cycle1.md` + lecture des conditions de
  caution et du plafond répliqués).
- Correctif d'intégration WP18 × WP20 dans u, v, w (voir `suivi-lots.md`) : à garder à la fusion de WP24, WP25.
- Numéros : passerelle `edge-0009` libre ; central `0065` WP12, `0066` WP13, `0067` libre.
- Ensuite : WP22 (après WP12) ; WP14 ; WP24 ; WP25.
- API partagée du porteur (ngrok) : `exports/cashless-api`, base `cashless_dev` en 5434 ; ne jamais faire
  `pkill -f dist/main.js` (incident du 10/11).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
