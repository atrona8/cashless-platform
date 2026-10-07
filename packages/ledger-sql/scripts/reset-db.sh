#!/usr/bin/env bash
# Recrée la base de test et y applique les migrations puis roles.sql.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ -f "$ROOT/tools/dev-db/env.sh" ]; then
  # shellcheck source=/dev/null
  source "$ROOT/tools/dev-db/env.sh"
fi
DB="${PGDATABASE:-cashless_test}"
dropdb --if-exists "$DB"
createdb "$DB"
cd "$ROOT"
npm run --silent migrate -w @cashless/ledger-sql
