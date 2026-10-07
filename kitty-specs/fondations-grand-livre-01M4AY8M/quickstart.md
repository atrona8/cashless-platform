# Quickstart — Fondations du grand livre et de l'API

Poste : Windows 10, Git Bash, Node 22, PostgreSQL 17 installé (service sur 5432, non utilisé), Python 3.11.
Aucun Docker, aucun droit administrateur.

```bash
# 1. Dépendances (aucun script d'installation exécuté)
npm ci --ignore-scripts

# 2. Cluster PostgreSQL 17 privé avec pgTAP (une fois ; ~300 Mo dans %LOCALAPPDATA%\cashless-pg17)
bash tools/dev-db/setup.sh
bash tools/dev-db/start.sh            # écoute sur 127.0.0.1:5433

# 3. Base de test créée par les migrations (+ roles.sql)
bash tools/dev-db/reset-db.sh         # = createdb cashless_test && npm run migrate -w @cashless/ledger-sql

# 4. Suites de la base (400 + 64 + S21)
npm run test:pgtap -w @cashless/ledger-sql

# 5. Calculs de référence (Python) et tests TypeScript
python packages/ledger-sql/moteur_ecritures_reference.py
npm test                              # unitaires + intégration + rejeu du scénario

# 6. Contrôles de génération
npm run check -w @cashless/contracts  # types à jour avec openapi.yaml
(cd packages/ledger-sql && python gen_tests.py && python gen_golden.py && git diff --exit-code *.sql)

# Arrêt
bash tools/dev-db/stop.sh
```

Variables (fichier `.env.test`, non commité ; valeurs par défaut du script) :
`PGHOST=127.0.0.1`, `PGPORT=5433`, `PGDATABASE=cashless_test`, `DATABASE_URL_APP` (rôle `cashless_app`),
`DATABASE_URL_OWNER` (migrations et fixture).

Résultat attendu : toutes les suites vertes ; le rejeu affiche 0 écart après T23 et en fin de clôture, puis 0
transaction créée au second rejeu.
