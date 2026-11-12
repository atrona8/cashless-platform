# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots (reprise le 12/11)

- Approuvés (25) : WP01 à WP25 (WP25 au cycle 2, 12/11). Décisions 49 à 58 (`contexte-m8.md`).
- Docs : OP-N117 et OP-N119 levés, ADR-187 complété, OP-N115 (12b) et OP-N116 (11a) reportés (cdbc913a).
- Ensuite : revue de mission, `spec-kitty-docs-maintain`, fusion avec
  `main`, accept, consolidation (pièges : mémoire `consolidate-and-ci-pitfalls`). Sur feat après la consolidation
  (jamais dans une lane approuvée) : `npm run lint` (142 erreurs), `env-setup.cjs` formaté, non bloquants du cycle 2
  de WP25 (`suivi-lots.md`). Règle « main protege » active (12/11, revue des propriétaires, 1 approbation, liste de contournement vide : PR du porteur bloquée tant que l'admin n'y est pas ajouté). Reste à consigner pour WP24 : ligne de `docs/08-pile-logicielle.md`, ADR-161/OP-N106,
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
