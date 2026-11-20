# Quickstart — vérifier la mission 10a

Base de test locale (`127.0.0.1:5433`, `cashless_test`), voir la mémoire du poste.

```bash
npm run reset-db -w @cashless/ledger-sql
npm run test:pgtap -w @cashless/ledger-sql          # fonctions KYC, version du secret, droits, bornes
cd apps/api && SKIP_LATENCY=1 npx jest --runInBand \
  test/integration/kyc test/integration/media/claim-rotation.spec.ts \
  test/integration/customer-app test/integration/customer-auth
cd ../.. && node tools/contract-stability/check.mjs  # 0 refusée (colonne printed_number inscrite)
npm run lint && npm run typecheck
```

Parcours à la main (API locale) :
1. Créer un compte festivalier (`/customer-auth/otp` puis `/token`), rattacher un bracelet.
2. Identifier au guichet (`POST /kyc-verifications`) avec un caissier dont le téléphone diffère : `201`.
3. Même chose avec un caissier au même numéro : `403`.
4. Rotation : changer `CLAIM_CODE_HMAC_KEY`, `CLAIM_CODE_HMAC_KEY_VERSION=2`, redémarrer ; un ancien code est refusé ;
   `reissue-claim-codes --batch …` produit le nouveau fichier ; un nouveau code rattache.
5. `GET /me/media` montre `printed_number` après un import à trois colonnes.
