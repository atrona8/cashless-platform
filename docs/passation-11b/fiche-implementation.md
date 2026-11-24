# Fiche commune — implémentation et relecture des lots (mission 11b)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`routes-backoffice-01M86KT6` (`<M>` = `<R>/kitty-specs/<mission>`). Planification et fusion sur
`feat/routes-backoffice`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier : l'essentiel est
ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C LANG=C`**.

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   routes-backoffice-01M86KT6` (implémenteur) ou `… action review WPxx …` (relecteur). La commande affiche
   le prompt du lot : lis-le, c'est la source du lot. Lis aussi `<M>/interfaces.md` (fait foi sur les noms).
2. Travaille **uniquement** dans le worktree de la lane (`<R>/.worktrees/routes-backoffice-01M86KT6-lane-x`) :
   `cd <lane> || exit 1` avant toute commande. Écrire dans le checkout principal est une faute grave.
3. Si `node_modules/@cashless/{api,contracts,ledger-sql,shared-rules}` manque dans la lane : `mkdir -p
   node_modules/@cashless` puis liens `ln -s ../../apps/api` et `../../packages/{shared-rules,contracts,ledger-sql}`.

## Ce que fait la mission
Ajoute côté serveur ce dont le back-office web a besoin (OP-N170) : profil du personnel (`GET /staff/me`), rôles
autorisés de chaque opération (`x-roles`), liste et détail des ventes, liste et classement des anomalies (sans écriture
au grand livre), recherche (bracelet par UID ou code imprimé, portefeuille, festivalier par numéro exact), modèles de
téléphone et niveau NFC des terminaux. **Aucune écriture au grand livre.** Noms, signatures, codes et propriétaires :
`<M>/interfaces.md` (fait foi). Décisions : `<M>/research.md` D1 à D10.

## Règles du projet (résumé obligatoire)
- **Sécurité (règle 1)** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret
  plus exposé) est soumis au porteur **avant d'être codé** : décris-le dans ton compte rendu (risque, options), ne le
  code pas, continue le reste. Un renforcement se fait puis se signale. Ne rouvre jamais un droit pour faire passer un test.
- **Décisions du porteur (24/11/2026)** : 10 types d'anomalie classables tenus dans la base (D1) ; modèle de téléphone
  déclaré par le terminal, champ facultatif (D2) ; matrice échantillon pour `x-roles` (D3) ; retrait du droit direct de
  clore une anomalie (D4, renforcement) ; audit de la recherche par numéro **sans le numéro** (D7) ; table de plateforme
  des modèles (D9) ; **aucun code d'erreur nouveau** (D10) ; ajouts au contrat de `<M>/contracts/backoffice-routes.md`,
  **et seulement eux**.
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml` > SPECIFICATION > PRD. Dans la mission, `interfaces.md` fait foi.
- **Contrat** : seuls ajouts permis : ceux de `interfaces.md` §3 (WP03) et `x-roles` (WP04). Aucune route existante
  modifiée hormis les ajouts facultatifs `device_model` / `nfc_level`. Tout ajout inscrit dans `contract-baseline.json` ;
  `node tools/contract-stability/check.mjs` à 0 refus.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/`, `schema_grand_livre_cashless.sql` ni une migration
  existante : migrations `0101` (WP01) et `0102` (WP02) seulement. **Aucun droit** nouveau pour `cashless_app` (pas de `GRANT`).
- **Aucune dépendance nouvelle**. Lignes de 100 caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus les retouches hors carte nommées par le prompt, listées dans la note
  de lane.
- **Chaque contrôle ajouté a une mutation vérifiée** : retire le contrôle, constate que ton test échoue, remets-le ; note la
  mutation et son résultat dans la note de lane.
- **Isolement** : chaque route nouvelle a son cas dans `backoffice-isolation-cases/<lot>.cases.ts` DANS le lot qui la
  crée (leçon de la 9c) ; une donnée personnelle (numéro, nom, adresse) n'apparaît jamais dans une réponse ni un journal.
- **Comptages en test** : toujours limités au prestataire, au portefeuille ou à l'objet du test, jamais toute la base.

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres`. **`cashless_test` est réservée à l'orchestrateur.** Chaque
  lot utilise `PGDATABASE=cashless_wpXX` (XX = numéro du lot). Avant tout test : `docker ps` montre
  `cashless-platform-pg17`, sinon arrête-toi.
- **Le serveur local est en `trust`** : un mauvais mot de passe passe. Un test qui change le mot de passe d'un rôle casse la
  CI : passe toujours à `migrate()` les mots de passe en vigueur (`process.env.CASHLESS_<ROLE>_PASSWORD ?? cashless_<role>_local`).
- Remise à zéro depuis la lane : `PGDATABASE=cashless_wpXX bash packages/ledger-sql/scripts/reset-db.sh`.
- pgTAP : `export PATH=<R>/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH`, puis depuis
  `packages/ledger-sql/` de ta lane : `pg_prove -d cashless_wpXX tests/<fichier>.sql`.
- Jest, depuis `apps/api` de la lane, **dans le même appel Bash** : `export PGDATABASE=cashless_wpXX; source
  ../../tools/dev-db/env.sh; env | grep DATABASE_URL` (toutes les URL doivent viser ta base) puis `SKIP_LATENCY=1 npx
  jest <chemin> --runInBand --forceExit`. Après un Jest, refais `reset-db`.
- Jamais de batterie complète, jamais en tâche de fond, toujours `--runInBand`.
- **API partagée du porteur (ngrok, `exports/cashless-api`, port 80, base sur 5434) : n'y touche jamais.** Aucun `pkill`.
- Instabilités connues : `claim-code-order.spec.ts`, `auth-keys.spec.ts`, `vendor-pin-bounds.spec.ts`,
  `transverse/migrate-lock.spec.ts`, `tests_offline_snapshot_source_no_stats.sql`.

## Fin d'implémentation
1. `npx eslint <tes fichiers>` et `npx tsc --noEmit -p apps/api/tsconfig.json` depuis la lane.
2. Dans la lane : `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer par `Co-Authored-By: Claude
   Sonnet 5.5 <noreply@anthropic.com>`). Jamais de push.
3. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission routes-backoffice-01M86KT6`.
4. `bash <R>/docs/passation-11b/scripts/align-lane.sh <lettre de ta lane>` avant `move-task`. Si un garde `kitty-specs`
   bloque : **pas de `--force`**, signale-le.
5. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission
   routes-backoffice-01M86KT6 --note "…"` : la note liste retouches hors carte, écarts, mutations.
6. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan (renforce ou affaiblit),
   points soumis au porteur, fichiers à faire relire par une personne, critères couverts avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Pars de « Ce que le relecteur doit casser ». Tente aussi : droits de la base, contournement de garde (réglages,
  seconde personne, session de caisse), isolation entre prestataires, tests qui ne prouvent pas ce qu'ils disent,
  comptages sur toute la base, écarts à `interfaces.md` non signalés. Relance toi-même les tests sur `cashless_wpXX`.
- **Lance aussi les gardes transverses** (leçon de la 10a) : `test/unit/architecture.spec.ts`,
  `test/unit/production-guard.spec.ts`, `test/unit/contracts`, `test/integration/invariants-cloture/consignation.spec.ts`,
  `test/integration/end-to-end/backoffice-isolation.spec.ts` (dès WP05), `media-isolation.spec.ts`, `device-auth-matrix.spec.ts`.
- Verdict : `… move-task WPxx --to approved --note "…"` ou `--to planned --review-feedback-file <fichier>` (constats
  numérotés, gravité, correction). Pas de `--force`.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
