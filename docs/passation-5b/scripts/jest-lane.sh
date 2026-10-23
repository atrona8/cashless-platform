#!/bin/bash
# usage: jest-lane.sh <lane-dir> <log>
S=<SCRATCHPAD>
. $S/env.sh
cd "$1" || exit 1
mkdir -p node_modules/@cashless
for p in api:apps/api contracts:packages/contracts ledger-sql:packages/ledger-sql; do
  ln -sfn ../../${p#*:} node_modules/@cashless/${p%%:*}
done
bash packages/ledger-sql/scripts/reset-db.sh > "$2" 2>&1 || exit 1
cd apps/api && SKIP_LATENCY=1 npx jest >> "$2" 2>&1
echo "EXIT $?" >> "$2"
