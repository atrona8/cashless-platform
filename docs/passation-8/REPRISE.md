# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 09/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 31). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Lots

- Approuvés (11) : WP01 à WP08, WP16, WP17, WP18.
- Interrompus par la limite d'usage (reprise à 14 h 40 UTC, reprendre les mêmes agents ou relancer un implémenteur
  sur la lane, travail sur disque) :
  - WP09 (lane-i) : commit 95462f42 (droits, `0064`, tests) fait ; restait la batterie complète, `mark-status`,
    `align-lane.sh i`, `move-task --to for_review`.
  - WP19 (lane-s) : travail non commité (`device-proofs/`, `device/`, tests, `edge-0005_device_state.sql`,
    déclaration de `structured-headers` et `yaml` dans `apps/gateway/package.json` : déjà dépendances de `apps/api`,
    à vérifier en relecture). `edge-0005` pris sans attribution : à entériner (WP20 a `edge-0004`).
  - WP20 (lane-t) : travail non commité (`queue/`, tests, `edge-0004_queue_hardening.sql`, horloge, faux du port) ;
    « deux échecs à examiner » au moment de l'arrêt. Décision 22 (mTLS signé par le port) : compte rendu attendu.
- Ensuite : WP10, WP11 (après WP09) ; WP21 à WP23 (après WP19, WP20) ; WP12 à WP15 ; WP24 ; WP25.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts seulement sous `/edge/*` (WP01 seul).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
