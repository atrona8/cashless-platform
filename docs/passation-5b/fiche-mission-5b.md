# Fiche de contexte commune — mission 5b `terminaux-paiement-en-ligne-01M52QB9`

Lis cette fiche, puis seulement les fichiers listés dans ton message de lancement. Ne relis PAS en entier CLAUDE.md,
README.md ni docs/SPECIFICATION.md sauf besoin précis (une section citée).

## Chemins
- Checkout principal (branche `feat/terminaux-paiement-en-ligne`, cible de la mission) :
  `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` — n'y écris rien, ne commite rien.
- Artefacts de mission (lecture) : `<principal>/kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` (spec.md, plan.md,
  data-model.md, research.md, contracts/, tasks/WPxx-*.md).
- Lanes : `<principal>/.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-<x>` (branche
  `kitty/mission-terminaux-paiement-en-ligne-01M52QB9-lane-<x>`). lane-a = WP01, lane-b = WP02, lane-c = WP03, lane-d = WP04, lane-f = WP06, lane-h = WP08.
  Toujours `cd <lane> || exit 1` avant une commande git.
- Les lanes n'ont pas de `node_modules` : la résolution Node remonte au `node_modules` du checkout principal
  (anciens types de `@cashless/contracts`). Pour `typecheck`/`jest` dans une lane, créer d'abord
  `node_modules/@cashless/{api,contracts,ledger-sql}` en liens vers `../../apps/api`, `../../packages/contracts`,
  `../../packages/ledger-sql` (non commités).

## Règles du projet (extraits utiles de CLAUDE.md)
1. Écart qui affaiblit la sécurité (droit plus large, contrôle retiré/reporté, secret plus exposé, faux gardé) :
   **jamais en silence** ; ne pas le coder, le décrire dans le compte rendu (risque + options) et continuer le reste.
   Un renforcement se fait, puis se signale.
2. Aucun faux en production. 3. Dette nommée (l'orchestrateur s'occupe des ADR/points ouverts).
4. Priorité des sources : tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD.
   Signaler toute contradiction, ne jamais choisir en silence.
- Ne jamais modifier les `.sql` générés de `packages/ledger-sql/` (tests_grand_livre_cashless.sql,
  scenario_reference_test.sql…) : passer par les générateurs.
- Lignes de 100 caractères (Prettier configuré).
- Écrire seulement dans les fichiers du lot (`owned_files` de l'en-tête du WP). Toute retouche hors carte : une ligne
  de justification dans le compte rendu.

## Base de données — IMPORTANT
- La base de test partagée `cashless_test` (Docker, 127.0.0.1:5433, utilisateur `postgres` sans mot de passe) est
  réservée à l'orchestrateur : **ne lance ni `reset-db`, ni `test:pgtap`, ni Jest dessus.**
  Attention : les tests Jest (`apps/api/test/support/db.ts`, `src/config/config.ts`) visent `cashless_test` en
  dur ; `PGDATABASE` ne suffit pas. Pour Jest sur ta base, pose toutes les `DATABASE_URL_*` (OWNER, APP, PLATFORM,
  TAGKEYS, PERSO, TAGCHECK, KEYADMIN…) vers `cashless_wpXX`, sinon ne lance pas Jest.
- Pour valider du SQL, utilise **ta propre base** sur le même serveur Docker (pgTAP n'existe que là), nommée
  `cashless_wpXX` (XX = numéro de ton lot), jamais `cashless_test`. Depuis la lane :
  `export PATH=<SCRATCHPAD>/bin:/Library/PostgreSQL/18/bin:$PATH PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wpXX`
  puis `bash packages/ledger-sql/scripts/reset-db.sh` (recrée ta base, applique migrations + roles.sql +
  post-roles.sql) et `cd packages/ledger-sql && pg_prove -d cashless_wpXX tests/<ta suite>.sql`. Avant de conclure,
  rejoue aussi la batterie complète du paquet sur ta base (`bash scripts/test-pgtap.sh` avec PGDATABASE réglé),
  après un `reset-db`. Les rôles sont globaux au serveur : si `roles.sql` échoue sur un conflit de rôle (un autre
  lot rejoue au même moment), réessaie une fois. Supprime ta base à la fin (`dropdb cashless_wpXX`).
- Horloge : ne jamais comparer l'horloge de Node à une date posée par la base ; pas de dates en dur qui supposent
  « aujourd'hui » (les tests doivent passer n'importe quel jour) ; utiliser `now()`/`clock_timestamp()` relatifs.

## Procédure du lot
- Le prompt du WP (`tasks/WPxx-*.md`) est la source du lot ; ses « Arbitrages de l'orchestrateur » priment.
- Commit dans la lane uniquement, fichiers du lot seulement, message `feat(WPxx): …` terminé par
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ne touche pas à `kitty-specs/` dans la lane (ni
  `status.json`/`status.events.jsonl`, qui doivent rester).
- Marquer chaque sous-tâche : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9` (lancé depuis le checkout principal ; si refusé, le dire).
- Ne fais PAS `move-task` : l'orchestrateur passe le lot en relecture après avoir rejoué les tests en série.
- Compte rendu : écris-le dans `<scratchpad>/rapports/WPxx-implementation.md` (scratchpad ci-dessus), au format
  « Compte rendu du lot » demandé par la Definition of Done du WP (écarts au plan avec leur sens, retouches hors carte,
  points soumis au porteur/orchestrateur, fichiers à faire relire par une personne, critères d'acceptation couverts
  avec leur preuve : commande + résultat). Ta réponse finale : 10 lignes max (état, commit, tests, points bloquants).

## Pour les relecteurs
- Tu n'as pas écrit le code : relis-le contre le prompt du WP, la spec, le data-model et les contrats, en cherchant
  surtout ce qui affaiblit la sécurité (droits, SECURITY DEFINER sans `search_path`, verrous, fuites d'information,
  contrôles manquants) et les tests qui ne prouvent pas ce qu'ils disent.
- Prompt de relecture : `spec-kitty agent action review WPxx --agent claude --mission
  terminaux-paiement-en-ligne-01M52QB9` depuis le checkout principal (il peut changer l'état du lot : c'est voulu).
- Tests : ta propre base `cashless_wpXXr` (même procédure que ci-dessus), jamais `cashless_test`. Supprime-la à la fin.
- Verdict : écris-le dans `<scratchpad>/rapports/WPxx-review-cycle-N.md` (APPROUVÉ ou REJETÉ ; constats numérotés avec
  gravité bloquant/majeur/mineur, fichier:ligne, scénario d'échec, correction attendue). Tente toi-même l'enregistrement
  (`move-task WPxx --to approved --note …` ou `--to planned --review-feedback-file <fichier>`) ; si le garde
  kitty-specs ou le contrôle de permission le refuse, ne force pas : dis-le, l'orchestrateur l'enregistrera en ton nom.
- Les défauts antérieurs à la mission (pas introduits par le lot) : les signaler à part, sans rejeter pour eux seuls.
