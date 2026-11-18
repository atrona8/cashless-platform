#!/bin/bash
# Réaligne kitty-specs/ d'une lane sur feat (sauf artefacts du runtime) et affiche ce qui reste.
set -e
R=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$R/.worktrees/durcissements-serveur-01M7QAJD-lane-$1" || exit 1
RT='status\.(json|events\.jsonl)$|baseline-tests\.json$|acceptance-matrix\.json$'
git diff --name-only feat/durcissements-serveur -- kitty-specs/ | grep -vE "$RT" | while read f; do
  if git cat-file -e "feat/durcissements-serveur:$f" 2>/dev/null; then git checkout feat/durcissements-serveur -- "$f"
  else git rm -q "$f"; fi
done
git diff --cached --quiet || git commit -q -m "chore: align planning artifacts with feat/durcissements-serveur" 2>/dev/null
echo "Restent (lane-$1) :"; git diff --name-only feat/durcissements-serveur -- kitty-specs/
