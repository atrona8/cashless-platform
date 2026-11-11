# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 10/11/2026, 13 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 39). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (10/11, fin de session : quota atteint)

- Approuvés (22) : WP01 à WP13, WP15 à WP23.
- WP14 : cycle 2 corrigé (lane-n, cfe029a4), en `for_review` ; relecture du cycle 2 INTERROMPUE : à relancer
  (vérifier la mutation du second appel `resolveOnlineRef`).
- WP24 : implémenté (lane-x, 06136608, après fusion d'intégration u+v+w par l'orchestrateur, 60b79447), en
  `for_review` ; relecture INTERROMPUE. Avant relecture, correction pour les décisions 47 (TLS du port
  d'administration) et 48 (purge manuelle versée au central avant destruction). Limites de la purge consignées le 11/11
  (décision 49, OP-N118, ADR-186). Reste à consigner : ligne de `docs/08-pile-logicielle.md`, ADR-161/OP-N106, balayage de vulnérabilités.
- Puis WP25 (preuves de bout en bout, décision 45 `spend_order`, NFR-005, OP-N115 à OP-N117, isolation entre
  passerelles de WP13, `cash-topup.spec.ts`), revue de mission, `spec-kitty-docs-maintain`, accept, merge.
- Numéros libres : central `0069`, passerelle `edge-0009`, ADR-187, OP-N119 (puis OP-N122 : 120 et 121 pris sur `main`). Fusion avec `main` (0080, ADR-180/181,
  OP-N120/121) avant le merge de la mission.
- API partagée : `exports/cashless-api`, en fond (`demarrer-local.sh --fond`, arrêt `arreter-local.sh`).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
