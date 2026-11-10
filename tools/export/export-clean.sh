#!/usr/bin/env bash
# Version propre du projet, exposée avec l'API (décision du porteur du 04/11/2026, suivi de la mission 7).
# Produit deux archives datées, à partir d'un commit (jamais de l'arbre de travail : rien de non suivi ne part) :
#   1. kit client  : contrat, types générés, format de bracelet Dart et vecteurs, docs de synthèse, guide d'accès ;
#                    aucun code serveur ;
#   2. API         : code de l'API et des paquets, schéma SQL, lancement local avec Docker et les faux ;
#                    sans kitty-specs/, docs/passation-*, notes de session, documents de travail internes.
# Chaque archive est contrôlée (fichiers interdits, motifs de secrets) ; un constat arrête le script.
#
# Usage : bash tools/export/export-clean.sh [REF]      (REF par défaut : HEAD)
# Sortie : exports/cashless-kit-client-<date>-<sha>.tar.gz et exports/cashless-api-<date>-<sha>.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/tools/export"
REF="${1:-HEAD}"
cd "$ROOT"

SHA="$(git rev-parse --short=8 "$REF^{commit}")"
DATE="$(date +%Y-%m-%d)"
OUT="$ROOT/exports"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# Extrait des chemins suivis du commit REF dans un dossier (git archive : seulement ce qui est versionné).
extract() {
  local dest="$1"
  shift
  mkdir -p "$dest"
  git archive --format=tar "$REF" -- "$@" | tar -x -C "$dest"
}

# ---------------------------------------------------------------------------------------------------------------
# 1. Kit client
# ---------------------------------------------------------------------------------------------------------------
KIT="$WORK/cashless-kit-client"
extract "$KIT" \
  packages/contracts/openapi.yaml \
  packages/contracts/generated \
  packages/contracts/dart \
  packages/tag-format/dart \
  packages/tag-format/vectors \
  tools/nfc-bench \
  PRD.md \
  docs/01-product-overview.md \
  docs/02-use-case-diagram.md \
  docs/03-context-diagram.md \
  docs/05-sequence-diagrams.md \
  docs/07-api-reference.md \
  docs/08-pile-logicielle.md \
  docs/SPECIFICATION.md \
  docs/sync_protocol.md
# Contrats complémentaires des missions serveur (liste fermée, voir docs/Delegation-applications-clientes.docx §6).
mkdir -p "$KIT/contrats-complementaires/terminaux" "$KIT/contrats-complementaires/hors-ligne"
for f in enrollment device-authentication device-tokens device-lifecycle; do
  git show "$REF:kitty-specs/identite-enrolement-terminaux-01M52R6H/contracts/$f.md" \
    >"$KIT/contrats-complementaires/terminaux/$f.md"
done
for f in snapshots batches compliance openapi-additions; do
  git show "$REF:kitty-specs/hors-ligne-snapshots-lots-01M645RN/contracts/$f.md" \
    >"$KIT/contrats-complementaires/hors-ligne/$f.md"
done
sed -e "s/@SHA@/$SHA/g" -e "s/@DATE@/$DATE/g" "$HERE/files/LISEZMOI-kit-client.md" >"$KIT/LISEZMOI.md"
cp "$HERE/files/ACCES-API.md" "$KIT/ACCES-API.md"
cp "$HERE/files/DONNEES-DEMO.md" "$KIT/DONNEES-DEMO.md"
cp "$HERE/files/IDENTIFIANTS-DEMO.txt" "$KIT/IDENTIFIANTS-DEMO.txt"
cp "$HERE/files/exemple-app-festivalier.mjs" "$KIT/exemple-app-festivalier.mjs"

# ---------------------------------------------------------------------------------------------------------------
# 2. API exécutable nettoyée
# ---------------------------------------------------------------------------------------------------------------
API="$WORK/cashless-api"
extract "$API" \
  apps/api \
  packages \
  tools/dev-db \
  tools/demo-data \
  package.json \
  package-lock.json \
  tsconfig.base.json \
  eslint.config.mjs \
  jest.preset.cjs \
  .prettierrc.json \
  .prettierignore \
  .editorconfig \
  .gitattributes \
  .npmrc \
  docs/07-api-reference.md \
  docs/08-pile-logicielle.md \
  docs/sync_protocol.md
sed -e "s/@SHA@/$SHA/g" -e "s/@DATE@/$DATE/g" "$HERE/files/LISEZMOI-api.md" >"$API/LISEZMOI.md"
cp "$HERE/files/docker-compose.yml" "$API/docker-compose.yml"
cp "$HERE/files/demarrer-local.sh" "$API/demarrer-local.sh"
cp "$HERE/files/arreter-local.sh" "$API/arreter-local.sh"
cp "$HERE/files/ACCES-API.md" "$API/ACCES-API.md"
cp "$HERE/files/DONNEES-DEMO.md" "$API/DONNEES-DEMO.md"

# ---------------------------------------------------------------------------------------------------------------
# Contrôles : un constat arrête tout, aucune archive n'est écrite.
# ---------------------------------------------------------------------------------------------------------------
fail=0
check_tree() {
  local dir="$1" name="$2"
  # Fichiers et dossiers internes ou sensibles.
  local bad
  bad="$(cd "$dir" && find . \( -name 'kitty-specs' -o -name 'passation-*' -o -name '.kittify' -o -name '.claude' \
    -o -name '.docmeta' -o -name 'CLAUDE.md' -o -name 'PROMPTS-A-ENVOYER.md' -o -name 'POINTS_OUVERTS.md' \
    -o -name 'DECISIONS_ADR.md' -o -name 'REVUE_COHERENCE*' -o -name '*.docx' -o -name '*.xlsx' \
    -o -name '.env' -o -name '.env.*' ! -name '*.example' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \
    -o -name '*.pfx' -o -name 'node_modules' -o -name '.dart_tool' -o -name 'memory' \) -print)"
  if [ -n "$bad" ]; then
    echo "[$name] fichiers interdits :" >&2
    echo "$bad" >&2
    fail=1
  fi
  # Motifs de secrets (clés privées, jetons de fournisseurs connus).
  local hits
  # Seule exception : les canaris des tests (valeur contenant CANARY), faux secrets posés pour prouver qu'ils ne
  # fuient pas.
  hits="$(grep -rInE -- '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{10,}|ghp_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}' "$dir" | grep -vE '(sk_live_|AKIA|ghp_|xox[baprs]-|AIza)[A-Za-z0-9_-]*CANARY' || true)"
  if [ -n "$hits" ]; then
    echo "[$name] motifs de secrets à vérifier :" >&2
    echo "$hits" >&2
    fail=1
  fi
}
check_tree "$KIT" "kit client"
check_tree "$API" "api"
# Le kit client ne contient aucun code serveur.
if [ -d "$KIT/apps" ] || [ -d "$KIT/packages/ledger-sql" ]; then
  echo "[kit client] code serveur présent" >&2
  fail=1
fi
[ "$fail" -eq 0 ] || { echo "Export refusé." >&2; exit 1; }

KIT_TGZ="$OUT/cashless-kit-client-$DATE-$SHA.tar.gz"
API_TGZ="$OUT/cashless-api-$DATE-$SHA.tar.gz"
tar -czf "$KIT_TGZ" -C "$WORK" cashless-kit-client
tar -czf "$API_TGZ" -C "$WORK" cashless-api
(cd "$OUT" && shasum -a 256 "$(basename "$KIT_TGZ")" "$(basename "$API_TGZ")" >"SHA256SUMS-$DATE-$SHA.txt")
echo "Kit client : $KIT_TGZ"
echo "API        : $API_TGZ"
echo "Sommes     : $OUT/SHA256SUMS-$DATE-$SHA.txt"
