#!/usr/bin/env bash
# Installe la base de développement locale : cluster PostgreSQL 17 privé (127.0.0.1:5433) avec l'extension
# pgTAP et pg_prove, sans droits administrateur ni Docker (research R-01 de la mission
# fondations-grand-livre). Idempotent : relancer ne refait que ce qui manque.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"

# Versions épinglées et sommes SHA-256 vérifiées (aucun téléchargement accepté sans contrôle).
PGTAP_VERSION="1.3.4"
PGTAP_URL="https://github.com/theory/pgtap/releases/download/v${PGTAP_VERSION}/pgTAP-${PGTAP_VERSION}.zip"
PGTAP_SHA256="5de16455e3e29898813f05cc9f396a31f878309a94d8adb34e80f423a5841736"
TEST_HARNESS_URL="https://cpan.metacpan.org/authors/id/L/LE/LEONT/Test-Harness-3.52.tar.gz"
TEST_HARNESS_SHA256="8fe65cfc0261ed3c8a4395f0524286f5719669fe305f9b03b16cf3684d62cd70"
PGTAP_PERL_URL="https://cpan.metacpan.org/authors/id/D/DW/DWHEELER/TAP-Parser-SourceHandler-pgTAP-3.37.tar.gz"
PGTAP_PERL_SHA256="6e928581442a1e687131f7b5d6f4ff44b7f8dcdf798d2d076bdcd07d8b7a597d"

# Sous Windows, `python3` peut n'être qu'un raccourci vers le Microsoft Store : on garde le premier qui s'exécute.
PYTHON=""
for candidate in python python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "pass" >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
done
DL="$PG_HOME/downloads"
SRC="$PG_HOME/src"

[ -n "$PYTHON" ] || { echo "[dev-db] ERREUR : Python introuvable" >&2; exit 1; }
log() { printf '[dev-db] %s\n' "$*" >&2; }
fail() { printf '[dev-db] ERREUR : %s\n' "$*" >&2; exit 1; }

# Télécharge une archive et vérifie sa somme ; ne garde jamais un fichier dont la somme diffère.
fetch() {
  local url="$1" sha="$2" out="$DL/$(basename "$1")"
  mkdir -p "$DL"
  if [ ! -f "$out" ]; then
    log "téléchargement de $(basename "$out")"
    curl -fsSL -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
  local got
  got="$(sha256sum "$out" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    rm -f "$out"
    fail "somme SHA-256 inattendue pour $(basename "$out") : $got (attendu $sha)"
  fi
  printf '%s' "$out"
}

# --- T006 : copie relocalisable de PostgreSQL 17 -----------------------------------------------------------
[ -x "$PG_SRC/bin/postgres.exe" ] || [ -x "$PG_SRC/bin/postgres" ] || fail "PostgreSQL introuvable dans $PG_SRC (variable PG_SRC)"
src_version="$("$PG_SRC/bin/pg_config" --version)"
copy_version="$( [ -x "$PG_HOME/bin/pg_config" ] && "$PG_HOME/bin/pg_config" --version || true )"
if [ "$src_version" != "$copy_version" ]; then
  log "copie de $src_version vers $PG_HOME (bin, lib, share)"
  mkdir -p "$PG_HOME"
  rm -rf "$PG_HOME/bin" "$PG_HOME/lib" "$PG_HOME/share"
  cp -r "$PG_SRC/bin" "$PG_SRC/lib" "$PG_SRC/share" "$PG_HOME/"
else
  log "copie PostgreSQL déjà à jour ($copy_version)"
fi

sharedir="$("$PG_HOME/bin/pg_config" --sharedir)"
# PostgreSQL peut renvoyer le nom court Windows (8.3, ex. CASHLE~1) : on compare sur le nom long.
sharedir_unix="$( command -v cygpath >/dev/null 2>&1 && cygpath -u "$(cygpath -m -l "$sharedir")" || printf '%s' "$sharedir" )"
case "$sharedir_unix" in
  "$PG_HOME"/*) log "relocalisation vérifiée : sharedir = $sharedir" ;;
  *) fail "les binaires copiés pointent encore vers $sharedir ; voir tools/dev-db/README.md (repli : copie admin unique)" ;;
esac
EXT_DIR="$sharedir_unix/extension"

# --- T007 : extension pgTAP construite sans make -----------------------------------------------------------
if [ ! -f "$EXT_DIR/pgtap--$PGTAP_VERSION.sql" ]; then
  zip="$(fetch "$PGTAP_URL" "$PGTAP_SHA256")"
  rm -rf "$SRC/pgTAP-$PGTAP_VERSION"
  mkdir -p "$SRC"
  "$PYTHON" -I -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$zip" "$SRC"
  osname="$(cd "$SRC/pgTAP-$PGTAP_VERSION" && sh tools/getos.sh)"
  "$PYTHON" -I "$HERE/build_pgtap.py" "$SRC/pgTAP-$PGTAP_VERSION" "$EXT_DIR" "$osname"
else
  log "pgTAP $PGTAP_VERSION déjà installé"
fi

# --- T008 : pg_prove (modules Perl purs, installés dans $PG_HOME/perl5) ------------------------------------
PERL_LIB="$PG_HOME/perl5/lib/perl5"
if ! perl -MTAP::Parser::SourceHandler::pgTAP -e 1 >/dev/null 2>&1 || [ ! -f "$PG_HOME/perl5/bin/pg_prove" ]; then
  mkdir -p "$PERL_LIB" "$PG_HOME/perl5/bin"
  for spec in "$TEST_HARNESS_URL $TEST_HARNESS_SHA256" "$PGTAP_PERL_URL $PGTAP_PERL_SHA256"; do
    set -- $spec
    archive="$(fetch "$1" "$2")"
    dir="$SRC/$(basename "$archive" .tar.gz)"
    rm -rf "$dir"
    tar -xzf "$archive" -C "$SRC"
    cp -r "$dir/lib/." "$PERL_LIB/"
  done
  pgtap_perl_dir="$SRC/$(basename "$PGTAP_PERL_URL" .tar.gz)"
  # Le script publié commence par `#!perl` : on fixe l'interpréteur de Git Bash.
  { printf '#!/usr/bin/env perl\n'; tail -n +2 "$pgtap_perl_dir/bin/pg_prove"; } > "$PG_HOME/perl5/bin/pg_prove"
  chmod +x "$PG_HOME/perl5/bin/pg_prove"
fi
log "$(pg_prove --version 2>&1 | head -1)"

# --- T009 : cluster privé sur 127.0.0.1:5433 ---------------------------------------------------------------
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  log "initialisation du cluster dans $PGDATA"
  initdb -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
  {
    printf "\n# --- cashless dev-db ---\n"
    printf "port = %s\n" "$PGPORT"
    printf "listen_addresses = '127.0.0.1'\n"
  } >> "$PGDATA/postgresql.conf"
  # Accès sans mot de passe uniquement depuis la machine elle-même.
  printf 'local all all trust\nhost all all 127.0.0.1/32 trust\n' > "$PGDATA/pg_hba.conf"
fi

bash "$HERE/start.sh"

# Contrôle final : l'extension se crée réellement.
PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS pgtap_probe" -c "CREATE DATABASE pgtap_probe" >/dev/null
probe="$(psql -qtA -d pgtap_probe -v ON_ERROR_STOP=1 -c "CREATE EXTENSION pgtap" -c "SELECT pgtap_version()")"
psql -q -d postgres -c "DROP DATABASE pgtap_probe" >/dev/null
log "pgTAP opérationnel (version $probe) sur $PGHOST:$PGPORT"
