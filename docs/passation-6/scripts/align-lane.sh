#!/bin/bash
# Réaligne kitty-specs/ d'une lane sur feat (sauf artefacts du runtime) et affiche ce qui reste.
set -e
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
cd "$R/.worktrees/recharges-caisses-psp-01M5YEBA-lane-$1" || exit 1
RT='status\.(json|events\.jsonl)$|baseline-tests\.json$|acceptance-matrix\.json$'
git diff --name-only feat/recharges-caisses-psp -- kitty-specs/ | grep -vE "$RT" | while read f; do
  if git cat-file -e "feat/recharges-caisses-psp:$f" 2>/dev/null; then git checkout feat/recharges-caisses-psp -- "$f"
  else git rm -q "$f"; fi
done
git diff --cached --quiet || git commit -q -m "chore: align planning artifacts with feat/recharges-caisses-psp" 2>/dev/null
echo "Restent (lane-$1) :"; git diff --name-only feat/recharges-caisses-psp -- kitty-specs/
