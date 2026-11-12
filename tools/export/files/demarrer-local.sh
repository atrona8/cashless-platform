#!/usr/bin/env bash
# Démarre l'API Cashless en local (développement, avec les faux). Jamais en production.
#
#   bash demarrer-local.sh               au premier plan (Ctrl+C arrête l'API et le tunnel)
#   bash demarrer-local.sh --fond        détaché du terminal : survit à sa fermeture ; arrêt par arreter-local.sh
#   bash demarrer-local.sh --redemarrer  arrête l'instance en marche (API seule, tunnel gardé) puis relance en fond
#
# Une instance déjà en marche est détectée : le script ne lance ni une seconde API (port déjà pris) ni un second
# tunnel ngrok (refusé par ngrok, ERR_NGROK_334). Journaux : .logs/api.log, .logs/ngrok.log.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ICI="$(pwd)"

MODE=premier-plan
case "${1:-}" in
  --fond) MODE=fond ;;
  --redemarrer) MODE=redemarrer ;;
  '') ;;
  *)
    echo "Option inconnue : $1 (--fond, --redemarrer)" >&2
    exit 2
    ;;
esac

export PORT="${PORT:-80}"
mkdir -p .logs

api_repond() { curl -fsS --max-time 3 "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; }
url_tunnel() {
  curl -fsS --max-time 3 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | grep -o '"public_url":"https[^"]*"' | head -n1 | cut -d'"' -f4 || true
}
# Lance une commande détachée de la session et du terminal (nouveau groupe de processus), PID écrit dans un fichier.
detacher() {
  local pidfile="$1" logfile="$2"
  shift 2
  nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "exec: $!"' "$@" >>"$logfile" 2>&1 &
  echo $! >"$pidfile"
}

if api_repond; then
  if [ "$MODE" != redemarrer ]; then
    echo "Une API répond déjà sur le port $PORT : rien n'est relancé."
    U="$(url_tunnel)"
    [ -n "$U" ] && echo "API publique : $U"
    echo "Pour la relancer avec le code à jour : bash demarrer-local.sh --redemarrer"
    exit 0
  fi
  echo "Arrêt de l'API en marche (le tunnel ngrok est gardé)…"
  bash "$ICI/arreter-local.sh" --api-seule
fi
[ "$MODE" = redemarrer ] && MODE=fond

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
# Derrière ngrok, un seul répartiteur : l'adresse réelle du client est lue dans X-Forwarded-For (limites par adresse
# de la consultation anonyme et des codes à usage unique). Développement seulement.
export TRUST_PROXY_HOPS="${TRUST_PROXY_HOPS:-1}"
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

# L'API écoute sur le port $PORT et ngrok l'expose sur Internet (valeurs de test et faux : URL à ne pas diffuser).
if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok est introuvable : installez-le (https://ngrok.com/download) et posez votre jeton (ngrok config add-authtoken …)." >&2
  exit 1
fi
URL_PUBLIQUE="$(url_tunnel)"
NGROK_PID=""
if [ -n "$URL_PUBLIQUE" ]; then
  echo "Tunnel ngrok déjà ouvert, réutilisé : $URL_PUBLIQUE"
else
  if [ "$MODE" = fond ]; then
    detacher .logs/ngrok.pid .logs/ngrok.log ngrok http "$PORT" --log=stdout
  else
    ngrok http "$PORT" --log=stdout >>.logs/ngrok.log 2>&1 &
    NGROK_PID=$!
    trap 'kill "$NGROK_PID" 2>/dev/null || true' EXIT INT TERM
  fi
  for _ in $(seq 1 15); do
    URL_PUBLIQUE="$(url_tunnel)"
    [ -n "$URL_PUBLIQUE" ] && break
    sleep 1
  done
fi
if [ -n "$URL_PUBLIQUE" ]; then
  echo "API publique : $URL_PUBLIQUE (locale : http://localhost:$PORT, tableau ngrok : http://127.0.0.1:4040)"
else
  echo "ngrok n'a pas ouvert de tunnel (voir .logs/ngrok.log) ; l'API reste joignable sur http://localhost:$PORT." >&2
fi

if [ "$MODE" = fond ]; then
  (cd apps/api && detacher "$ICI/.logs/api.pid" "$ICI/.logs/api.log" node --require tsx/cjs dist/main.js)
  for _ in $(seq 1 60); do api_repond && break; sleep 1; done
  if api_repond; then
    echo "API démarrée en fond (PID $(cat .logs/api.pid)) ; journal : .logs/api.log ; arrêt : bash arreter-local.sh"
  else
    echo "L'API ne répond pas après 60 s : voir .logs/api.log" >&2
    exit 1
  fi
else
  cd apps/api
  npm start
fi
