# Research — Fondations du grand livre et de l'API

Mission `fondations-grand-livre-01M4AY8M` · 2026-10-07. Format : décision, justification, alternatives.

## R-01 — pgTAP en local : cluster PostgreSQL 17 privé

- **Constat** : les suites générées commencent par `CREATE EXTENSION IF NOT EXISTS pgtap` ;
  `C:\Program Files\PostgreSQL\17\share\extension` est en lecture seule sans droits admin (vérifié : `touch` →
  `Permission denied`) ; aucun Docker. La décision specify « charger pgTAP en SQL » (DM-01M4AYCMYA…) ne suffit donc
  pas : charger `pgtap.sql` à la main ne crée pas d'entrée `pg_extension` et l'instruction échoue.
- **Décision** (DM-01M4B0BATN…) : `tools/dev-db/setup.sh` copie `bin/`, `lib/`, `share/` du PostgreSQL 17 installé
  vers `%LOCALAPPDATA%\cashless-pg17` (hors dépôt), télécharge la release pgTAP épinglée (SHA-256 vérifié),
  produit `pgtap--<v>.sql` et `pgtap.control` sans `make` (substitutions de `pgtap.sql.in` faites par le script ;
  pgTAP est du SQL pur, sans bibliothèque C), les place dans `share/extension` de la copie, puis `initdb` un cluster
  sur le port **5433** (auth `trust` sur `127.0.0.1` uniquement). `pg_prove` : module CPAN pur Perl
  `TAP::Parser::SourceHandler::pgTAP` installé dans un `local::lib` du profil, exécuté par le Perl de Git Bash.
- **À vérifier en premier** : PostgreSQL Windows calcule `sharedir`/`pkglibdir` relativement à l'exécutable (copie
  relocalisable) — contrôle par `pg_config --sharedir` depuis la copie, et `CREATE EXTENSION pgtap` sur le cluster.
- **Alternatives** : copie admin unique dans Program Files (rejetée : droits admin) ; WSL 1 Ubuntu (rejetée : second
  environnement, E/S lentes) ; CI seulement (rejetée : pas de remote).

## R-02 — Migrations

- **Décision** : fichiers SQL numérotés dans `packages/ledger-sql/migrations/`, exécutés par
  `packages/ledger-sql/src/migrate.ts` (`pg`) : table `schema_migrations (version, checksum, applied_at)`, une
  transaction par migration, refus si la somme de contrôle d'une migration appliquée a changé. `0001` inclut le
  schéma de référence **par lecture du fichier** `schema_grand_livre_cashless.sql` (pas de copie, donc pas de
  dérive). Après chaque série, `roles.sql` est rejoué (idempotent : `CREATE ROLE` conditionnel, `GRANT`/`REVOKE`),
  ce qui donne leurs droits aux tables nouvelles et retire de nouveau ceux du grand livre. Rôle d'exécution : le
  propriétaire des tables (jamais `cashless_app`).
- **Vérifié** : le schéma ne contient ni `CONCURRENTLY` ni `VACUUM` (seulement `CREATE EXTENSION pgcrypto`),
  donc compatible avec une transaction par migration.
- **Alternatives** : node-pg-migrate, graphile-migrate, Flyway (rejetés : DSL ou JVM, dépendances, sans gain).

## R-03 — Accès base et cloisonnement

- **Décision** : `pg` 8, pool unique en `cashless_app`. Parseur de type `int8` (OID 20) → `BigInt` ; `numeric`
  interdit pour les montants. Toute requête passe par `withTenantTx(operatorId, fn)` :
  `BEGIN` → `SELECT set_config('app.operator_id', $1, true)` → `fn(client)` → `COMMIT` (ou `ROLLBACK`).
  Le pool n'est pas exporté hors de `apps/api/src/db` ; un test d'architecture échoue si un autre module l'importe.
- **Tests** : (a) deux prestataires, lecture croisée → aucune ligne / `NOT_FOUND` ; (b) requête sans `set_config`
  → 0 ligne visible (RLS forcée) ; (c) même connexion physique réutilisée par A puis B → B ne voit rien de A ;
  (d) `SHOW transaction_timeout|statement_timeout|idle_in_transaction_session_timeout` sur une connexion du pool.
- **Alternatives** : Prisma / TypeORM / Kysely (rejetés : la logique est en fonctions SQL ; un ORM masquerait
  `set_config` et les SQLSTATE).

## R-04 — Erreurs : SQLSTATE → ProblemCode

- **Décision** : table déclarative (voir [contracts/problem-mapping.md](contracts/problem-mapping.md)) lue par un
  filtre d'exceptions global. Seul `err.code` (SQLSTATE) est lu, jamais `err.message`. Réponse : `type`, `title`,
  `status`, `detail`, `code`, `instance` (= `X-Request-Id`). `title`/`detail` viennent du catalogue fr/en indexé par
  `ProblemCode`. Le message SQL complet n'est écrit que dans le journal serveur, avec `X-Request-Id`.
- `23514` (`check_violation`) : `FORBIDDEN` si la contrainte violée (`err.constraint`) est l'une des contraintes de
  double validation (`BACKOFFICE` sans valideur distinct), sinon `VALIDATION_FAILED` ; ces `CHECK` sont
  anonymes dans le schéma (noms générés `journal_transaction_check…`) : la table figée associe le nom généré à la
  définition attendue, et un test compare à `pg_get_constraintdef` (échec si le schéma les renumérote).
- Codes de §5.7 tous présents dans l'énumération `ProblemCode` du contrat (vérifié).

## R-05 — Idempotence applicative (S21)

- **Décision** : protocole en deux transactions (voir [contracts/idempotency.md](contracts/idempotency.md)).
  1. *Réserver* (transaction courte, cloisonnée) : `INSERT … ON CONFLICT DO NOTHING` d'une ligne `IN_PROGRESS`
     avec `lease_until = now() + 60 s` ; si la ligne existe : `COMPLETED` + même empreinte → rejouer la réponse ;
     empreinte différente → `409 IDEMPOTENCY_KEY_REUSED` ; `IN_PROGRESS` non expirée → `409
     IDEMPOTENCY_KEY_IN_PROGRESS` ; `IN_PROGRESS` expirée → reprise (mise à jour conditionnelle du bail).
  2. *Exécuter et enregistrer* : le travail métier et le passage `COMPLETED` (statut HTTP, corps, en-têtes utiles)
     sont dans **la même** transaction `withTenantTx`. Une panne ne peut donc pas laisser une écriture validée sans
     réponse enregistrée ; une écriture au grand livre reste en plus protégée par `UNIQUE (ledger_id,
     idempotency_key)`.
- Erreurs métier (4xx) : enregistrées comme réponses définitives (rejouées à l'identique) ; erreurs 5xx : la ligne
  repasse disponible (non enregistrée), pour permettre la reprise.
- **Empreinte** : SHA-256 hex de `METHOD \n route-template \n JCS(body)` (RFC 8785, paquet `canonicalize`).
- **Portée** : `(operator_id, scope, key)` où `scope` = préfixe client (`app:`, `bo:`, `pos:<client_id>:`) ou
  `device:<serial>` ; la clé brute des terminaux reste `<serial>:<seq>`.
- **Expiration** : 24 h par défaut (paramètre `IDEMPOTENCY_TTL_HOURS`), bail de 60 s (= `transaction_timeout`).
  Purge des lignes expirées : hors mission (tâche planifiée future).

## R-06 — Moteur d'écritures

- **Décision** : trois couches. (1) `money/` : fonctions pures `bigint` — `roundHalfAwayFromZero(num, den)`,
  `fee(base, rule)`, `extractTax(ttc, rateBps)`, `split(total, bps)` ; (2) `builders/` : un constructeur pur par type
  `build(command, context) → Line[]` (sans accès base) ; (3) `LedgerEngineService` : vérifie la matrice des statuts
  ([contracts/status-type-matrix.md](contracts/status-type-matrix.md)), lit les soldes si nécessaire, appelle le
  constructeur, puis `post_transaction` en un appel. Les 5 types construits par la base appellent leur fonction SQL
  (`take_deposit`, `refund_deposit`, `forfeit_deposit`, `refund_cash_due`, `preload_media`) au lieu d'un
  constructeur de lignes.
- **Arrondi** : `q = n / d` tronque vers zéro en `bigint` ; on calcule sur valeurs absolues :
  `r = (2|n| + |d|) / (2|d|)`, puis signe — cas 5 et 6 en tests ; aucune conversion `Number` (règle ESLint
  `no-restricted-syntax` sur `Number(`/`parseFloat` dans `ledger/`, plus test).
- **Taxe extraite** : regroupement des frais TTC par `(compte bénéficiaire, taux)` dans la transaction, une ligne HT
  et une ligne de taxe par groupe, aucune ligne si taxe nulle (cas 2, 10, 18).
- **Configuration** : port `ConfigResolver.resolve(ledger, occurredAt)` → règles de frais, taxe, contrat, version ;
  implémentation unique dans cette mission : fixture de test. La cascade réelle arrive en mission 3.
- **Back-office** : `created_by` et `approved_by` sont des paramètres explicites des commandes `BACKOFFICE` ; le
  constructeur refuse `VALIDATION_FAILED` s'ils manquent ou sont égaux (la base le refuse aussi).

## R-07 — Contradiction : clés et dates des cautions du scénario (signalée, §0.3)

- **Constat** : `scenario_reference.json` écrit `DEPOSIT_TAKEN` avec la clé `deposit:W04:1` et une date fixe ;
  `take_deposit` (schéma) écrit `deposit:<uuid du bracelet>:<n>` avec `now()` et le mémo « Caution bracelet ». Même
  écart pour `deposit-refund:W05:1` et `deposit-forfeit:W04` (JSON, sans numéro) contre `…:<uuid>:<n>`.
- **Règle appliquée** : le schéma (niveau 2) et §5.4 (« les fonctions sont les constructeurs de leurs types ») priment
  sur l'illustration des clés du JSON ; les tests pgTAP (niveau 1) ne sont pas en jeu, car le rejeu pgTAP appelle
  `post_transaction` directement. Le rejeu de l'API **délègue** donc à `take_deposit`/`refund_deposit`/
  `forfeit_deposit` et compare, pour ces trois transactions, les **montants et comptes** (pas la clé, la date ni le
  mémo). Les soldes attendus restent exacts ; le second rejeu ne crée rien (les fonctions ne font rien si la caution
  est déjà `HELD`, ou n'est plus `HELD`).
- **Suite** : consigné ici et dans la PR ; proposition pour le propriétaire des sources : aligner les clés du JSON
  sur le format du schéma via `gen_golden.py` (aucun `.sql` généré modifié par cette mission).

## R-08 — Ordre du scénario et matrice des statuts

- **Projection** (à confirmer par un test précoce) : `DRAFT → LIVE` avant T1 ; T1-T23 en `LIVE` ; `CLOSING` puis
  T24 (`CASH_CLOSE`) ; `RECONCILING` puis T25-T29 (anomalie, dépôt, versements PSP) ; `SETTLING` puis T30-T40
  (droits de place, frais, redevance, versements) ; `REFUND_WINDOW` puis T41-T48 (remboursements, casse, cautions
  acquises, expiration des offerts, versements finaux) ; `CLOSED` (→ `LOCKED`). Chaque type tombe dans la colonne
  « Types acceptés » de son statut.
- **Risque** : une condition de passage (`CL019`) non remplie à l'un de ces points (par exemple droit net du
  prestataire non nul à l'entrée de `REFUND_WINDOW`). Si c'est le cas : contradiction à signaler (FR-024), pas
  d'aménagement silencieux du scénario.
- **Différence avec le rejeu pgTAP** : celui-ci écrit les 48 transactions puis enchaîne les statuts à la fin ; le
  rejeu de l'API intercale les passages, car le moteur applique la matrice (§12.1).

## R-09 — Paramètres décimaux du scénario

- `parameters` contient des décimaux JSON (`0.12`, `0.015`, `0.8`). Ils sont convertis en points de base à partir
  du **texte** du nombre (lecture du JSON brut par un analyseur qui garde les nombres en chaîne), jamais par
  multiplication flottante ; test sur chaque paramètre.

## R-10 — Outillage TypeScript et types du contrat

- Jest 29 + `@swc/jest` (standard NestJS, décorateurs pris en charge) ; `supertest` pour l'intégration.
- `openapi-typescript` 7 → `packages/contracts/generated/openapi.ts`, commité ; `npm run check -w
  @cashless/contracts` régénère dans un dossier temporaire et compare (CI). Les `int64` du contrat sont générés en
  `number` : l'API ne les utilise pas pour des montants internes (montants internes en `bigint` ; conversion aux
  frontières HTTP par un sérialiseur dédié, introduit avec la première route métier).
- Alternatives : Vitest (rejeté : configuration des décorateurs NestJS), `openapi-generator` (rejeté : JVM).

## R-11 — Passe adversariale (chaîne d'approvisionnement)

| # | Objection | Disposition |
|---|---|---|
| A1 | `@swc/core` télécharge un binaire natif ; avec `--ignore-scripts` il pourrait manquer | `changed` : binaires par paquets optionnels (pas de script) vérifiés en mise en place ; repli `ts-jest` documenté |
| A2 | Télécharger pgTAP depuis GitHub au setup = code non vérifié exécuté dans la base | `accepted` : version épinglée + SHA-256 contrôlé par le script ; base de test locale uniquement |
| A3 | CPAN pour `pg_prove` : dépendances transitives | `accepted` : module pur Perl, version épinglée, installé dans un `local::lib` du profil, jamais en CI (la CI utilise le paquet Ubuntu) |
| A4 | `canonicalize` : petit paquet peu maintenu | `deferred_with_rationale` : implémentation RFC 8785 de référence, sans dépendance ; à réévaluer si une alerte de sécurité paraît |
| A5 | Copier les binaires PostgreSQL dans le profil | `accepted` : copie locale des binaires déjà installés, aucune source externe |

## R-12 — Hors périmètre confirmé

- Surveillance `pg_stat_activity` des transactions > 60 s (§13.7) : tâche d'exploitation, mission ultérieure.
- Mesure du p95 « serveur seul » : missions qui publient `POST /payments` et les recharges.
- Types Dart : mission 4. Authentification réelle : mission 2. Purge des entrées S21 expirées : tâche future.
