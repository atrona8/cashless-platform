#!/usr/bin/env bash
# Arrête l'API Cashless locale lancée par `demarrer-local.sh --fond` (et son tunnel ngrok). La base est gardée.
#
#   bash arreter-local.sh              API et tunnel ngrok
#   bash arreter-local.sh --api-seule  API seulement (le tunnel reste ouvert, la même URL resservira)
#   bash arreter-local.sh --base       API, tunnel, et conteneur de la base (données gardées ; `docker compose down -v`
#                                      les effacerait)
#
# Seuls les processus de ce dossier sont visés : PID enregistrés dans .logs/*.pid, ou processus qui écoute sur le
# port de l'API et dont la commande est celle de l'API. Jamais de `pkill` large.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${PORT:-80}"

arreter() {
  local pid="$1" motif="$2" nom="$3"
  [ -n "$pid" ] || return 0
  if ps -o command= -p "$pid" 2>/dev/null | grep -q -- "$motif"; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "$nom arrêté (PID $pid)."
  fi
}

# API : PID enregistré, sinon le processus qui écoute sur le port s'il s'agit bien de l'API.
API_PID="$(cat .logs/api.pid 2>/dev/null || true)"
if [ -z "$API_PID" ] || ! kill -0 "$API_PID" 2>/dev/null; then
  API_PID="$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"
fi
arreter "$API_PID" 'dist/main.js' 'API'
rm -f .logs/api.pid

if [ "${1:-}" != --api-seule ]; then
  arreter "$(cat .logs/ngrok.pid 2>/dev/null || true)" "ngrok http $PORT" 'Tunnel ngrok'
  rm -f .logs/ngrok.pid
fi
if [ "${1:-}" = --base ]; then
  docker compose stop db
fi
