#!/bin/bash
# Usage : explain.sh <fichier de sortie> ; EXPLAIN (ANALYZE, BUFFERS) de chaque requête de queries.txt sous cashless_app.
out=$1; : > "$out"
while IFS=$'\t' read -r n q; do
  echo "== $n" >> "$out"
  psql -Xq -d cashless_wp02 >> "$out" 2>&1 <<SQL
SET ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000000f001', false) \gset
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) $q;
SQL
done < "$(dirname "$0")/queries.txt"
