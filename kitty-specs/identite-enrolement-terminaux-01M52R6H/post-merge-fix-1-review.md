# Relecture indépendante — correctif post-fusion n° 1 (identite-enrolement-terminaux-01M52R6H)

- **Date** : 22/10/2026
- **Branche, commits** : `feat/identite-enrolement-terminaux`, `814710c` (SEC-2), `941434f`
  (DRIFT-2), `96ea6a4` (documentation)
- **Référentiel** : `post-merge-fix-1.md` (consignes et compte rendu) ; sections SEC-2 et DRIFT-2
  de `mission-review-report.md` ; règles de sécurité de `CLAUDE.md`
- **Relecteur** : agent indépendant. Il n'a pas écrit ce code, ne l'a pas modifié et n'a rien
  commité.

## Verdict : APPROUVÉ

SEC-2 est corrigé : `cashless_app` ne lit plus `code_hash`, ni dans `device_enrollment_code` ni
dans `device_enrollment_attempt`, par aucun des chemins essayés (§1). Les lectures légitimes de
l'API restent possibles. Le test pgTAP échoue si la limite s'élargit, y compris par `PUBLIC` ou par
l'appartenance à un autre rôle (contrôle du contrôle, §1).

DRIFT-2 est corrigé : en production, une durée du jeton d'appareil supérieure à 900 s refuse le
démarrage ; hors production, la plage et le défaut sont inchangés (§2).

L'extension à `device_enrollment_attempt` renforce la sécurité ; elle est signalée comme telle dans
ADR-105, OP-N56 et le compte rendu. Aucun `.sql` généré du kit n'est touché par ces commits.

**Aucun constat bloquant.** Trois observations non bloquantes (§5).

## 1. SEC-2 : base

Fichiers lus :
- `post-roles.sql` §4b (diff et bloc entier) ;
- `tests/tests_device_rights.sql` §1 bis ;
- `src/migrate.ts` (ordre et transaction).

**Ordre de rejeu.** `migrate.ts` exécute les migrations, puis `roles.sql`, puis `post-roles.sql`,
dans une seule transaction (`BEGIN` … `COMMIT`). `roles.sql` rend à chaque rejeu
`SELECT ON ALL TABLES` à `cashless_app`. `post-roles.sql` le retire ensuite au niveau de la table,
ce qui retire aussi les droits par colonne, puis il réaccorde la liste calculée.

Aucune instruction placée après §4b ne réaccorde `SELECT` à `cashless_app` ou à `PUBLIC`. Une
session concurrente ne voit jamais l'état intermédiaire.

**État de la base partagée** (`cashless_test`, migrations jusqu'à 0030), lu par `postgres` :
- `relacl` des deux tables : `postgres` seul. Pas de droit de table pour `cashless_app` ni pour
  `PUBLIC`.
- `attacl` : `cashless_app=r` sur toutes les colonnes sauf `code_hash` (vide).
- `cashless_app` n'est membre d'aucun rôle. Il n'est ni superutilisateur ni `BYPASSRLS`.
- Aucune vue ne dépend des deux tables. Seul déclencheur : `forbid_mutation()` (INVOKER, sur
  `device_enrollment_attempt`), qui ne lit rien.
- `cashless_app` n'a ni `CREATE` sur `public` ni le droit `TEMP` sur la base.

**Fonctions qui citent `code_hash`.** Celles des terminaux sont SECURITY DEFINER, avec
`search_path = public, pg_temp` :
- `create_device_enrollment_code` ;
- `check_device_enrollment_code` ;
- `enroll_device` ;
- `record_enrollment_attempt` ;
- `enrollment_attempts_exceeded` ;
- `record_enrollment_refusal`.

Aucune ne rend `code_hash` : elles rendent un `uuid`, un booléen, `void`, ou les colonnes
d'affectation du code. Les autres fonctions qui citent une colonne `code_hash` portent sur les codes
de réclamation des supports (`media_claim_code`). Elles sont hors du périmètre de SEC-2.

**Sondes depuis `cashless_app`**, dans une transaction annulée (`BEGIN; SET LOCAL ROLE
cashless_app; … ROLLBACK;`). Script :
`/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/3116812f-960f-485e-a64e-5e6432a6e664/scratchpad/review/probe.sql`.

| # | Tentative | Résultat |
|---|---|---|
| P1 | `SELECT code_hash FROM device_enrollment_code` | `permission denied` |
| P2 | `SELECT *` (code) | `permission denied` |
| P3 | `TABLE device_enrollment_attempt` | `permission denied` |
| P4 | Ligne entière : `t::text`, `to_jsonb(t)`, `count(t)` | `permission denied` (×3) |
| P5 | `WHERE code_hash = …`, `ORDER BY code_hash`, `count(code_hash)`, `JOIN … USING (code_hash)`, `substr(code_hash, …)`, `EXISTS` corrélé sur `code_hash` | `permission denied` (×6) |
| P6 | `UPDATE … RETURNING code_hash`, `DELETE … RETURNING code_hash` | `permission denied` (×2) |
| P7 | `COPY (code_hash) TO STDOUT`, `COPY device_enrollment_attempt TO STDOUT` | `permission denied` (×2) |
| P8 | `EXPLAIN SELECT code_hash …` | `permission denied` |
| P9 | Vue temporaire, fonction INVOKER dans `pg_temp`, vue dans `public` | refusées en amont : pas de `TEMP`, pas de `CREATE` sur `public` |
| P10 | `pg_stats` sur `code_hash` | 0 ligne pour `cashless_app` ; 2 lignes pour `postgres` (les statistiques existent, mais elles sont filtrées par le droit de colonne) |
| P11 | `has_column_privilege(…, 'code_hash', 'SELECT')` (deux tables), `has_table_privilege(…, 'SELECT')` | `false` partout |
| P13 | Témoins des chemins légitimes : requête exacte de `listDeviceEnrollmentCodes` (avec jointure `event` et `ORDER BY created_at, id`), `SELECT expires_at, app_mode … WHERE id` (création), `SELECT result … WHERE address << …` | acceptées |
| P14 | `enrollment_attempts_exceeded`, `check_device_enrollment_code` | appelables (DEFINER) ; aucune empreinte rendue |

P12 (`SET ROLE postgres` depuis `cashless_app`) passe, mais c'est un artefact de la sonde : la
session est ouverte par le superutilisateur. L'API se connecte directement en `cashless_app`.

**Lectures de l'API.** Fichiers lus :
- `enrollment-codes.service.ts` : création par `create_device_enrollment_code`, puis
  `SELECT expires_at, app_mode … WHERE id` ; la liste nomme ses colonnes, sans `code_hash`.
- `enrollment.service.ts` : `enroll_device`, `record_enrollment_attempt`,
  `enrollment_attempts_exceeded`, `check_device_enrollment_code`, `record_enrollment_refusal`.
  Sa seule lecture directe porte sur `device` et `device_refresh_token`.
- `device-maintenance.ts` : fonctions de purge seulement.

`grep` sur `apps/` : aucun autre fichier de `src/` ne lit ces deux tables. Les tests Jest qui lisent
`code_hash` passent tous par `withOwner` ou `ownerRows`. Je l'ai vérifié dans :
- `enrollment.spec.ts` ;
- `enrollment-limits.spec.ts` ;
- `device-secrets.spec.ts`.

`device-isolation.spec.ts` ne lit que des colonnes accordées.

**Test pgTAP §1 bis.** Il contient :
- les listes exactes des colonnes lisibles, calculées par `has_column_privilege`. Ce calcul compte
  `PUBLIC` et l'appartenance aux rôles ;
- l'absence de `SELECT` sur la table entière ;
- six `throws_ok … '42501'` (colonne, `SELECT *`, ligne entière, filtre) ;
- un témoin `lives_ok` des colonnes de la liste.

Le fichier est en `no_plan()` : l'ajout ne demande pas de recompter le plan.

**Contrôle du contrôle.** Les requêtes des assertions de §1 bis sont rejouées après chaque
élargissement. Chaque élargissement est fait dans une transaction annulée. Script :
`/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/3116812f-960f-485e-a64e-5e6432a6e664/scratchpad/review/control.sql`.

| # | Élargissement | Assertions de §1 bis |
|---|---|---|
| C0 | aucun (état actuel) | toutes vertes |
| C1 | `GRANT SELECT` sur les deux tables | les 4 échouent |
| C2 | `GRANT SELECT (code_hash) ON device_enrollment_attempt` | la liste de `device_enrollment_attempt` échoue |
| C3 | `GRANT SELECT ON device_enrollment_code TO PUBLIC` | la liste et le droit de table de `device_enrollment_code` échouent |
| C4 | rôle tiers qui lit `code_hash`, accordé à `cashless_app` | la liste de `device_enrollment_code` échoue |
| C5 | nouvelle colonne ajoutée, puis rejeu de `roles.sql` (`GRANT SELECT ON ALL TABLES`) et du bloc §4b | la liste échoue : la nouvelle colonne devient lisible et le test le signale |
| C6 | rejeu de `roles.sql` et de §4b, deux fois | toutes vertes ; `code_hash` sans droit (idempotent) |
| C8 | après les annulations | toutes vertes ; base inchangée |

C5 montre le comportement voulu. Une colonne ajoutée plus tard devient lisible par défaut, comme
pour `media` (liste calculée). La liste exacte du test oblige alors à décider explicitement.

## 2. DRIFT-2 : démarrage

J'ai lu le diff de `config.ts` et de `config.spec.ts`, ainsi que `boundedInt` et `deviceSettings`.

- En production, `max` vaut `DEVICE_TOKEN_TTL_MAX_PRODUCTION` (900). Au-delà, `loadConfig` lève
  « `DEVICE_TOKEN_TTL_SECONDS : entier de 60 à 900 attendu (reçu « 901 »)` ». Le message est
  clair. La valeur reste obligatoire en production (« manquant : entier de 60 à 900 obligatoire en
  production »).
- Hors production, la plage reste 60 à 3600 et le défaut reste 900.
- Le drapeau `production` est celui de `loadConfig` (`nodeEnv(env.NODE_ENV) === 'production'`).
  `NODE_ENV` est obligatoire et validé.
- Ce que vérifie le test :
  - en production : 901 et 3600 refusés, 900 accepté, absence refusée ;
  - hors production : 3600 accepté, 3601 refusé, défaut 900 ;
  - le tableau `it.each` de production est passé de `['60', '3600']` à `['60', '900']` et refuse
    `901`.
- **Autres chemins.** `grep deviceTokenTtlSeconds` ne trouve qu'un consommateur :
  `DeviceTokenService.issue` (`exp = iat + deviceTokenTtlSeconds`). L'enrôlement et le
  rafraîchissement (`refresh.service.ts`) ne font que relayer `expiresIn`. Aucun paramètre ne
  surcharge la durée.
- Valeurs d'environnement fournies : `tools/dev-db/env.sh`, `env.test.example` et la CI fixent
  900. Toutes sont compatibles avec la borne.

## 3. Documentation et fichiers du kit

- **ADR-105** : complément « Fait le 22/10/2026 », avec le commit, les deux tables et le test. Il
  dit que la limite sur l'auteur et les preuves reste (OP-N56). L'extension à
  `device_enrollment_attempt` est présentée comme un « renforcement en plus », avec sa raison.
- **OP-N56** : même complément. Le point reste ouvert, avec la mission 11 pour sa levée.
- **Compte rendu** (`post-merge-fix-1.md`) : il correspond aux diffs. J'ai vérifié les fichiers,
  les colonnes, le message d'erreur et les cas de test.
- **Règle 3 de `CLAUDE.md`** : elle vise les écarts qui affaiblissent la sécurité. Les deux
  changements la renforcent : la règle 1 demande de les faire, puis de les consigner. C'est fait
  pour SEC-2 (ADR-105, OP-N56). DRIFT-2 aligne le code sur la spécification et le contrat
  (15 min) : il ne laisse aucun écart, et aucun document global ne citait la plage 60 à 3600. Pas
  d'ADR requis.
- **Fichiers du kit** : les trois commits ne touchent que `post-roles.sql` (fichier de la mission),
  `tests/tests_device_rights.sql`, `config.ts`, `config.spec.ts` et des documents. Ils ne modifient
  ni `roles.sql`, ni le schéma, ni les générateurs, ni `scenario_reference.json`, ni aucun `.sql`
  généré.

  La ligne `app_probe` de `tests_grand_livre_cashless.sql`, différente de `main`, vient de la fusion
  de la mission et de `gen_tests.py`. Elle a déjà été relevée par la revue post-fusion : elle est
  hors du périmètre du correctif.
- **Lignes et langue** : toutes les lignes ajoutées au code (`.sql`, `.ts`) font 100 caractères au
  plus. Les commentaires sont en français.

## 4. Écarts de sécurité ouverts (règle 4)

Le correctif n'ouvre aucun écart. Il en resserre deux. Les limites qui subsistent sont toutes déjà
consignées :
- **OP-N56** : la base croit l'auteur et les preuves que l'API lui donne ;
- **OP-N73** : autorité des terminaux et signataire en faux ;
- **OP-N74 / ADR-120** et **OP-N75** : consignés à la revue post-fusion.

## 5. Observations (non bloquantes)

**O1 — Journal de `docs/06-docs-status.md` non renseigné.** Le correctif post-fusion n° 1 de
`bracelets-nfc` y a sa ligne (16/10/2026). Celui-ci n'en a pas encore. Il faut ajouter une ligne
« Correctif post-fusion » pour la mission 5a : ADR-105 et OP-N56 complétés, aucun document global
à reprendre, sauf peut-être 09 ou 04 si l'on y décrit les droits de `cashless_app` par table.

**O2 — Portée réelle de SEC-2.** `cashless_app` peut toujours appeler
`check_device_enrollment_code(empreinte, …)` et `enrollment_attempts_exceeded(empreinte, …)`. Ce
n'est pas une lecture d'empreinte : il faut déjà connaître l'empreinte, donc la clé HMAC, qui est
hors de la base.

Le gain vaut donc contre un accès à la seule connexion de la base (injection, identifiants volés).
Il ne vaut pas contre une API compromise qui détient `ENROLLMENT_CODE_HMAC_KEY`. ADR-105 le dit en
substance (« la limite … reste ») ; rien à changer.

**O3 — Durée non revérifiée à la vérification du jeton** (suggestion de défense en profondeur).
`DeviceTokenService.verify` contrôle `exp` mais pas `exp - iat`. Un jeton signé avec une durée
plus longue serait accepté jusqu'à son `exp`. Pour cela, il faut le signataire, donc OP-N73.

Contrôler `exp - iat <= deviceTokenTtlSeconds` à la vérification rendrait la borne de production
effective même face à un signataire mal réglé. Ce point peut aller à la mission 7, qui reprend le
signataire réel.

Les lignes ajoutées aux documents Markdown dépassent 100 caractères (jusqu'à 119). Elles suivent la
largeur de 120 déjà employée dans `DECISIONS_ADR.md`, `POINTS_OUVERTS.md` et les consignes. Prettier
ne couvre pas le Markdown.

## 6. Ce que le relecteur a lancé

- Lecture de l'état de la base et sondes, en `psql` sur `cashless_test`, toutes dans des
  transactions annulées (scripts `state.sql`, `probe.sql`, `control.sql` dans
  `/private/tmp/claude-501/-Users-xaamga-Documents-omar-sylla-work-cashless-cashless-platform/3116812f-960f-485e-a64e-5e6432a6e664/scratchpad/review/`).
  L'état final est identique à l'état initial (C8).
- Ni `reset-db`, ni Jest, ni la suite pgTAP complète. Je n'ai pas relancé moi-même les résultats
  annoncés par l'implémenteur : pgTAP 2083/2083, Jest des terminaux 118/118, lint, typecheck,
  `format:check`, `check:generated`.

## 7. Fichiers à faire relire par une personne (règle 4)

- `packages/ledger-sql/post-roles.sql` §4b : droits par colonne, liste calculée.
- `packages/ledger-sql/tests/tests_device_rights.sql` §1 bis.
- `apps/api/src/config/config.ts` (`DEVICE_TOKEN_TTL_MAX_PRODUCTION`, `deviceSettings`).

L'agent qui a écrit ce code et ce relecteur ne valent pas relecture humaine indépendante.
