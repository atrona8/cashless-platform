# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (reprise le 12/11)

- Approuvés (24) : WP01 à WP24. Décisions du 11/11 : 49 à 55 (`contexte-m8.md`).
- WP25 (lane-y, `in_progress`) : T112 à T116 faites (`done`), sessions B1 à B6 (détail dans `suivi-lots.md`).
  Session B7 (défauts B et C) vérifiée le 12/11 par l'orchestrateur, tout vert (`suivi-lots.md`, 552ccfae).
- Puis T117 (CI : job `gateway-e2e` avec NFR-001 à 100 débits/s, décision 54 ; contrôle de stabilité ; `CI.md`,
  `CODEOWNERS` ; `consignation.spec.ts` avec OP-N111 à OP-N119), `align-lane.sh y`, `move-task WP25 --to
  for_review`, relecture par un agent distinct. Une session à la fois dans la lane-y.
- Ensuite : levée d'OP-N117 et OP-N119 dans les docs, revue de mission, `spec-kitty-docs-maintain`, fusion avec
  `main`, accept, merge. Reste à consigner pour WP24 : ligne de `docs/08-pile-logicielle.md`, ADR-161/OP-N106,
  balayage de vulnérabilités ; documenter `central_url` d'enrôlement finissant par `/v1`. Horloge de colima
  resynchronisée le 12/11 (redémarrage).
- Numéros libres : central `0073`, passerelle `edge-0011`, ADR-188, OP-N122 (OP-N120/121 et `0080` pris sur `main`).
- API partagée : `exports/cashless-api`, en fond (`demarrer-local.sh --fond`, arrêt `arreter-local.sh`).

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
