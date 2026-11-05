#!/bin/bash
# Fusionne dans une lane existante les lanes dont elle dépend (lanes.json), résout les seuls conflits sous
# kitty-specs/, s'arrête sur tout conflit de code, puis réaligne kitty-specs/ sur feat (align-lane.sh).
# Usage : merge-deps.sh <lettre de la lane> [lettres supplémentaires...]
set -e
R=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
M=passerelle-locale-01M6NM1S
L=$1; shift
cd "$R/.worktrees/$M-lane-$L" || { echo "lane-$L absente : lancer d'abord action implement"; exit 1; }
deps=$(python3 -c "import json,sys;d=json.load(open('$R/kitty-specs/$M/lanes.json'))
print(' '.join(x.replace('lane-','') for l in d['lanes'] if l['lane_id']=='lane-$L' for x in l['depends_on_lanes']))")
for l in $deps "$@"; do
  b=kitty/mission-$M-lane-$l
  git merge-base --is-ancestor "$b" HEAD && continue
  echo "== fusion de lane-$l"
  git merge --no-edit -q "$b" >/dev/null 2>&1 || true
  U=$(git diff --name-only --diff-filter=U)
  if [ -n "$U" ]; then
    if echo "$U" | grep -qv '^kitty-specs/'; then echo "CONFLIT DE CODE :"; echo "$U" | grep -v '^kitty-specs/'; exit 1; fi
    echo "$U" | while read f; do git add "$f"; done
    git commit -q --no-edit 2>/dev/null
  fi
done
bash "$R/docs/passation-8/scripts/align-lane.sh" "$L" 2>&1 | grep -v 'spec-kitty guard'
if git grep -q '^<<<<<<< ' -- . ':!*.md'; then echo "MARQUEURS DE CONFLIT RESTANTS"; exit 1; fi
