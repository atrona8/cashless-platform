# Quickstart: Encaissement en ligne

Prérequis : base locale (`tools/dev-db`, PostgreSQL 17 sur `127.0.0.1:5433`), `npm ci` (avec `ignore-scripts=true`),
`npm run reset-db -w @cashless/ledger-sql`.

## Vérifier

```bash
npm run lint && npm run typecheck && npm run format:check
npm run check:generated -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql          # dont tests_vendors, tests_catalog, tests_payments,
                                                     # tests_payment_requests, tests_enrollment_event_state
npm run reset-db -w @cashless/ledger-sql
(cd apps/api && SKIP_LATENCY=1 npx jest)            # tests en série, base partagée
(cd apps/api && npx jest test/integration/end-to-end/payment-latency.spec.ts)   # NFR-001, seule
```

## Parcours de démonstration (tests d'intégration)

1. `MERCHANT_ADMIN` crée un vendeur (PIN de 6 chiffres) ; `ORGANIZER_ADMIN` crée le catalogue d'un point de vente.
2. Terminal de test `CATALOG_POS` enrôlé (5a) ; `GET /device/config` sert `catalog.version`.
3. `POST /vendor-sessions` avec le PIN → `vendor_session_id`.
4. `POST /payments` avec la lecture embarquée, les lignes et `vendor_session_id` → `201`, vente attribuée au vendeur.
5. `POST /payments/{id}/reversal` par le même vendeur dans la fenêtre → `201` ; une seconde fois → `409 ALREADY_REVERSED`.
6. `POST /payment-requests` (terminal), puis `POST /payment-requests/{id}/pay` (festivalier, faux en test) → vente.
7. `POST /me/customer-qr-tokens` (festivalier), puis `POST /payments` avec `customer_qr_token` → vente.

## Production

`VENDOR_PIN_SECRET` obligatoire (32 octets au moins, distinct des autres secrets) ; le côté festivalier du QR attend
l'identité réelle du festivalier (mission 10).
