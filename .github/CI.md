# Intégration continue — `ledger-tests`

Workflow : [`.github/workflows/ledger-tests.yml`](workflows/ledger-tests.yml). Un seul job, `ledger`, sur
`ubuntu-24.04` avec un service `postgres:17`, déclenché à chaque `push` et `pull_request` (une exécution par branche :
la précédente est annulée), arrêté au bout de 20 minutes. Le job échoue à la première étape rouge.

> **État** : exécuté avec succès sur GitHub le 2026-10-08 (run
> [37771506938](https://github.com/atrona8/cashless-platform/actions/runs/37771506938), commit `ea20434`, toutes
> les étapes vertes). Les étapes avaient d'abord été répétées en local, dans l'ordre, sur le cluster privé (voir plus
> bas).

## Étapes

| # | Étape | Commande | Ce qu'elle garantit |
|---|---|---|---|
| 1 | Outils | `actions/checkout@v4`, `setup-node@v4` (Node 22, cache npm), `setup-python@v5` (3.11) | Versions du dépôt (`engines`) |
| 2 | pgTAP et `pg_prove` | `postgresql-17-pgtap` dans le conteneur ; `libtap-parser-sourcehandler-pgtap-perl` et `postgresql-client` sur le runner | Mêmes paquets que le kit d'origine |
| 3 | Dépendances | `npm ci --ignore-scripts` | Aucun script d'installation de dépendance exécuté (R-11) ; les binaires natifs (`@swc/core`, `esbuild`) viennent de paquets optionnels |
| 4 | Suites générées | `npm run check:generated -w @cashless/ledger-sql` | Les suites pgTAP commitées sont exactement celles que produisent `gen_tests.py` et `gen_golden.py` (FR-005) |
| 5 | Calculs de référence | `python packages/ledger-sql/moteur_ecritures_reference.py` | Les 19 cas normatifs de l'implémentation de référence |
| 6 | Types du contrat | `npm run check -w @cashless/contracts` | Les types générés depuis `openapi.yaml` sont à jour (FR-022) |
| 7 | Lint et types | `npm run lint` ; `npm run typecheck` | ESLint (dont l'interdiction des décimaux dans le moteur) ; `tsc` strict sur les trois workspaces |
| 8 | Base par les migrations | `createdb cashless_test` ; `npm run migrate -w @cashless/ledger-sql` | La base de test est construite **par les migrations** (`0001` à `0009`), jamais par le fichier de schéma brut ; `roles.sql` puis `post-roles.sql` rejoués |
| 9 | Suites pgTAP | `npm run test:pgtap -w @cashless/ledger-sql` | Référence (400), scénario (64), suites du dépôt (`tests/*.sql` : S21, identité, audit, approbations, administrateurs de la plateforme, configuration, grand livre d'événement, portée plateforme) |
| 10 | Tests Jest | `npm run reset-db -w @cashless/ledger-sql` ; `npm test` | Base recréée, puis unitaires, intégration (garanties transverses, moteur) et rejeu du scénario de référence |

Variables du job : `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (outils PostgreSQL et
`tools/dev-db/env.sh`, qui garde les valeurs déjà posées), `CASHLESS_APP_PASSWORD` (mot de passe donné à
`cashless_app` par les migrations), `DATABASE_URL_OWNER` (migrations, fixtures de test) et `DATABASE_URL_APP` (API).
Depuis le 2026-10-15 : `TRUST_PROXY_HOPS` (OP-N53), nombre de répartiteurs de confiance devant les processus HTTP,
entier de 0 à 5. `0` en CI (aucun répartiteur : `X-Forwarded-For` ignoré) ; **obligatoire en production**, sans
défaut : un processus démarré avec `NODE_ENV=production` sans cette variable refuse de démarrer. En production, la
valeur est le nombre exact de répartiteurs qui ajoutent une adresse à `X-Forwarded-For` devant l'API (ex. `1` pour un
seul répartiteur de charge) : trop haute, un client choisit son adresse ; trop basse, tous les clients ont l'adresse
du répartiteur et partagent la limite de 60 consultations anonymes par heure.

## Reproduire en local

Prérequis et cluster privé PostgreSQL 17 + pgTAP : [`tools/dev-db/README.md`](../tools/dev-db/README.md) ;
parcours complet : `kitty-specs/fondations-grand-livre-01M4AY8M/quickstart.md`.

```bash
bash tools/dev-db/start.sh
# Même bloc env que le job, valeurs du cluster local (127.0.0.1:5433, authentification trust).
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_test CASHLESS_APP_PASSWORD=cashless_app_local
export DATABASE_URL_OWNER=postgres://postgres@127.0.0.1:5433/cashless_test
export DATABASE_URL_APP=postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test
npm ci --ignore-scripts
npm run check:generated -w @cashless/ledger-sql
python packages/ledger-sql/moteur_ecritures_reference.py
npm run check -w @cashless/contracts
npm run lint && npm run typecheck
(source tools/dev-db/env.sh && dropdb --if-exists cashless_test && createdb cashless_test)
npm run migrate -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql
npm run reset-db -w @cashless/ledger-sql && npm test
```

Les suites pgTAP exigent une base fraîchement migrée : les tests Jest laissent des données (fixtures validées),
d'où l'ordre du job (pgTAP, puis base recréée, puis Jest). Relancer `npm run reset-db -w @cashless/ledger-sql` avant
`test:pgtap` si Jest a déjà tourné sur la base.

Sous Windows (Git Bash), ne pas `source tools/dev-db/env.sh` dans le shell qui lance ensuite `npm run test:pgtap` :
la variable `PERL5LIB` traverse `cmd.exe`, revient sous la forme `C:/…`, et Perl la coupe sur `:` (`pg_prove` ne
trouve plus ses modules). Chaque script npm source `env.sh` lui-même.

## Répétition locale du 2026-10-14 (mission bracelets-nfc, WP20)

macOS (Intel), PostgreSQL 17 en Docker (colima, `127.0.0.1:5433`) avec pgTAP, `pg_prove` 3.37 (CPAN), Node 24.17,
SDK Dart 3.8.3, branche de la lane WP20 (`kitty/mission-bracelets-nfc-01M4TD3W-lane-t`, toutes les lanes de la mission
fusionnées). Toutes les étapes vertes.

| Étape | Résultat |
|---|---|
| Lint, types | 0 erreur |
| Types du contrat (TypeScript et Dart) | à jour ; `dart analyze` : aucun constat |
| Bibliothèque de format (TypeScript) | 38 tests verts, 1 écarté (vecteurs du kit : module Python `cryptography` absent du poste ; exigé en CI) |
| Bibliothèque de format (Dart) | `dart pub get --enforce-lockfile` (verrou `pubspec.lock` ajouté, absent depuis WP02), `dart analyze --fatal-infos` sans constat, 30 tests verts |
| Base, migrations | `0001` à `0016` appliquées, `roles.sql` et `post-roles.sql` rejoués |
| Suites pgTAP | 18 fichiers, **1267 assertions**, PASS |
| Base recréée, Jest (`SKIP_LATENCY=1`) | 71 suites, **1223 tests** verts |
| Latence des routes de configuration (seule) | créations p95 47 ms (seuil 500), lectures p95 18 ms (seuil 200) |
| Latence des bracelets, NFR-006 (seule, 100 000 bracelets) | mot de passe p95 15 ms, p99 18 ms ; lecture p95 23 ms, p99 26 ms (seuils 200 / 500) ; activation p95 49 ms (seuil 500) |
| Codes imprimés sans énumération, NFR-007 (seule) | 200 + 200 essais, même statut, corps et en-têtes ; médianes 20,4 et 20,6 ms, écart 0,2 ms (seuil 20 ms ; 0,1 à 0,2 ms selon les passages, voir ADR-90) |

## Répétition locale du 2026-10-12 (mission configuration-parties-evenements, WP13)

Poste macOS, PostgreSQL 17.11 dans Docker (conteneur `cashless-platform-pg17`, `127.0.0.1:5433`, pgTAP installé dans
le conteneur), Node 24, branche de la lane WP13 (toutes les lanes de la mission 3 fusionnées). Étapes 4 à 10 vertes,
**53 s** au total (hors `npm ci`).

| Étape | Durée | Résultat |
|---|---|---|
| 4. Suites générées | < 1 s | à jour |
| 5. Calculs de référence | < 1 s | 19 cas OK |
| 6. Types du contrat | 2 s | à jour (48 opérations ajoutées par la mission) |
| 7. Lint, types | 4 s + 6 s | 0 erreur |
| 8. Base, migrations | 2 s | `0001` à `0009` appliquées, `roles.sql` et `post-roles.sql` rejoués (rôle `cashless_platform`) |
| 9. Suites pgTAP | 5 s | 10 fichiers, **947 assertions**, PASS |
| 10. Base recréée, Jest | 1 s + 32 s | 47 suites, **873 tests** verts |

Variables ajoutées par la mission (job et poste local) : `CASHLESS_PLATFORM_PASSWORD`, `DATABASE_URL_PLATFORM`.

**Latence (NFR-003)**, mesurée par `configuration-latency.spec.ts` sur une base de 100 événements et 1 000
participations, requête HTTP complète vue du client de test (donc au-dessus du temps serveur seul).

| Mesure | Nombre | Suite lancée seule (p95) | Pendant toute la suite Jest en parallèle (p95) | Seuil (p95) |
|---|---|---|---|---|
| Création d'un événement (grand livre et comptes) | 30 | 74 à 88 ms | 154 à 189 ms | 500 ms |
| Lectures de configuration | 200 | 30 à 31 ms | 68 à 83 ms | 200 ms |
| Écritures de configuration | 50 | 67 à 68 ms | première série 209 à 253 ms, série refaite 66 à 69 ms | 200 ms |

Lancée seule, la suite tient les trois seuils avec une marge d'un facteur trois ou plus (trois exécutions). Pendant
la suite Jest complète, les sept autres processus de test chargent la même machine et la même base : la première
série d'écritures dépasse alors le seuil (cinq exécutions sur cinq), et la série refaite juste après le tient. Le
test refait donc une série au-dessus du seuil, trois fois au plus, échoue si aucune ne tient le seuil et consigne
toutes les séries (`series_p95_ms` de la ligne `LATENCE`). Une mesure de latence fiable demande une machine au
repos : ce relevé vaut pour la suite lancée seule.

**Mode Docker sur macOS.** Le serveur PostgreSQL tourne dans une VM : son horloge est en avance de 0 à 120 ms environ
sur celle du poste et recule parfois de quelques dizaines de millisecondes (mesuré : 3 reculs en 40 s, jusqu'à
113 ms). Conséquences prises en compte : un test ne compare jamais l'horloge de Node à une date posée par la base ;
sans date demandée, une date d'effet ne précède jamais celle de la version qu'elle suit (ADR-82). La CI (Linux,
base et tests sur le même noyau) n'a pas ce décalage. Dans un worktree sans `node_modules`, `@cashless/contracts` se
résout vers le checkout principal : créer `node_modules/@cashless/{api,contracts,ledger-sql}` en liens vers les
paquets du worktree avant `typecheck` et `npm test`.

**Suites en parallèle sur une base partagée.** Le niveau de configuration `PLATFORM` et les profils de législation
d'un pays sont communs à toutes les suites : une suite n'y suppose pas être seule (numéros de version de profil
aléatoires, pays réservé par suite, réglages de cascade posés à un niveau propre à la suite, nouvel essai sur `409`).
La suite complète a été lancée treize fois de suite sans échec avant ce relevé.

## Répétition locale du 2026-10-09 (mission identite-roles, WP10)

Mêmes poste et cluster, branche de la lane WP10 (toutes les lanes de la mission 2 fusionnées). Étapes 3 à 10 vertes,
**192 s** au total.

| Étape | Durée | Résultat |
|---|---|---|
| 3. `npm ci --ignore-scripts` | 29 s | à jour (ajout : `jose` 6.2.12) |
| 4. Suites générées | 9 s | à jour |
| 5. Calculs de référence | < 1 s | 19 cas OK |
| 6. Types du contrat | 13 s | à jour |
| 7. Lint, types | 20 s + 29 s | 0 erreur |
| 8. Base, migrations | 1 s + 11 s | `0001` à `0006` appliquées, `roles.sql` et `post-roles.sql` rejoués |
| 9. Suites pgTAP | 11 s | 7 fichiers, **676 assertions**, PASS |
| 10. Base recréée, Jest | 69 s | 29 suites, **670 tests** verts |

## Répétition locale du 2026-10-08

Windows 10, cluster privé PostgreSQL 17.4 + pgTAP 1.3.4, Node 22.14, branche de la lane WP14 (toutes les lanes de la
mission fusionnées). Toutes les étapes 3 à 10 vertes, **152 s** au total (cible NFR-007 : < 15 min).

| Étape | Durée | Résultat |
|---|---|---|
| 3. `npm ci --ignore-scripts` | 23 s | 551 paquets |
| 4. Suites générées | 8 s | à jour |
| 5. Calculs de référence | < 1 s | 19 cas OK |
| 6. Types du contrat | 12 s | à jour |
| 7. Lint, types | 13 s + 26 s | 0 erreur |
| 8. Base, migrations | 1 s + 10 s | `0001_schema_reference`, `0002_api_idempotency` appliquées |
| 9. Suites pgTAP | 9 s | 3 fichiers, **505 assertions** (400 + 64 + 41 S21), PASS |
| 10. Base recréée, Jest | 18 s + 32 s | 15 suites, **505 tests** verts (dont le rejeu du scénario : 48 transactions, deux points de contrôle, second rejeu nul) |
