# Quickstart — mission bracelets-nfc-01M4TD3W

Prérequis : Node 22, PostgreSQL 17 local (`tools/dev-db`), `pg_prove`, SDK Dart 3.8 (`dart --version`).

```bash
# 1. Bibliothèques de format : mêmes vecteurs dans les deux langages
python3 packages/tag-format/vecteurs_test_bracelet.py          # référence du kit
npm test -w @cashless/tag-format
(cd packages/tag-format/dart && dart pub get --enforce-lockfile && dart test)

# 2. Base : migrations 0010-0013, rôles des processus, suites pgTAP
npm run reset-db -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql

# 3. Contrat et types (TypeScript et Dart)
npm run check -w @cashless/contracts

# 4. API : unitaires, intégration, bout en bout
npm run reset-db -w @cashless/ledger-sql && SKIP_LATENCY=1 npm test
npm test -w @cashless/api -- media-latency

# 5. Les quatre processus démarrent, chacun avec son rôle de base
npm run start -w @cashless/api                 # API publique
npm run start:tag-keys -w @cashless/api        # POST /media/auth-keys
npm run start:personalization -w @cashless/api # /media/personalizations
npm run start:tag-check -w @cashless/api -- --once   # un passage du contrôle quotidien
```

Parcours de démonstration (test `media-journey.spec.ts`) : créer une clé (à deux), commander un lot `PUBLIC`, obtenir
le fichier de commande, personnaliser un bracelet avec le faux KMS, activer au guichet avec caution, lire, remplacer,
rendre la caution, restituer, clore le lot.

Preuves de sécurité à relancer avant toute revue : `production-guard.spec.ts` (aucun faux en production),
`architecture.spec.ts` (aucune capacité KMS dans l'API publique), `media-secrets.spec.ts` (aucun secret au repos ni
dans les journaux), `tests_media_roles.sql` (droits de chaque rôle de base).
