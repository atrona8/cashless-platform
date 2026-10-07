#!/usr/bin/env bash
# Compile la logique pure (core/) + les tests JUnit 4 avec kotlinc, puis les exécute sur la JVM.
# Aucune dépendance Android ni Gradle. Prérequis : JDK ≥ 17, kotlinc 2.x, junit-4.13.2 + hamcrest-core-1.3.
#
#   KOTLINC_HOME=/chemin/kotlinc JUNIT_JAR=... HAMCREST_JAR=... ./run_jvm_tests.sh
#
# (Dans un projet Android Gradle, les mêmes tests tournent via ./gradlew testDebugUnitTest avec
#  testImplementation "junit:junit:4.13.2".)
set -euo pipefail
cd "$(dirname "$0")"
KOTLINC_HOME="${KOTLINC_HOME:-$(dirname "$(dirname "$(command -v kotlinc)")")}"
JUNIT_JAR="${JUNIT_JAR:-/opt/gradle-8.14.3/lib/junit-4.13.2.jar}"
HAMCREST_JAR="${HAMCREST_JAR:-/opt/gradle-8.14.3/lib/hamcrest-core-1.3.jar}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

"$KOTLINC_HOME/bin/kotlinc" -cp "$JUNIT_JAR" \
  app/src/main/kotlin/sn/cashless/nfcbench/core app/src/test/kotlin -d "$OUT"

java -Dfile.encoding=UTF-8 -cp "$OUT:$KOTLINC_HOME/lib/kotlin-stdlib.jar:$JUNIT_JAR:$HAMCREST_JAR" \
  org.junit.runner.JUnitCore \
  sn.cashless.nfcbench.core.Ev1ProtocolTest \
  sn.cashless.nfcbench.core.TapBenchmarkTest
