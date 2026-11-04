#!/usr/bin/env bash
# Démarre l'API Cashless en local (développement, avec les faux). Jamais en production.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose up -d --wait db

export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE="${PGDATABASE:-cashless_dev}"
export NODE_ENV=development
# shellcheck source=/dev/null
source tools/dev-db/env.sh

[ -d node_modules ] || npm ci

# Base neuve, migrations et rôles (le client PostgreSQL du conteneur évite d'en installer un sur le poste).
docker compose exec -T db dropdb -U postgres --if-exists "$PGDATABASE"
docker compose exec -T db createdb -U postgres "$PGDATABASE"
npm run --silent migrate -w @cashless/ledger-sql

npm run build -w @cashless/api
cd apps/api
exec npm start
