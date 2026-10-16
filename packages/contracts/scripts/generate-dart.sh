#!/usr/bin/env bash
# Génère les types Dart de l'API depuis openapi.yaml (mission bracelets-nfc, research R-10).
# Outil : swagger_parser (épinglé dans dart/pubspec.lock), puis json_serializable pour la (dé)sérialisation.
# L'outil écrit aussi des clients HTTP (retrofit, dio) : ils sont supprimés, ce paquet ne porte que des types.
# Usage : bash scripts/generate-dart.sh            → régénère dart/lib
#         bash scripts/generate-dart.sh --check    → échoue si dart/lib n'est pas à jour (CI)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../dart"
if ! command -v dart >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then echo "[contracts] SDK Dart absent : obligatoire en CI" >&2; exit 1; fi
  echo "[contracts] SDK Dart absent : types Dart non vérifiés (obligatoire en CI)"; exit 0
fi

# Modèles que l'outil ne sait pas produire correctement (bogue du générateur sur une réponse `oneOf` dont une
# branche est un `$ref`) : écartés, listés ici pour que la limite reste visible. Aucun n'appartient aux bracelets.
EXCLUDED=(post_ledgers_ledger_id_debit_authority_response_sealed)

generate() {
  local out="$1"
  rm -rf "$out/src/generated"
  dart pub get --enforce-lockfile >/dev/null
  dart run swagger_parser >/dev/null
  rm -rf lib/src/generated/clients lib/src/generated/export.dart
  for name in "${EXCLUDED[@]}"; do rm -f "lib/src/generated/models/$name.dart"; done
  dart run build_runner build --delete-conflicting-outputs >/dev/null
  # Fichier d'export : un `export` par modèle, trié (sortie stable).
  {
    echo "// GÉNÉRÉ par scripts/generate-dart.sh depuis openapi.yaml — ne pas modifier à la main."
    echo "library;"
    echo
    (cd lib/src/generated/models && ls *.dart | grep -v '\.g\.dart$' | LC_ALL=C sort | sed "s|^|export 'src/generated/models/|; s|$|';|")
  } > lib/cashless_contracts.dart
  dart format lib >/dev/null
}

if [ "${1:-}" = "--check" ]; then
  before=$(find lib -type f -name '*.dart' -print0 | LC_ALL=C sort -z | xargs -0 shasum | shasum)
  generate lib
  after=$(find lib -type f -name '*.dart' -print0 | LC_ALL=C sort -z | xargs -0 shasum | shasum)
  if [ "$before" != "$after" ]; then
    echo "[contracts] types Dart périmés — lancer npm run generate:dart -w @cashless/contracts" >&2; exit 1
  fi
  dart analyze lib >/dev/null || { echo "[contracts] types Dart : erreurs d'analyse" >&2; exit 1; }
  echo "[contracts] types Dart à jour"
else
  generate lib
  dart analyze lib
  echo "[contracts] types Dart générés : $(ls lib/src/generated/models/*.dart | grep -vc '\.g\.dart$') modèles"
fi
