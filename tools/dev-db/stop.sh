#!/usr/bin/env bash
# Arrête le cluster privé.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"

if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
  echo "[dev-db] cluster arrêté"
else
  echo "[dev-db] cluster déjà arrêté"
fi
