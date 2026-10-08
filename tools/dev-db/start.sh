#!/usr/bin/env bash
# Démarre le cluster privé (sans effet s'il tourne déjà).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"

if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "[dev-db] cluster déjà démarré ($PGHOST:$PGPORT)"
else
  # stdout ET stderr redirigés : sinon, sous Windows, le serveur hérite du descripteur et un appelant qui lit la
  # sortie (pipe) attend indéfiniment.
  pg_ctl -D "$PGDATA" -l "$PG_HOME/server.log" -w start >/dev/null 2>&1 </dev/null
  echo "[dev-db] cluster démarré ($PGHOST:$PGPORT)"
fi
