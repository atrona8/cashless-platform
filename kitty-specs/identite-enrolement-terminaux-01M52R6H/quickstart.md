# Quickstart — mission identite-enrolement-terminaux-01M52R6H

## Préparer

```bash
source tools/dev-db/env.sh          # base locale (Docker), rôles, clés de test (IDEMPOTENCY_HMAC_KEY, ENROLLMENT_CODE_HMAC_KEY)
npm ci                              # ignore-scripts=true (.npmrc)
npm run -w @cashless/ledger-sql reset-db     # migrations 0001 à 0025, roles.sql puis post-roles.sql
```

## Vérifier

```bash
npm run -w @cashless/ledger-sql test:pgtap         # suites en base, dont les bornes inversées (après reset-db)
npm run -w @cashless/ledger-sql check:generated    # suite de référence régénérée par gen_tests.py, sans écart
npm run generate                                   # types du contrat
npm test -w @cashless/api -- --runInBand           # en série : base partagée
```

## Parcours à la main (terminal de test)

1. Créer un code : `POST /v1/device-enrollment-codes` (jeton d'un `ORGANIZER_ADMIN` du faux serveur d'identité).
2. Enrôler : `apps/api/test/support/test-terminal.ts` génère clés, défi, attestation de test et CSR, puis appelle
   `POST /v1/device-enrollments`.
3. Appeler `GET /v1/device/config` en HTTPS avec le certificat reçu, le jeton et une requête signée.
4. Révoquer depuis le back-office, puis refaire l'appel : `403 DEVICE_REVOKED`.

## Production

La garde refuse de démarrer tant qu'un faux est branché (KMS, autorité des terminaux, signataire des jetons,
attestation, identité du terminal ou du festivalier) : l'adaptateur réel arrive avec OP-N11.
