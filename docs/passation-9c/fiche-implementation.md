# Fiche commune — implémentation et relecture des lots (mission 9c)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`remboursement-partiel-especes-01M84932` (`<M>` = `<R>/kitty-specs/<mission>`). Planification et fusion sur
`feat/remboursement-partiel-especes`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier : l'essentiel est
ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C LANG=C`**.

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   remboursement-partiel-especes-01M84932` (implémenteur) ou `… action review WPxx …` (relecteur). La commande affiche
   le prompt du lot : lis-le, c'est la source du lot. Lis aussi `<M>/interfaces.md` (fait foi sur les noms).
2. Travaille **uniquement** dans le worktree de la lane (`<R>/.worktrees/remboursement-partiel-especes-01M84932-lane-x`) :
   `cd <lane> || exit 1` avant toute commande. Écrire dans le checkout principal est une faute grave.
3. Si `node_modules/@cashless/{api,contracts,ledger-sql,shared-rules}` manque dans la lane : `mkdir -p
   node_modules/@cashless` puis liens `ln -s ../../apps/api` et `../../packages/{shared-rules,contracts,ledger-sql}`.

## Ce que fait la mission
Au guichet (`TOPUP_DESK`, `CASHIER` ou `SUPERVISOR`, session de caisse ouverte), rendre en espèces un montant choisi
du solde payé du portefeuille du bracelet lu, **sans libérer le bracelet**. Permis seulement si le prestataire
l'autorise (`cash_partial_refund_allowed`) ET si l'organisateur l'active pour l'événement
(`event.cash_partial_refund_enabled`). Montant débité brut, espèces remises = montant − frais de `refund_policy`.
Seconde personne quand le cumul du jour UTC des rendus partiels **du portefeuille** (tous bracelets), montant compris,
dépasse `event.cash_refund_single_max`. Crédits offerts et caution intacts. Refus pendant `EDGE`.
Modèle à suivre : `apps/api/src/media/lifecycle/release.service.ts` et `release.controller.ts` (guichet de retour).

## Règles du projet (résumé obligatoire)
- **Sécurité (règle 1)** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret
  plus exposé) est soumis au porteur **avant d'être codé** : décris-le dans ton compte rendu (risque, options), ne le
  code pas, continue le reste. Un renforcement se fait puis se signale. Ne rouvre jamais un droit pour faire passer un test.
- **Décisions du porteur (23/11/2026)** : cumul par portefeuille et par jour ; anonymes acceptés, frais à chaque rendu ;
  le prestataire autorise, l'organisateur active ; montant saisi = débité ; ajouts au contrat de
  `<M>/contracts/partial-cash-refund.md` acceptés, **et seulement eux**.
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml` > SPECIFICATION > PRD. Dans la mission, `interfaces.md` fait foi.
- **Contrat** : seuls ajouts permis (WP02) : l'opération `refundPartialCash`, ses deux schémas, la propriété facultative
  `cash_partial_refund_enabled` d'`Event` et d'`EventUpdate`, une phrase de description de la clé de cascade. Aucun code
  d'erreur nouveau, aucune route existante modifiée. Inscrits dans `contract-baseline.json` ; `node
  tools/contract-stability/check.mjs` à 0 refus.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/`, `schema_grand_livre_cashless.sql` ni une migration
  existante : migration `0100` seulement. **Aucun droit** nouveau pour `cashless_app` (pas de `GRANT`).
- **Aucune dépendance nouvelle**. Lignes de 100 caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus les retouches hors carte nommées par le prompt, listées dans la note
  de lane.
- **Chaque contrôle ajouté a une mutation vérifiée** : retire le contrôle, constate que ton test échoue, remets-le ; note la
  mutation et son résultat dans la note de lane.
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
3. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission remboursement-partiel-especes-01M84932`.
4. `bash <R>/docs/passation-9c/scripts/align-lane.sh <lettre de ta lane>` avant `move-task`. Si un garde `kitty-specs`
   bloque : **pas de `--force`**, signale-le.
5. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission
   remboursement-partiel-especes-01M84932 --note "…"` : la note liste retouches hors carte, écarts, mutations.
6. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan (renforce ou affaiblit),
   points soumis au porteur, fichiers à faire relire par une personne, critères couverts avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Pars de « Ce que le relecteur doit casser ». Tente aussi : droits de la base, contournement de garde (réglages,
  seconde personne, session de caisse), isolation entre prestataires, tests qui ne prouvent pas ce qu'ils disent,
  comptages sur toute la base, écarts à `interfaces.md` non signalés. Relance toi-même les tests sur `cashless_wpXX`.
- **Lance aussi les gardes transverses** (leçon de la 10a) : `test/unit/architecture.spec.ts`,
  `test/unit/production-guard.spec.ts`, `test/unit/contracts`, `test/integration/invariants-cloture/consignation.spec.ts`.
- Verdict : `… move-task WPxx --to approved --note "…"` ou `--to planned --review-feedback-file <fichier>` (constats
  numérotés, gravité, correction). Pas de `--force`.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
