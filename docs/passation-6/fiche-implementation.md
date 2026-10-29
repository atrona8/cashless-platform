# Fiche commune — implémentation et relecture des lots (mission 6)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`recharges-caisses-psp-01M5YEBA` (`<M>` = `<R>/kitty-specs/recharges-caisses-psp-01M5YEBA`). Planification et fusion
sur `feat/recharges-caisses-psp`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier : l'essentiel est ici.

## Démarrer
1. `cd <R>` puis `spec-kitty agent action implement WPxx --agent claude --mission recharges-caisses-psp-01M5YEBA`
   (implémenteur) ou `spec-kitty agent action review WPxx --agent claude --mission recharges-caisses-psp-01M5YEBA`
   (relecteur). La commande affiche le chemin du prompt du runtime : lis-le, c'est la source du lot.
2. Travaille **uniquement** dans le worktree de la lane indiqué (`<R>/.worktrees/recharges-caisses-psp-01M5YEBA-lane-x`) :
   `cd <lane> || exit 1` avant toute commande. Écrire dans le checkout principal est une faute grave.
3. `node_modules/@cashless/{api,contracts,ledger-sql}` est déjà lié dans la lane (sinon : liens vers
   `../../apps/api`, `../../packages/contracts`, `../../packages/ledger-sql`). Les autres dépendances se résolvent
   vers le `node_modules` du checkout principal.

## Règles du projet (CLAUDE.md, résumé obligatoire)
- **Sécurité** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
  faux gardé) n'est **pas codé** : décris-le dans ton compte rendu avec risque et options, continue le reste. Un
  renforcement se fait puis se signale.
- **Aucun faux en production** : un faux refuse le démarrage en configuration de production, un test le prouve.
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD ; dans la
  mission, `research.md` **R-20 fait foi** sur les sections antérieures, et la section « Arbitrages de
  l'orchestrateur » du prompt prime. Toute contradiction est signalée, jamais tranchée en silence.
- **Jamais** modifier un `.sql` généré de `packages/ledger-sql/` (modifier `gen_tests.py`, `gen_golden.py` ou
  `scenario_reference.json`). Pas de nouvelle dépendance npm. Lignes de 100 caractères au plus.
- Fichiers : seulement les `owned_files` du lot, plus des retouches d'une ligne justifiées hors carte (listées dans
  le compte rendu). `audit.service.ts` (`AuditAction`) : ajouts en fin d'union, une ligne par valeur.

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres` (sans mot de passe). **`cashless_test` est réservée à
  l'orchestrateur.** Chaque lot utilise sa base : `PGDATABASE=cashless_wpXX` (ex. `cashless_wp02`).
- Remise à zéro de ta base depuis la lane : `PGDATABASE=cashless_wpXX bash packages/ledger-sql/scripts/reset-db.sh`.
- pgTAP : `PATH=/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/c1df7274-09c6-4654-9040-fd736a5b47e2/scratchpad/bin:/Library/PostgreSQL/18/bin:$PATH`
  puis, dans `packages/ledger-sql/tests/`, `PGDATABASE=cashless_wpXX pg_prove -d cashless_wpXX <fichier>.sql`
  (ce `pg_prove` s'exécute dans le conteneur). Après un Jest, refaire `reset-db` avant pgTAP.
- Jest ciblé depuis `apps/api` de la lane : `export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh`
  **puis** `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`. `PGDATABASE` seul ne suffit pas :
  `test/support/db.ts` lit `DATABASE_URL_*` et retombe sinon sur `cashless_test` (vu le 29/10). Ne lance
  pas la batterie complète : l'orchestrateur la passe en série.
- Horloge Docker en avance/recul de ~100 ms : aucun test ne compare l'horloge de Node à une date posée par la base.
- Instabilités connues (pas un défaut du lot) : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, latences `config.spec`/`heartbeat.spec` sous Docker.

## Fin d'implémentation
1. Dans la lane : `git status`, `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer le message par
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Rien d'autre que tes fichiers ; jamais de push.
2. `spec-kitty agent tasks mark-status <Txxx…> --status done --mission recharges-caisses-psp-01M5YEBA`.
3. `spec-kitty agent tasks move-task WPxx --to for_review --mission recharges-caisses-psp-01M5YEBA --note "…"`.
   Si un garde `kitty-specs` bloque : **n'utilise pas `--force`**, arrête-toi et signale-le (l'orchestrateur gère).
4. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts au plan (sens : renforce /
   affaiblit), points soumis au porteur, fichiers à faire relire par une personne, critères (FR/NFR/C/SC) couverts
   avec commande de preuve et résultat.

## Relecture (agent distinct de l'implémenteur)
- Tente de casser : droits de la base (EXECUTE, écritures directes, RLS), contournement de garde, double crédit,
  fuite de secret (journaux, réponses, base), isolation entre prestataires, tests qui ne prouvent pas ce qu'ils
  disent, écarts au prompt non signalés. Relance toi-même les tests du lot sur `cashless_wpXX`.
- Verdict : approuver par `spec-kitty agent tasks move-task WPxx --to approved --mission …
  --note "…"` ; rejeter par `--to planned --review-feedback-file <fichier>` (fichier dans le scratchpad, constats
  numérotés, gravité, correction attendue). Si un garde bloque, n'utilise pas `--force` : rends ton verdict et le
  fichier de constats dans ton compte rendu, l'orchestrateur l'enregistre.
- Compte rendu final (≤ 20 lignes) : verdict, constats bloquants, mineurs, preuves relancées.
