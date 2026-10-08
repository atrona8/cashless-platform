# Intégration continue — `ledger-tests`

Workflow : [`.github/workflows/ledger-tests.yml`](workflows/ledger-tests.yml). Un seul job, `ledger`, sur
`ubuntu-24.04` avec un service `postgres:17`, déclenché à chaque `push` et `pull_request` (une exécution par branche :
la précédente est annulée), arrêté au bout de 20 minutes. Le job échoue à la première étape rouge.

> **État** : pas encore exécuté sur GitHub. Il a été écrit le 2026-10-08, sans dépôt distant à ce moment-là
> (contrainte C-010, depuis caduque : le dépôt `github.com/atrona8/cashless-platform` existe). Toutes les étapes ont
> été répétées en local, dans l'ordre, sur le cluster privé (voir plus bas).

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
| 8 | Base par les migrations | `createdb cashless_test` ; `npm run migrate -w @cashless/ledger-sql` | La base de test est construite **par les migrations** (`0001`, `0002`), jamais par le fichier de schéma brut ; `roles.sql` rejoué |
| 9 | Suites pgTAP | `npm run test:pgtap -w @cashless/ledger-sql` | Référence (400), scénario (64), S21 (`tests/*.sql`) |
| 10 | Tests Jest | `npm run reset-db -w @cashless/ledger-sql` ; `npm test` | Base recréée, puis unitaires, intégration (garanties transverses, moteur) et rejeu du scénario de référence |

Variables du job : `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (outils PostgreSQL et
`tools/dev-db/env.sh`, qui garde les valeurs déjà posées), `CASHLESS_APP_PASSWORD` (mot de passe donné à
`cashless_app` par les migrations), `DATABASE_URL_OWNER` (migrations, fixtures de test) et `DATABASE_URL_APP` (API).

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

Sous Windows (Git Bash), ne pas `source tools/dev-db/env.sh` dans le shell qui lance ensuite `npm run test:pgtap` :
la variable `PERL5LIB` traverse `cmd.exe`, revient sous la forme `C:/…`, et Perl la coupe sur `:` (`pg_prove` ne
trouve plus ses modules). Chaque script npm source `env.sh` lui-même.

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
