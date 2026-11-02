# Fiche commune — implémentation et relecture des lots (mission 7)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`hors-ligne-snapshots-lots-01M645RN` (`<M>` = `<R>/kitty-specs/hors-ligne-snapshots-lots-01M645RN`). Planification
et fusion sur `feat/hors-ligne-snapshots-lots`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier :
l'essentiel est ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C LANG=C`** (git en français casse 4.0.0rc7).

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   hors-ligne-snapshots-lots-01M645RN` (implémenteur) ou `… action review WPxx …` (relecteur). La commande affiche
   le chemin du prompt du runtime : lis-le, c'est la source du lot.
2. Travaille **uniquement** dans le worktree de la lane indiqué
   (`<R>/.worktrees/hors-ligne-snapshots-lots-01M645RN-lane-x`) : `cd <lane> || exit 1` avant toute commande.
   Écrire dans le checkout principal est une faute grave.
3. Si `node_modules/@cashless/{api,contracts,ledger-sql}` manque dans la lane : liens vers `../../apps/api`,
   `../../packages/contracts`, `../../packages/ledger-sql` (`mkdir -p node_modules/@cashless` puis `ln -s`). Les
   autres dépendances se résolvent vers le `node_modules` du checkout principal.

## Règles du projet (CLAUDE.md, résumé obligatoire)
- **Sécurité** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
  faux gardé) n'est **pas codé** : décris-le dans ton compte rendu avec risque et options, continue le reste. Un
  renforcement se fait puis se signale.
- **Aucun faux en production** : un faux refuse le démarrage en configuration de production, un test le prouve.
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD ; dans la
  mission, `research.md` **R-30 fait foi**, `contracts/interfaces.md` fige noms, signatures, migrations et SQLSTATE
  (ne les change jamais : un manque se signale). Toute contradiction est signalée, jamais tranchée en silence.
- Décisions du porteur à respecter : aucune recharge espèces hors ligne ; deux processus de snapshots ; trace `RETRY`
  (ADR-139) ; exposition stricte ; droits ajoutés d'ADR-140 seulement ; `offline_block_time` = date la plus ancienne.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/` (schéma de référence,
  `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`). Pas de nouvelle dépendance npm. Lignes de 100
  caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus les retouches hors carte nommées par le prompt
  (`audit.service.ts`, `config.ts`, `package.json`, `jest.config.cjs`, `app.module.ts`, et celles du prompt),
  chacune listée dans le compte rendu. `AuditAction` : ajouts en fin d'union, une ligne par valeur.
- Lots de base (WP02 à WP07) : `REVOKE ALL … FROM PUBLIC` sur chaque fonction, aucun `GRANT` (WP08), tests pgTAP
  **sous le propriétaire seulement**. Toute table nouvelle : `operator_id`, RLS `tenant_isolation` ENABLE + FORCE.

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres` (sans mot de passe). **`cashless_test` est réservée à
  l'orchestrateur.** Chaque lot utilise sa base : `PGDATABASE=cashless_wpXX` (ex. `cashless_wp02`).
- Remise à zéro de ta base depuis la lane : `PGDATABASE=cashless_wpXX bash packages/ledger-sql/scripts/reset-db.sh`.
- pgTAP : `export PATH=/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/37744718-0c4b-42c2-917c-75d3376803cb/scratchpad/bin:/Library/PostgreSQL/18/bin:$PATH`
  puis, depuis `packages/ledger-sql/tests/` **de ta lane**, `pg_prove -d cashless_wpXX <fichier>.sql` (ce lanceur
  copie `packages/ledger-sql` de ta lane dans le conteneur et y lance `pg_prove`). Après un Jest, refaire `reset-db`.
- Jest ciblé depuis `apps/api` de la lane : `export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh`
  **puis** `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`. `PGDATABASE` seul ne suffit pas :
  `test/support/db.ts` lit `DATABASE_URL_*` et retombe sinon sur `cashless_test`. Ne lance pas la batterie
  complète : l'orchestrateur la passe en série.
- Horloge Docker en avance/recul de ~100 ms : aucun test ne compare l'horloge de Node à une date posée par la base.
- Instabilités connues (pas un défaut du lot) : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, latences `config.spec`/`heartbeat.spec` sous Docker.

## Fin d'implémentation
1. Dans la lane : `git status`, `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer le message par
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Rien d'autre que tes fichiers ; jamais de push.
2. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission hors-ligne-snapshots-lots-01M645RN`.
3. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission hors-ligne-snapshots-lots-01M645RN
   --note "…"` : la commande lance une passe de tests et peut durer quelques minutes, attends qu'elle rende la main.
   Si un garde `kitty-specs` bloque : **n'utilise pas `--force`**, arrête-toi et signale-le (l'orchestrateur gère).
4. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan (sens : renforce /
   affaiblit), points soumis au porteur, fichiers à faire relire par une personne, critères (FR/NFR) couverts
   avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Pars de la section « Ce que le relecteur doit casser » du prompt. Tente aussi : droits de la base (EXECUTE,
  écritures directes, RLS), contournement de garde, double écriture, fuite de secret (journaux, réponses, base),
  isolation entre prestataires, tests qui ne prouvent pas ce qu'ils disent, écarts au prompt ou à `interfaces.md`
  non signalés. Relance toi-même les tests du lot sur `cashless_wpXX`.
- Verdict : approuver par `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to approved --mission … --note "…"` ;
  rejeter par `--to planned --review-feedback-file <fichier>` (fichier dans le scratchpad, constats numérotés,
  gravité, correction attendue). Si un garde bloque, n'utilise pas `--force` : rends ton verdict et le fichier de
  constats dans ton compte rendu, l'orchestrateur l'enregistre.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
