# Quickstart — Configuration, parties et événements

## Base de test

Windows : cluster privé de `tools/dev-db/` (voir `.github/CI.md`). macOS ou Linux avec Docker (research R-12) :

```bash
R=$(pwd)
docker run -d --name cashless-platform-pg17 -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:5433:5432 -v "$R:$R" postgres:17
docker exec cashless-platform-pg17 bash -c \
  "apt-get update -qq && apt-get install -y -qq postgresql-17-pgtap libtap-parser-sourcehandler-pgtap-perl"
# pg_prove exécuté dans le conteneur : mettre en tête du PATH un script `pg_prove` qui fait
#   exec docker exec -w "$PWD" cashless-platform-pg17 pg_prove -U postgres "$@"
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=cashless_test
export CASHLESS_APP_PASSWORD=cashless_app_local CASHLESS_PLATFORM_PASSWORD=cashless_platform_local
export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/cashless_test
export DATABASE_URL_APP=postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test
export DATABASE_URL_PLATFORM=postgres://cashless_platform:cashless_platform_local@127.0.0.1:5433/cashless_test
```

## Vérification complète (ordre de la CI)

```bash
npm ci --ignore-scripts
npm run check -w @cashless/contracts && npm run lint && npm run typecheck
npm run reset-db -w @cashless/ledger-sql        # migrations 0001-0009, roles.sql, post-roles.sql (rôle plateforme)
npm run test:pgtap -w @cashless/ledger-sql      # + tests_configuration, tests_event_ledger, tests_platform_scope
npm run reset-db -w @cashless/ledger-sql && npm test
```

## Parcours de bout en bout (test `test/integration/end-to-end/configuration-journey.spec.ts`)

1. `PLATFORM_ADMIN` amorcé crée le profil `SN` (valeurs provisoires signalées), le prestataire, son contrat
   `PLATFORM_OPERATOR` et son premier `OPERATOR_ADMIN`.
2. L'`OPERATOR_ADMIN` crée un organisateur, son contrat `OPERATOR_ORGANIZER`, la règle de frais du prestataire, et
   nomme un `ORGANIZER_ADMIN`.
3. L'`ORGANIZER_ADMIN` crée un événement XOF (grand livre et comptes créés), deux commerçants, leurs participations
   (comptes `L-MCH-*`), leurs points de vente et leurs commissions.
4. Lecture des conditions de `LIVE` ; demande `LIVE` (`202`) ; approbation par un second `ORGANIZER_ADMIN` ;
   événement `LIVE`, grand livre `OPEN`, historique et audit.
5. Modification d'un réglage pendant `LIVE` (`202`, puis nouvelle version) ; configuration résolue à une date
   antérieure = ancienne valeur.
6. Rejeu du scénario de référence avec `SqlConfigResolver` sur une configuration construite par l'API : soldes
   identiques au rejeu par fixture.
