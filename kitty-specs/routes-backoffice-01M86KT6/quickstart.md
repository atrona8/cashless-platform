# Recette — mission 11b

Base par lot : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wpXX` ; Jest depuis `apps/api` après
`source ../../tools/dev-db/env.sh`, `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`.

1. **Profil** : une personne `ORGANIZER_ADMIN` sur O1 et `MERCHANT_ADMIN` sur M1 appelle `GET /v1/staff/me` → exactement
   ces deux attributions. Un jeton festivalier → refus.
2. **Ventes** : événement de 120 ventes (2 points de vente, 2 commerçants, 2 vendeurs, 1 annulée) ; chaque filtre rend
   le bon sous-ensemble ; la pagination à `limit=7` parcourt les 120 sans doublon ; `GET /v1/sales/{id}` rend les lignes ;
   la vente annulée porte `status = REVERSED` et la référence de l'annulation ; `MERCHANT_ADMIN` ne voit que les siennes ;
   un autre prestataire reçoit 404.
3. **Anomalies** : `CASH_DIFF` classée avec motif → `RESOLVED`, audit `ANOMALY_CLASSIFIED`, aucune ligne nouvelle dans
   `journal_transaction` ; `OFFLINE_SHORTFALL` → 422 `ANOMALY_KIND_NOT_CLASSIFIABLE` ; deuxième classement → 409 ;
   `UPDATE anomaly` direct par `cashless_app` → refusé (pgTAP).
4. **Recherche** : bracelet par UID et par code imprimé → même résultat ; `POST /v1/search/customers` numéro exact → deux
   portefeuilles, numéro masqué ; préfixe → vide ; `CASHIER` → 403 ; 21e recherche dans la minute → 429 ; l'audit ne
   contient pas le numéro (test sur le JSON des lignes).
5. **Modèles** : `PUT /v1/phone-models/samsung/galaxy a15` niveau `TOLERATED` → la fiche d'un terminal de ce modèle montre
   `TOLERATED` ; un terminal sans modèle → `UNTESTED` ; l'enrôlement d'un modèle absent passe.
6. **x-roles** : `node tools/contract-stability/check.mjs` → 0 refus ; la matrice échantillon passe ; retirer un rôle
   d'un contrôle du serveur fait échouer la matrice.
7. **Transverse** : `architecture.spec.ts`, `production-guard.spec.ts`, `test/unit/contracts`,
   `invariants-cloture/consignation.spec.ts`, `device-auth-matrix.spec.ts` (enrôlement et signal de vie modifiés),
   pgTAP `tests_execute_grants.sql`.
