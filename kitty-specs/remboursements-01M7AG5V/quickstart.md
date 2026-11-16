# Quickstart : vérifier les remboursements en local

Prérequis : base Docker `127.0.0.1:5433` (colima démarré), `pg_prove` dans le PATH, toutes les `DATABASE_URL_*` posées
vers la base de travail (voir `apps/api/test/support/db.ts`).

## 1. Base

```bash
npm run reset-db -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql      # dont tests_refund_requests.sql
```

## 2. API

```bash
cd apps/api
SKIP_LATENCY=1 npx jest test/integration/refunds test/integration/media/release-chaining.spec.ts --runInBand
npx jest test/integration/refunds/refund-latency.spec.ts --runInBand   # NFR-004, suite isolée
```

## 3. Parcours manuel (API locale, données de démo)

1. Code à usage unique : `POST /v1/customer-auth/otp` (`operator_code: demo-a`), puis `POST /v1/customer-auth/token`
   (code lu dans `X-Test-Otp-Code`).
2. `GET /v1/me/wallets` : `refund.eligible = true` pendant la fenêtre, avec une règle de frais configurée.
3. `POST /v1/me/refund-requests` (`Idempotency-Key`, destination Wave vers le numéro vérifié) : `201`, `REQUESTED`.
4. Back-office : `POST /v1/refund-requests/{id}/approve` par une personne (`202`), puis
   `POST /v1/approval-requests/{approval_id}/approve` par une seconde : demande `PROCESSING`, solde payé à 0.
5. `POST /v1/refund-requests/{id}/confirm` avec `PAID` et une référence : `PAID`. Autre essai avec `FAILED` : le solde
   payé revient.
6. Autre numéro : code demandé pour ce numéro, joint en `new_number_otp` : `AWAITING_HOLDER` ; le titulaire décide par
   `POST /v1/refund-requests/{id}/holder-decision`.

## 4. Guichet de retour

`POST /v1/media/{id}/release` depuis un terminal enrôlé avec session de caisse ouverte, `settle_balance: {method: CASH}`
et, au-delà de `cash_refund_single_max`, `X-Approval-Token` d'un superviseur : bracelet `RELEASED`, `cash_to_hand_back`
= caution + solde payé + espèces dues.
