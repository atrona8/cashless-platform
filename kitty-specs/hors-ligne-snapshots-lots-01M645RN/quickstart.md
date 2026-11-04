# Quickstart: Hors ligne : snapshots et lots

Environnement local : base Docker `127.0.0.1:5433` (`cashless_test`), voir `docs/passation-6/REPRISE.md`
(« Environnement de test ») ; `pg_prove` à refaire à chaque session.

```bash
# Base et pgTAP
npm run reset-db -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql   # dont tests_offline_*.sql, tests_execute_grants.sql, tests_device_rights.sql

# Contrat et types
npm run check -w @cashless/contracts

# API (passe parallèle puis mesures seules, comme la CI)
npm run reset-db -w @cashless/ledger-sql && (cd apps/api && SKIP_LATENCY=1 npx jest)
(cd apps/api && npx jest --runInBand end-to-end/offline-latency end-to-end/snapshot-latency end-to-end/offline-concurrency)

# Processus (corrigé le 04/11/2026, WP21 : construire d'abord, lancer depuis apps/api avec tsx ;
# DATABASE_URL_SNAPCONTENT, DATABASE_URL_SNAPSIGN et DATABASE_URL_MAINT viennent de tools/dev-db/env.sh,
# sinon le processus retombe sur cashless_test)
npm run build -w @cashless/api && source tools/dev-db/env.sh
(cd apps/api && npm run start:snapshot-content -- --once)  # une passe de préparation ; --list : grands livres dus
(cd apps/api && npm run start:snapshot-signer -- --once)   # signe et publie les brouillons prêts
(cd apps/api && npm run start:maintenance -- --once)       # purges (rôle cashless_maint)
```

Parcours de démonstration (`apps/api/test/integration/end-to-end/offline-journey.spec.ts`) :

1. `OPERATOR_ADMIN` fixe le plafond (300 000 par terminal) ; `ORGANIZER_ADMIN` règle l'événement au-dessus :
   politique effective réduite, `capped`, risque maximal affiché.
2. Le terminal lit sa configuration (`config_id`, `snapshot_keys`), puis son snapshot `FULL` ; il vérifie la signature
   avec la clé publique du jeu d'essai et ouvre un mot de passe.
3. Un bracelet est bloqué : un `DELTA` signé paraît en 5 s au plus.
4. Le terminal, coupé, fait trois ventes (dont une de 9 000 sur un solde de 6 000) et une annulation ; il envoie le lot :
   `ACCEPTED`, `ACCEPTED_WITH_SHORTFALL` + `OFFLINE_SHORTFALL`, annulation qui réduit l'anomalie.
5. Un lot suivant commence après un trou : `SEQ_GAP` ; deux `SUPERVISOR` lèvent le trou.
6. Le terminal est révoqué ; son journal exporté est importé à deux.
