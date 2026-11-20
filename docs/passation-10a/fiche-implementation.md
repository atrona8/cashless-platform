# Fiche commune — implémentation et relecture des lots (mission 10a)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`serveur-app-festivalier-01M7WB69` (`<M>` = `<R>/kitty-specs/<mission>`). Planification et fusion
sur `feat/serveur-app-festivalier`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier :
l'essentiel est ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C LANG=C`**.

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   serveur-app-festivalier-01M7WB69` (implémenteur) ou `… action review WPxx …` (relecteur). La
   commande affiche le chemin du prompt du runtime : lis-le, c'est la source du lot.
2. Travaille **uniquement** dans le worktree de la lane
   (`<R>/.worktrees/serveur-app-festivalier-01M7WB69-lane-x`) : `cd <lane> || exit 1` avant toute
   commande. Écrire dans le checkout principal est une faute grave.
3. Si `node_modules/@cashless/{api,contracts,ledger-sql,shared-rules}` manque dans la lane : liens
   vers `../../apps/api`, `../../packages/{shared-rules,contracts,ledger-sql}` (`mkdir -p
   node_modules/@cashless` puis `ln -s`). Les autres dépendances se résolvent vers le
   `node_modules` du checkout principal.

## Règles du projet (CLAUDE.md, résumé obligatoire)
- **Sécurité (règle 1)** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré
  ou reporté, secret plus exposé, faux gardé plus longtemps) est soumis au porteur **avant d'être
  codé** : décris-le dans ton compte rendu (risque, options), ne le code pas, continue le reste.
  Un renforcement se fait puis se signale. Ne rouvre jamais un droit pour faire passer un test.
- **Décisions du porteur (20/11/2026)** : agent titulaire détecté par égalité du numéro vérifié du
  compte et de `app_user.phone` de l'agent (limite consignée : agent sans numéro ou autre numéro) ;
  rotation **immédiate** du secret des codes de rattachement, version du secret sur chaque
  empreinte ; réémission par commande d'exploitation (rôle `cashless_claimadmin`, jamais
  `cashless_app`) ; code OTP gardé **en mémoire du processus seulement** pendant la chaîne (35 s au
  plus, effacé dès le dernier envoi), jamais en base ni dans un journal ; `printed_number` en 3e colonne facultative du fichier
  de l'imprimeur.
- **Aucun faux en production** : les trois faux fournisseurs (WhatsApp, SMS principal, SMS de
  repli) refusent le démarrage en production ; un test le prouve et `production-refusals.spec.ts`
  les recense (WP10).
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml` > SPECIFICATION > PRD. Dans la
  mission, `interfaces.md` (noms, signatures, propriétaires, codes) fait foi sur tout prompt,
  `research.md` et `data-model.md`. Un manque ou une contradiction se signale, jamais tranché en
  silence.
- **Contrat** : seuls ajouts permis (WP09) : la description du corps `text/csv`
  d'`importClaimCodeAssociations` (colonne `printed_number`) et les motifs `BAD_PRINTED_NUMBER`,
  `PRINTED_NUMBER_TAKEN` de `ClaimCodeAssociationResult.reason` (ADR-225), inscrits dans
  `contract-baseline.json`. Aucune autre route, aucun champ, aucun code d'erreur exposé nouveau. `node tools/contract-stability/check.mjs` à 0 refus.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/`, `schema_grand_livre_cashless.sql`
  ni une migration existante : migrations `0096` à `0099` seulement.
- **Aucune dépendance nouvelle**. Lignes de 100 caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus les retouches hors carte nommées par le
  prompt, chacune listée dans la note de lane. `apps/api/src/app.module.ts` : une **ligne d'import**
  au plus, hors carte, signalée.
- **Base** : seul **WP04 écrit `post-roles.sql` et `roles.sql`**. WP01 à WP03 n'accordent ni ne
  retirent aucun droit et testent leurs objets en propriétaire. Toute fonction nouvelle : `REVOKE
  ALL … FROM PUBLIC` ; `SECURITY DEFINER` : `SET search_path = public, pg_temp` et prestataire de
  session vérifié. Aucun `DELETE`.
- Tant que WP04 n'est pas fusionné, les suites de droits figées (`tests_execute_grants`, etc.)
  échouent sur les nouveaux objets : normal, ne les touche pas.
- **Chaque contrôle ajouté a une mutation vérifiée** : retire le contrôle, constate que ton test
  échoue, remets-le ; note la mutation et son résultat dans la note de lane.
- **Comptages en test** : toujours limités au prestataire ou à l'objet du test, jamais toute la
  base (suites parallèles en CI, PR #15 et #22).

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres`. **`cashless_test` est réservée à
  l'orchestrateur.** Chaque lot utilise sa base `PGDATABASE=cashless_wpXX`, jamais
  `cashless_test`. Avant tout test : `docker ps` montre `cashless-platform-pg17` sur 5433, sinon
  arrête-toi. Le serveur local accepte toute connexion sans mot de passe (`trust`) : un mot de
  passe de rôle manquant ne se voit qu'en CI ; tout rôle nouveau va aussi dans
  `tools/dev-db/env.sh`, le workflow et `apps/gateway/test/support/disposable-databases.ts` (WP04).
- Remise à zéro depuis la lane : `PGDATABASE=cashless_wpXX bash packages/ledger-sql/scripts/reset-db.sh`.
- pgTAP : `export PATH=<R>/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH`. Depuis
  `packages/ledger-sql/` **de ta lane** : `pg_prove -d cashless_wpXX tests/<fichier>.sql`.
- Jest, depuis `apps/api` de la lane, **dans le même appel Bash** : `export
  PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL` puis
  `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`. Toutes les URL doivent viser ta base.
  Après un Jest, refais `reset-db`.
- Jamais `pg_prove tests/*.sql`, jamais en tâche de fond ; jamais de batterie complète ; toujours
  `--runInBand`.
- **API partagée du porteur (ngrok, `exports/cashless-api`, port 80, base `cashless-api-db-1` sur
  5434) : n'y touche jamais.** Aucun `pkill`, ni port 80 ni 5434.
- Instabilités connues : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, `tests_offline_snapshot_source_no_stats.sql`.

## Fin d'implémentation
1. Avant le commit : `npx eslint <tes fichiers>` et `npx tsc --noEmit -p apps/api/tsconfig.json`
   depuis la lane (la CI lance `npm run lint` et `npm run typecheck` ; piège de la PR #20).
2. Dans la lane : `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer par
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Jamais de push.
3. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission
   serveur-app-festivalier-01M7WB69`.
4. `bash <R>/docs/passation-10a/scripts/align-lane.sh <lettre de ta lane>` (script du **dépôt
   principal**) avant `move-task`. Si un garde `kitty-specs` bloque encore : **pas de `--force`**,
   signale-le.
5. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission
   serveur-app-festivalier-01M7WB69 --note "…"` : la note liste retouches hors carte, écarts,
   noms figés produits, mutations. Attends la fin de la passe de tests qu'elle lance.
6. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan
   (renforce ou affaiblit), points soumis au porteur, fichiers à faire relire par une personne,
   critères couverts (FR/NFR) avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Pars de « Ce que le relecteur doit casser ». Tente aussi : droits de la base, contournement de
  garde, fuite d'un code (base, journaux, audit, réponse), isolation entre prestataires, tests qui
  ne prouvent pas ce qu'ils disent, comptages sur toute la base, écarts à `interfaces.md` non
  signalés. Relance toi-même les tests sur `cashless_wpXX`.
- Verdict : `… move-task WPxx --to approved --mission … --note "…"` ou `--to planned
  --review-feedback-file <fichier>` (constats numérotés, gravité, correction). Pas de `--force`.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
