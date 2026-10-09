# Journal d’implémentation — fondations-grand-livre-01M4AY8M

Une ligne par démarrage ou fin de work package (horodatage UTC).

- 2026-10-07T13:49:15Z — démarrage WP03 (migrations et suites pgTAP) ; WP01 et WP02 approuvés.
- 2026-10-07T13:50:03Z — démarrage WP03 (nouvelle tentative).
- 2026-10-07T13:54:15Z — démarrage WP03 (lanes a et b fusionnées dans lane-c).
- 2026-10-07T13:55:47Z — pause demandée par le porteur ; WP03 pris en charge (lane-c), non commencé.
- 2026-10-07T16:15:29Z — WP03 implémenté, revu et approuvé (464/464). Démarrage WP04 (table d'idempotence S21).
- 2026-10-07T16:17:13Z — démarrage WP04 (nouvelle tentative après réenregistrement de l'analyse).
- 2026-10-07T16:19:34Z — démarrage WP04 (table d'idempotence S21).
- 2026-10-07T16:22:43Z — démarrage WP04 (lane-d créée, lanes c fusionnée).
- 2026-10-07T16:31:16Z — démarrage WP05 (lane-e).
- 2026-10-07T16:32:34Z — démarrage WP05 (lane-e).
- 2026-10-07T16:36:00Z — démarrage WP05 (lane-e).
- 2026-10-07T16:37:07Z — démarrage WP05 (lane-e).
- 2026-10-07T16:38:59Z — démarrage WP05 (lane-e).
- 2026-10-07T16:49:15Z — démarrage WP06 (lane-f).
- 2026-10-07T16:51:36Z — démarrage WP06 (lane-f).
- 2026-10-07T17:00:58Z — démarrage WP07 (lane-g).
- 2026-10-07T17:03:35Z — démarrage WP07 (lane-g).
- 2026-10-07T17:12:22Z — WP04, WP05, WP06, WP07 approuvés ; pause demandée par le porteur après WP07.
- 2026-10-08T09:26:06Z — démarrage WP08 (lane-h).
- 2026-10-08T09:28:09Z — démarrage WP08 (lane-h).
- 2026-10-08T09:42:30Z — démarrage WP09 (lane-i).
- 2026-10-08T09:43:59Z — démarrage WP09 (lane-i).
- 2026-10-08T09:50:06Z — démarrage WP10 (lane-j).
- 2026-10-08T09:51:52Z — démarrage WP10 (lane-j).
- 2026-10-08T09:58:14Z — démarrage WP11 (lane-k).
- 2026-10-08T10:00:03Z — démarrage WP11 (lane-k).
- 2026-10-08T10:14:54Z — démarrage WP12 (lane-l).
- 2026-10-08T10:17:05Z — démarrage WP12 (lane-l).
- 2026-10-08T10:27:13Z — démarrage WP13 (lane-m).
- 2026-10-08T10:28:45Z — démarrage WP13 (lane-m).
- 2026-10-08T10:37:34Z — démarrage WP14 (lane-n).
- 2026-10-08T10:40:16Z — démarrage WP14 (lane-n).

### WP14 — répétition locale de la CI (T073) et contrôle final des critères 1 à 3 (T075), 2026-10-08

Lane WP14 (toutes les lanes fusionnées), cluster privé PostgreSQL 17.4 + pgTAP 1.3.4, Node 22.14, Windows 10.
Étapes 3 à 10 de `.github/workflows/ledger-tests.yml` exécutées dans l'ordre : toutes vertes, 152 s au total.
YAML analysé avec le paquet `yaml` : 12 étapes, `timeout-minutes: 20` ; chaque script npm appelé existe.

- Critère 1 (suites pgTAP) : 3 fichiers, 505 assertions (400 référence + 64 scénario + 41 S21), PASS, base créée par
  les migrations `0001` et `0002`.
- Critère 2 (calculs) : 19 cas de `moteur_ecritures_reference.py` OK ; 21 tests Jest des cas normatifs verts.
- Critère 3 (scénario) : 48 transactions identiques ligne à ligne au JSON, soldes exacts après T23 et T48, `CLOSED`,
  `LOCKED`, invariant nul, aucun écart de cache ; second rejeu : 0 transaction, 0 ligne.
- Jest : 15 suites, 505 tests verts (unitaires, intégration transverse et moteur, scénario).
