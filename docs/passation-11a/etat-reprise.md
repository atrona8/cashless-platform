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
1. `spec-kitty accept --mission durcissements-serveur-01M7QAJD` (si pas déjà fait).
2. Consolidation : appliquer la séquence de la mémoire « Pièges de consolidate » (9a/9b) — comptes rendus de
   relecture recopiés sur feat, `align-lane.sh` de chaque lane, feat fusionnée dans la coordination
   (`git merge --no-ff`), lanes chaînées en `--no-ff` dans l'ordre de consolidation (code = tête TESTÉE de la
   lane n), puis `consolidate --keep-branch --keep-worktree --yes`. Fichiers modifiés à la fois sur feat et dans
   les lanes : `docs/POINTS_OUVERTS.md` etc. sont seulement dans la lane n ; vérifier `PRD.md`/`PROMPTS`.
3. Après fusion : `git diff --stat 63b1526b HEAD -- apps packages tools .github` doit être vide (hors docs).
4. PR vers main ; CI ; fusion `--admin` sur accord du porteur pour CETTE PR.

## Pour le porteur
- Relecture humaine : liste en §11 de `docs/POINTS_OUVERTS.md` (clés, droits de base, cryptographie,
  `redact.ts`, `tests_11a_bounds.sql`, `vendor-pin-call*.ts`, `ios-app-attest-assertion.ts`, migrations 0090-0095).
- `cashless-api-db-1` (API partagée, 5434) laissé arrêté depuis l'arrêt de Colima : à relancer par le porteur.
