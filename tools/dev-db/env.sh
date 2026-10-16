# Variables de la base de développement locale (cluster PostgreSQL 17 privé).
# À sourcer depuis Git Bash : `source tools/dev-db/env.sh`. Toutes les valeurs sont surchargeables.

# Installation PostgreSQL 17 existante, dont on copie les binaires (jamais modifiée).
: "${PG_SRC:=/c/Program Files/PostgreSQL/17}"

# Copie privée, hors dépôt, sans droits administrateur.
if [ -z "${PG_HOME:-}" ]; then
  if [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null 2>&1; then
    PG_HOME="$(cygpath -u "$LOCALAPPDATA")/cashless-pg17"
  else
    PG_HOME="$HOME/.cashless-pg17"
  fi
fi

export PG_SRC PG_HOME
export PGDATA="$PG_HOME/data"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE="${PGDATABASE:-cashless_test}"

# Binaires de la copie privée en tête du PATH ; pg_prove et ses modules Perl installés localement.
export PATH="$PG_HOME/bin:$PG_HOME/perl5/bin:$PATH"
export PERL5LIB="$PG_HOME/perl5/lib/perl5${PERL5LIB:+:$PERL5LIB}"

# Répartiteurs de confiance devant l'API (OP-N53) : aucun sur le poste local. Obligatoire en production.
export TRUST_PROXY_HOPS="${TRUST_PROXY_HOPS:-0}"

# Chaînes de connexion utilisées par les migrations (propriétaire) et l'API (rôle applicatif, rôle de la plateforme).
export CASHLESS_APP_PASSWORD="${CASHLESS_APP_PASSWORD:-cashless_app_local}"
export CASHLESS_PLATFORM_PASSWORD="${CASHLESS_PLATFORM_PASSWORD:-cashless_platform_local}"
export CASHLESS_TAGKEYS_PASSWORD="${CASHLESS_TAGKEYS_PASSWORD:-cashless_tagkeys_local}"
export CASHLESS_PERSO_PASSWORD="${CASHLESS_PERSO_PASSWORD:-cashless_perso_local}"
export CASHLESS_TAGCHECK_PASSWORD="${CASHLESS_TAGCHECK_PASSWORD:-cashless_tagcheck_local}"
export CASHLESS_KEYADMIN_PASSWORD="${CASHLESS_KEYADMIN_PASSWORD:-cashless_keyadmin_local}"
export DATABASE_URL_OWNER="${DATABASE_URL_OWNER:-postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE}"
export DATABASE_URL_APP="${DATABASE_URL_APP:-postgres://cashless_app:$CASHLESS_APP_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
export DATABASE_URL_PLATFORM="${DATABASE_URL_PLATFORM:-postgres://cashless_platform:$CASHLESS_PLATFORM_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
# Processus des clés de bracelet : un rôle de base par processus (mission bracelets-nfc).
export DATABASE_URL_TAGKEYS="${DATABASE_URL_TAGKEYS:-postgres://cashless_tagkeys:$CASHLESS_TAGKEYS_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
export DATABASE_URL_PERSO="${DATABASE_URL_PERSO:-postgres://cashless_perso:$CASHLESS_PERSO_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
export DATABASE_URL_TAGCHECK="${DATABASE_URL_TAGCHECK:-postgres://cashless_tagcheck:$CASHLESS_TAGCHECK_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
export DATABASE_URL_KEYADMIN="${DATABASE_URL_KEYADMIN:-postgres://cashless_keyadmin:$CASHLESS_KEYADMIN_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE}"
