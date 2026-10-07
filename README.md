# Kit de départ pour l'agent de développement — système cashless multi-tenant

Lire dans cet ordre :

1. `docs/SPECIFICATION.md` : ce qu'il faut implémenter (normatif).
2. `docs/POINTS_OUVERTS.md` : ce qui n'est pas décidé ; valeurs par défaut à coder. Aucun point ne bloque plus le code. Les questions de la revue n° 2 sont toutes tranchées (ADR-72 à ADR-77).
3. `docs/DECISIONS_ADR.md` : pourquoi (à consulter avant de remettre une règle en cause).
4. `docs/sync_protocol.md` et `packages/contracts/openapi.yaml` : protocole hors ligne et contrat d'API (normatifs).
5. `docs/REVUE_COHERENCE_2.md` : revue de cohérence n° 2 du 2 octobre 2026 (partie A appliquée au schéma, aux tests et aux documents ; questions Q1 à Q6 toutes tranchées). `docs/REVUE_COHERENCE.md` (n° 1, 30 septembre 2026) est archivée.

Vérifier l'environnement :

```bash
cd packages/ledger-sql
python3 moteur_ecritures_reference.py                      # 19 cas OK
createdb cashless && psql -d cashless -v ON_ERROR_STOP=1 -f schema_grand_livre_cashless.sql -f roles.sql
pg_prove -d cashless tests_grand_livre_cashless.sql scenario_reference_test.sql   # 464 assertions (400 + 64)
python3 ../tag-format/vecteurs_test_bracelet.py            # vecteurs du bracelet
```

Le scénario de référence (64 assertions) rejoue l'événement complet jusqu'à la clôture (`CLOSED`) et au verrouillage du grand livre (`LOCKED`).

Règle : en cas de contradiction, les tests font foi (SPECIFICATION §0.3). On modifie les générateurs (`gen_tests.py`, `gen_golden.py`) ou `scenario_reference.json`, jamais les fichiers `.sql` générés.
