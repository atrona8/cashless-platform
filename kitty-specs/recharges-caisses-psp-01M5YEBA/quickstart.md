# Quickstart: Recharges, caisses et PSP

Environnement local : base Docker `127.0.0.1:5433` (`cashless_test`), voir `docs/passation-5b/REPRISE.md`
(« Environnement de test »).

```bash
# Base et pgTAP
npm run reset-db -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql          # dont tests_cash_sessions.sql, tests_psp.sql, tests_cash_psp_rights.sql

# Contrat et types
npm run check -w @cashless/contracts

# API (passe parallèle puis mesures seules, comme la CI)
npm run reset-db -w @cashless/ledger-sql && (cd apps/api && SKIP_LATENCY=1 npx jest)
(cd apps/api && npx jest --runInBand end-to-end/topup-latency end-to-end/webhook-latency)

# Interrogation planifiée des recharges (une passe)
node apps/api/dist/main.psp-poller.js --once      # --list : recharges en attente
```

Parcours de démonstration (tests `apps/api/test/integration/end-to-end/topup-journey.spec.ts`) :

1. `OPERATOR_ADMIN` crée une configuration Wave (faux) pour l'organisateur ; un second l'active.
2. `ORGANIZER_ADMIN` la choisit pour l'événement.
3. Un `CASHIER` ouvre une session sur un terminal `TOPUP_DESK`, recharge 5 000 XOF en espèces.
4. Le même terminal demande une recharge Wave de 10 000 ; le faux PSP envoie la notification signée ; `TOPUP` écrit.
5. L'agent compte 4 900 ; un `SUPERVISOR` ferme : `CASH_CLOSE` et `CASH_DIFF` de 100.
6. Dépôt en banque de 4 900 approuvé à deux.
