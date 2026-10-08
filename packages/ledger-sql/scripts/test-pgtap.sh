#!/usr/bin/env bash
# Exécute les suites pgTAP de référence (400 + 64 assertions) puis celles du dépôt (tests/*.sql).
# Chaque suite ouvre sa propre transaction et finit par ROLLBACK : la base reste sans données métier.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ -f "$ROOT/tools/dev-db/env.sh" ]; then
  # shellcheck source=/dev/null
  source "$ROOT/tools/dev-db/env.sh"
fi
cd "$ROOT/packages/ledger-sql"
suites=(tests_grand_livre_cashless.sql scenario_reference_test.sql)
shopt -s nullglob
suites+=(tests/*.sql)
pg_prove -d "${PGDATABASE:-cashless_test}" "${suites[@]}"
