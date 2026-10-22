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

# Mode d'exécution (RISK-3) : obligatoire, `production`, `development` ou `test` ; tout processus
# refuse de démarrer sans lui. `development` sur le poste local (les faux et les secrets de test y
# sont permis) ; Jest garde une valeur déjà posée, sinon il pose `test`.
export NODE_ENV="${NODE_ENV:-development}"

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

# Mission identite-enrolement-terminaux : VALEURS DE TEST seulement (publiques), identiques aux défauts hors
# production de apps/api/src/config/config.ts ; refusées en production même posées (secrets de test). En production,
# chaque réglage ci-dessous est obligatoire et vient du déploiement.
# Secrets HMAC (research R-13), 32 octets au moins, distincts de CLAIM_CODE_HMAC_KEY et entre eux.
export IDEMPOTENCY_HMAC_KEY="${IDEMPOTENCY_HMAC_KEY:-$(printf '%s' 'cashless-idempotency-hmac-key-de-test-uniquement-00' | od -An -tx1 | tr -d ' \n')}"
export ENROLLMENT_CODE_HMAC_KEY="${ENROLLMENT_CODE_HMAC_KEY:-$(printf '%s' 'cashless-enrollment-code-hmac-key-de-test-uniquement' | od -An -tx1 | tr -d ' \n')}"
# Jetons d'appareil (R-07) et certificat client (R-09).
export DEVICE_TOKEN_ISSUER="${DEVICE_TOKEN_ISSUER:-https://api.cashless.test}"
export DEVICE_TOKEN_TTL_SECONDS="${DEVICE_TOKEN_TTL_SECONDS:-900}"
export DEVICE_REFRESH_TOKEN_TTL_DAYS="${DEVICE_REFRESH_TOKEN_TTL_DAYS:-30}"
export DEVICE_CERT_VALIDITY_DAYS="${DEVICE_CERT_VALIDITY_DAYS:-365}"
export CLOCK_TOLERANCE_SECONDS="${CLOCK_TOLERANCE_SECONDS:-120}"
# Attestation (R-05, R-06) : application de test ; App Attest en développement (refusé en production).
export IOS_APP_ATTEST_ENVIRONMENT="${IOS_APP_ATTEST_ENVIRONMENT:-development}"
# Racines d'attestation (R-05, R-06 ; lot WP14) : fichiers PEM, obligatoires en production,
# absents ici.
# - ANDROID_ATTESTATION_ROOTS : TOUTES les racines que Google publie pour l'attestation de clé
#   (developer.android.com/privacy-and-security/security-key-attestation, « Root certificates » ;
#   liste JSON : https://android.googleapis.com/attestation/root), soit l'ancienne racine RSA
#   4096 bits et la ou les nouvelles racines de la rotation annoncée par Google, tant que des
#   appareils sont attestés par l'une ou l'autre. Au déploiement, chaque empreinte SHA-256 est
#   comparée à la publication de Google (jamais recopiée d'un autre dépôt) ; à revoir à chaque
#   annonce de rotation. Liste de révocation : https://android.googleapis.com/attestation/status.
# - IOS_APP_ATTEST_ROOT : « Apple App Attestation Root CA » (www.apple.com/certificateauthority).
# Sans ANDROID_ATTESTATION_ROOTS (hors production seulement) : faux vérificateur, refusé en
# production ; une racine de test (sujet marqué cashless-test-attestation-root) y est refusée aussi.
# TLS (R-03) : aucun certificat sur le poste local, l'API écoute en clair. Les tests HTTPS génèrent leurs certificats
# à l'exécution (apps/api/test/support/tls.ts) ; aucune clé n'est écrite dans le dépôt. Pour servir en HTTPS à la
# main : TLS_CERT_FILE, TLS_KEY_FILE et DEVICE_CA_CERT_FILE ensemble.
