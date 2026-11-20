# État de reprise — mission 11a (19/11/2026, pause demandée par le porteur)

## Où on en est
- 14 lots sur 14 approuvés (WP10 et WP14 réapprouvés le 19/11 après relecture distincte des commits
  post-approbation `414e35f2`, `02b5b5f8`, `0233f74a`, `63b1526b`).
- Tests de borne (règle 3) écrits avant la fusion, dans la lane n : `bde1d13b`, `3c112821`, `d7d1d139`,
  relus par un agent distinct (OK).
- Documentation post-review appliquée sur `feat/durcissements-serveur` : `0f2d0ee6`, `6313668a`
  (`docs/06-docs-status.md` : « Résultat: Mis à jour », validation du porteur).
- `interfaces.md` corrigé sur feat (`a65459d5`) ; limites et décisions dans `a-consigner.md` (28 points),
  reportées par WP14 dans POINTS_OUVERTS, DECISIONS_ADR, PROMPTS, PRD (lane n).
- Matrice d'acceptation remplie (31 critères `pass`, 7 invariants négatifs) dans la coordination
  (`.worktrees/durcissements-serveur-01M7QAJD-coord`).

## Batterie du code intégré (lane n)
- pgTAP (tête `02b5b5f8`) : toutes les suites passent (`_grants_for_tests.sql` est un fichier commun).
- Jest API (tête `63b1526b`, `--maxWorkers=2`) : 4 231 / 4 246, 13 ignorés, 2 échecs de fragilité verts seuls
  (2 × 47/47) : `claim-code-order.spec.ts` (connu) ; `vendor-sessions.spec.ts` (échoue seulement en parallèle,
  test différent à chaque fois — à surveiller en CI).
- `tsc` propre ; `check.mjs` 0 refusée ; edge-admin 38/38.
- e2e passerelle : à lancer SANS l'environnement de `tools/dev-db/env.sh` (sinon 0 test). 191/192 par l'agent
  correcteur ; seul échec `exclusion-under-load` (débit 89/s < 100/s, identique sur la base : limite du poste).

## Suite (dans l'ordre)
1. ~~accept~~ FAIT le 19/11/2026 à 16:10Z (commit d'acceptation `ef1d3504`, 14 lots, merge en attente).
2. ~~Consolidation~~ FAITE le 20/11/2026 (2e essai) : comptes rendus recopiés sur feat (`3f7741f6`),
   `align-lane.sh` des 14 lanes, feat fusionnée dans la coordination ; 1er essai refusé « lane-i stale »
   (`sqlstate-map.ts`) ; lanes chaînées en `--no-ff` (i…n, code de lane-i pris sur la lane n) ; squash `cdedcd48`.
3. ~~Contrôle~~ FAIT : `git diff --stat 63b1526b HEAD -- apps packages tools .github` vide ; `check.mjs`
   0 refusée ; tests de `tools/contract-stability` 42/42.
4. ~~PR~~ FAIT : PR #20 fusionnée le 20/11/2026 (`--admin`, accord du porteur), commit `27d0ec50`. Revue
   post-fusion PASS WITH NOTES après correctif B-1 (`ae432316`) ; CI verte (pgTAP
   `tests_offline_snapshot_source_no_stats.sql` rouge une fois, vert au rejeu). **Mission 11a close.**

## Pour le porteur
- Relecture humaine : liste en §11 de `docs/POINTS_OUVERTS.md` (clés, droits de base, cryptographie,
  `redact.ts`, `tests_11a_bounds.sql`, `vendor-pin-call*.ts`, `ios-app-attest-assertion.ts`, migrations 0090-0095).
- `cashless-api-db-1` (API partagée, 5434) laissé arrêté depuis l'arrêt de Colima : à relancer par le porteur.
