#!/bin/bash
# Réaligne kitty-specs/ d'une lane sur feat (sauf artefacts du runtime) et affiche ce qui reste.
set -e
R=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$R/.worktrees/remboursement-partiel-especes-01M84932-lane-$1" || exit 1
RT='status\.(json|events\.jsonl)$|baseline-tests\.json$|acceptance-matrix\.json$'
git diff --name-only feat/remboursement-partiel-especes -- kitty-specs/ | grep -vE "$RT" | while read f; do
  if git cat-file -e "feat/remboursement-partiel-especes:$f" 2>/dev/null; then git checkout feat/remboursement-partiel-especes -- "$f"
  else git rm -q "$f"; fi
done
git diff --cached --quiet || git commit -q -m "chore: align planning artifacts with feat/remboursement-partiel-especes" 2>/dev/null
echo "Restent (lane-$1) :"; git diff --name-only feat/remboursement-partiel-especes -- kitty-specs/
