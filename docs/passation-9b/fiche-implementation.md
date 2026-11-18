# Fiche commune — implémentation et relecture des lots (mission 9b)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`versements-rapprochements-cloture-01M7JT4G` (`<M>` = `<R>/kitty-specs/<mission>`). Planification et
fusion sur `feat/versements-rapprochements-cloture`. Ne relis pas CLAUDE.md, README ni la
SPECIFICATION en entier : l'essentiel est ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C
LANG=C`**.

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   versements-rapprochements-cloture-01M7JT4G` (implémenteur) ou `… action review WPxx …`
   (relecteur). La commande affiche le chemin du prompt du runtime : lis-le, c'est la source du lot.
2. Travaille **uniquement** dans le worktree de la lane
   (`<R>/.worktrees/versements-rapprochements-cloture-01M7JT4G-lane-x`) : `cd <lane> || exit 1`
   avant toute commande. Écrire dans le checkout principal est une faute grave.
3. Si `node_modules/@cashless/{api,contracts,ledger-sql,shared-rules}` manque dans la lane : liens
   vers `../../apps/api`, `../../packages/{shared-rules,contracts,ledger-sql}` (`mkdir -p
   node_modules/@cashless` puis `ln -s`). Les autres dépendances se résolvent vers le `node_modules`
   du checkout principal.

## Règles du projet (CLAUDE.md, résumé obligatoire)
- **Sécurité (règle 1)** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré
  ou reporté, secret plus exposé, faux gardé plus longtemps) est soumis au porteur **avant d'être
  codé** : décris-le dans ton compte rendu (risque, options), ne le code pas, continue le reste. Un
  renforcement se fait puis se signale. Écarts déjà acceptés : copie des scellements simulée,
  alertes sans envoi (12b).
- **Aucun faux en production** : un faux refuse le démarrage en production, un test le prouve.
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION >
  PRD. Dans la mission, `contracts/interfaces.md` (noms, propriétaires, codes d'alarme, ordre des
  verrous) et `contracts/contract-additions.md` (contrat validé par le porteur le 17/11/2026) font
  foi sur tout prompt, `research.md` et `data-model.md`. Un manque ou une contradiction se signale,
  jamais tranché en silence.
- Décisions du porteur : `docs/passation-9b/contexte-9b.md`. Paiement manuel : l'API ne verse rien.
- **Contrat** : exactement `contract-additions.md` : rien d'autre ajouté, rien d'existant modifié.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/` (`tests_grand_livre_cashless.sql`,
  `scenario_reference_test.sql`) ni `schema_grand_livre_cashless.sql` : migrations `0083` et
  suivantes.
- **Aucune dépendance nouvelle** (npm, extension SQL). Lignes de 100 caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus les retouches hors carte nommées par le
  prompt, chacune listée dans la note de lane. `apps/api/src/app.module.ts` est possédé par WP07 :
  les autres lots n'y ajoutent qu'**une ligne d'import**, hors carte, signalée dans leur note (union
  à la consolidation).
- **Base** : seul **WP06 écrit `post-roles.sql`** (section 12). WP02 à WP05 n'accordent aucun droit
  et testent leurs objets en propriétaire. Toute fonction nouvelle : `REVOKE ALL … FROM PUBLIC` ;
  SECURITY DEFINER : `SET search_path = public, pg_temp` et `assert_tenant` (sauf `ops_*`). Toute
  table nouvelle : `operator_id`, RLS `tenant_isolation` ENABLE + FORCE, garde de portée. Aucun
  `DELETE`.
- Tant que WP06 n'est pas fusionné, les suites de droits figées (`tests_execute_grants`,
  `tests_offline_rights`) échouent sur les nouveaux objets : normal, ne les touche pas (hors carte).

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres`. **`cashless_test` est réservée à
  l'orchestrateur.** Chaque lot utilise sa base `PGDATABASE=cashless_wpXX` (ex. `cashless_wp02`),
  jamais `cashless_test`. Avant tout test : `docker ps` montre `cashless-platform-pg17` sur 5433,
  sinon arrête-toi.
- Remise à zéro depuis la lane : `PGDATABASE=cashless_wpXX bash
  packages/ledger-sql/scripts/reset-db.sh`.
- pgTAP : `export PATH=<R>/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH` (le
  wrapper `pg_prove` de la 9a est générique : copie le dossier courant dans le conteneur ; on le
  réutilise tel quel). Depuis `packages/ledger-sql/` **de ta lane** : `pg_prove -d cashless_wpXX
  tests/<fichier>.sql`.
- Jest, depuis `apps/api` de la lane, **dans le même appel Bash** : `export
  PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL` puis
  `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`. `source env.sh` dans un appel
  précédent ne vaut pas : l'état du shell ne persiste pas. `PGDATABASE` seul ne suffit pas
  (`test/support/db.ts` retombe sur `cashless_test`). Toutes les URL doivent viser ta base. Après un
  Jest, refais `reset-db`.
- Jamais de batterie complète (l'orchestrateur la passe en série, `--maxWorkers=2`) ; toujours
  `--runInBand`.
- **API partagée du porteur (ngrok, `exports/cashless-api`, port 80, base Docker `cashless-api-db-1`
  sur 5434) : n'y touche jamais.** Ne lance jamais `pkill -f dist/main.js` ni aucun `pkill`,
  n'utilise ni le port 80 ni le 5434, ne l'arrête pas.
- Instabilités connues : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, latences `config.spec`/`heartbeat.spec` sous Docker.

## Fin d'implémentation
1. Dans la lane : `git status`, `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer
   le message par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Jamais de push.
2. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission
   versements-rapprochements-cloture-01M7JT4G`.
3. Si `docs/passation-9b/scripts/align-lane.sh` existe, lance-le avant `move-task` (réalignement des
   artefacts `kitty-specs`). Sinon, si un garde `kitty-specs` bloque : **pas de `--force`**,
   signale-le.
4. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission
   versements-rapprochements-cloture-01M7JT4G --note "…"` : la note de lane liste les retouches hors
   carte (dont l'import d'`app.module.ts`), les écarts, les noms figés produits. La commande lance
   une passe de tests : attends qu'elle rende la main.
5. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan
   (renforce ou affaiblit), points soumis au porteur, fichiers à faire relire par une personne,
   critères couverts (FR/NFR) avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Pars de « Ce que le relecteur doit casser ». Tente aussi : droits de la base, contournement de
  garde, double écriture, fuite de secret, isolation entre prestataires, tests qui ne prouvent pas
  ce qu'ils disent, écarts au prompt ou à `interfaces.md` non signalés. Relance toi-même les tests
  sur `cashless_wpXX`.
- Verdict : `… move-task WPxx --to approved --mission … --note "…"` ou `--to planned
  --review-feedback-file <fichier>` (constats numérotés, gravité, correction). Pas de `--force`.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
