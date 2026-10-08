#!/usr/bin/env bash
# Vérifie que les suites pgTAP commitées sont exactement celles que produisent les générateurs (FR-005).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
GENERATED=(tests_grand_livre_cashless.sql scenario_reference_test.sql)
# python3 d'abord (Linux/CI) ; sous Windows, « python3 » peut être le raccourci du Microsoft Store : on le teste.
PYTHON=""
for candidate in python3 python; do
  if "$candidate" -c "import sys" >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
done
[ -n "$PYTHON" ] || { echo "[check-generated] Python introuvable" >&2; exit 1; }
# UTF-8 imposé : sous Windows, l'encodage par défaut de Python n'est pas UTF-8.
export PYTHONUTF8=1
"$PYTHON" gen_tests.py
"$PYTHON" gen_golden.py
# git diff compare après normalisation des fins de ligne (.gitattributes : eol=lf) : pas de faux écart sous Windows.
git diff --exit-code -- "${GENERATED[@]}"
# Sans écart, on restaure les octets du dépôt (le générateur écrit en CRLF sous Windows).
git checkout -- "${GENERATED[@]}"
echo "[check-generated] suites pgTAP à jour"
