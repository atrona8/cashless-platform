#!/usr/bin/env bash
# Démarre l'API Cashless en local (développement, avec les faux). Jamais en production.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# Docker doit répondre avant tout : on démarre colima ou Docker Desktop s'ils sont arrêtés.
docker_pret() { docker info >/dev/null 2>&1; }
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker est introuvable : installez Docker Desktop, colima ou Podman (voir LISEZMOI.md)." >&2
  exit 1
fi
if ! docker_pret; then
  if command -v colima >/dev/null 2>&1; then
    echo "Docker ne répond pas : démarrage de colima…"
    colima start # reprend la configuration de colima (mémoire, processeurs) déjà enregistrée
  elif [ "$(uname)" = Darwin ] && [ -d /Applications/Docker.app ]; then
    echo "Docker ne répond pas : démarrage de Docker Desktop…"
    open -a Docker
  fi
  for _ in $(seq 1 60); do docker_pret && break; sleep 2; done
  if ! docker_pret; then
    echo "Docker ne répond toujours pas : démarrez-le (colima start, Docker Desktop…) puis relancez ce script." >&2
    exit 1
  fi
fi

docker compose up -d --wait db

export PGHOST=127.0.0.1 PGPORT=5434 PGUSER=postgres PGDATABASE="${PGDATABASE:-cashless_dev}"
export NODE_ENV=development
# shellcheck source=/dev/null
source tools/dev-db/env.sh

[ -d node_modules ] || npm ci

# Base PERSISTANTE : gardée d'un démarrage à l'autre (les équipes clientes y retrouvent leurs données).
# `REINIT_DB=1 bash demarrer-local.sh` repart d'une base neuve. Le client PostgreSQL du conteneur évite d'en
# installer un sur le poste.
if [ "${REINIT_DB:-0}" = 1 ]; then
  echo "REINIT_DB=1 : base $PGDATABASE effacée puis recréée."
  docker compose exec -T db dropdb -U postgres --if-exists "$PGDATABASE"
fi
if ! docker compose exec -T db psql -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1; then
  docker compose exec -T db createdb -U postgres "$PGDATABASE"
fi
# Migrations non encore appliquées seulement (exécuteur idempotent), puis rejeu des droits.
npm run --silent migrate -w @cashless/ledger-sql

# Données de démonstration (DONNEES-DEMO.md) : écrites une seule fois, jamais réécrites ensuite.
# `DEMO_DATA=0` pour ne pas les écrire.
if [ "${DEMO_DATA:-1}" = 1 ]; then
  npx tsx --tsconfig apps/api/tsconfig.json tools/demo-data/seed-demo.ts
fi

npm run build -w @cashless/api

# L'API écoute sur le port 80 et ngrok l'expose sur Internet (valeurs de test et faux : URL à ne pas diffuser).
export PORT="${PORT:-80}"
if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok est introuvable : installez-le (https://ngrok.com/download) et posez votre jeton (ngrok config add-authtoken …)." >&2
  exit 1
fi
mkdir -p .logs
ngrok http "$PORT" --log=stdout >.logs/ngrok.log 2>&1 &
NGROK_PID=$!
trap 'kill "$NGROK_PID" 2>/dev/null || true' EXIT INT TERM

URL_PUBLIQUE=""
for _ in $(seq 1 15); do
  URL_PUBLIQUE="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | grep -o '"public_url":"https[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
  [ -n "$URL_PUBLIQUE" ] && break
  kill -0 "$NGROK_PID" 2>/dev/null || break
  sleep 1
done
if [ -n "$URL_PUBLIQUE" ]; then
  echo "API publique : $URL_PUBLIQUE (locale : http://localhost:$PORT, tableau ngrok : http://127.0.0.1:4040)"
else
  echo "ngrok n'a pas ouvert de tunnel (voir .logs/ngrok.log) ; l'API reste joignable sur http://localhost:$PORT." >&2
fi

cd apps/api
npm start
