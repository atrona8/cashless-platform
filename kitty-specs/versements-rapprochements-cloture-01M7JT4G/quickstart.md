# Quickstart: vérifier la mission 9b en local

Prérequis : base Docker `cashless-platform-pg17` (127.0.0.1:5433) démarrée. Toujours charger l'environnement dans le
même appel : `source tools/dev-db/env.sh`.

```bash
# 1. Base recréée avec les migrations 0083+ et post-roles.sql
source tools/dev-db/env.sh && npm run reset-db -w @cashless/ledger-sql

# 2. Gardes et droits (pgTAP)
docs/passation-9a/scripts/bin/pg_prove packages/ledger-sql/tests/tests_closing_conditions.sql \
  packages/ledger-sql/tests/tests_payouts.sql packages/ledger-sql/tests/tests_statements.sql \
  packages/ledger-sql/tests/tests_refund_transitions.sql packages/ledger-sql/tests/tests_ops_functions.sql \
  packages/ledger-sql/tests/tests_account_mapping.sql

# 3. Contrat : aucune opération existante modifiée, types à jour
npm run check -w @cashless/contracts

# 4. Scénario de référence de bout en bout : CLOSING → CLOSED → LOCKED par les routes
cd apps/api && source ../../tools/dev-db/env.sh && npx jest test/scenario/closing-journey.spec.ts --runInBand

# 5. Processus de maintenance, un passage : scellement, copie simulée, contrôles ; code de sortie = alarme
source ../../tools/dev-db/env.sh && npx ts-node src/main.maintenance.ts --once; echo "alarme=$?"
```

Parcours manuel, sur un événement du scénario de référence en `SETTLING` :

1. `GET …/closing-steps` : les sept étapes, les trois premières « à faire ».
2. `GET …/closing-steps/PITCH_FEES/preview` : 25 000 (Food 15 000, Tee 10 000), rien n'est écrit.
3. `POST …/closing-steps/PITCH_FEES` deux fois avec deux clés différentes : une seule écriture.
4. `GET /ledgers/{id}/payout-entitlements`, puis `POST …/payout-batches/approval-requests` par une personne, puis
   approbation par une autre : `PAYOUT_INITIATED`, lignes `payout`.
5. Ligne de 40 000 pour un droit net de 39 225 : `409 PAYOUT_EXCEEDS_ENTITLEMENT`.
6. Import d'un relevé CSV `A-PSP-WAVE` (`external_ref;value_date;amount;currency`) : lignes rapprochées par
   `provider_payment_ref` ; `GET /ledgers/{id}/reconciliation`.

Exemple de correspondance comptable (indicative, OP-N3 non validé, jamais livrée comme définitive) : voir
SPECIFICATION §12.3 ; la saisir par `POST /operators/{id}/account-mappings`.
