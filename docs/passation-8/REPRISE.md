# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 12/11/2026, 11 h 30 UTC. Implémentation en cours sur `feat/passerelle-locale`. Méthode : un implémenteur et un
relecteur distincts par lot (sous-agents `sonnet`, fiche commune `fiche-implementation.md`), notes entre lots dans
`suivi-lots.md`, décisions du porteur dans `contexte-m8.md` (1 à 58). Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## État au 12/11/2026, 17 h 10 UTC (pause, laptop fermé)

- Mission **acceptée** (311af360) et **consolidée** sur feat (9d5e4592 ; code = tête testée en CI 516b4af4).
- **Lot de correction sur feat, approuvé par une relecture distincte** : 65bbc9e5 (CI : `M8_PG_CONTAINER` par une
  étape, règles de `ci-workflow.spec.ts`), a07310f1 (superutilisateur jetable de `production-refusals`), c306e3f5
  (`body-parser` 2.4.0, `multer` 2.5.0, `@nestjs/platform-express` 11.2.9, npm retiré de l'image), 2aa57b3c,
  7b5a3dfa, 68ae782c (lint : 142 erreurs, alias `Loose` = `any` dans les tests, typage réel à faire).
- **fb8e7b2c (à faire relire par un agent distinct)** : CI, redémarrage du service PostgreSQL après l'installation de
  pgTAP (apt montait 17.11 → 17.12 sous le serveur : `plpgsql.so` incompatible, migrations en échec).
- **CI en cours** sur la branche temporaire `ci/m8-gateway-e2e` (tête de feat poussée à la pause) :
  `gh run list --branch ci/m8-gateway-e2e --limit 1`. Résultat attendu : `ledger` et `gateway-e2e` verts (balayage
  Trivy HIGH/CRITICAL compris, jamais vu vert ; si rouge : lire le tableau du job).

## Pour reprendre, dans l'ordre

1. Lire le résultat de la CI ci-dessus ; corriger s'il le faut (implémenteur + relecteur distincts).
2. Relecture distincte de fb8e7b2c.
3. Revue de mission après fusion (`spec-kitty-mission-review`), lister les écarts de sécurité ouverts (CLAUDE.md).
4. Pousser feat (`git push origin feat/passerelle-locale`), ouvrir la PR vers main ; règle `main protege` : ajouter
   l'administrateur en contournement ou un second relecteur (au porteur).
5. Supprimer la branche `ci/m8-gateway-e2e` ; plus tard, retirer les worktrees et branches des lanes de la mission 8.
6. Restes : ADR-161/OP-N106 (WP24), `startup-guard.spec.ts` instable une fois en batterie complète, typage des tests
   (`Loose`). Relecture humaine (porteur) : fichiers listés dans `suivi-lots.md`, `CODEOWNERS`, workflow, Dockerfile.

- Numéros libres : central `0073`, passerelle `edge-0011`, ADR-188, OP-N122.
- Poste : colima à 6 processeurs et 3 Gio ; API partagée (`exports/cashless-api`) arrêtée, à relancer si besoin.

## À ne pas oublier

- Relecture humaine : liste par lot dans `suivi-lots.md` (lignes « Relecture humaine »).
- Contrat stable, base `d2a7c538` : ajouts sous `/edge/*` ; hors `/edge/*`, seulement `Problem` (décision 35, WP13).
- Au juriste : OP-N108 ; identification du client pour la mission 10c.
- Garde `kitty-specs` à `move-task` : `align-lane.sh <lettre>` d'abord ; `--force` seulement si seuls les artefacts du
  runtime restent.
- Après la review de la mission : invoquer `spec-kitty-docs-maintain` avant accept/merge (CLAUDE.md).
