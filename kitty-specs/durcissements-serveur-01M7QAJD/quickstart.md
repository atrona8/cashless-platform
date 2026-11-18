# Quickstart: prouver les levées de la mission 11a

Base de test locale : voir `tools/dev-db/env.sh` (Docker). Lancer les tests en série (base partagée).

```bash
source tools/dev-db/env.sh
npm run reset-db -w @cashless/ledger-sql          # base recréée par les migrations, 0090 et suivantes comprises
npm run test:pgtap -w @cashless/ledger-sql         # droits, contraintes, gardes, tests de borne inversés
cd apps/api && SKIP_LATENCY=1 npx jest              # parcours inchangés et refus depuis cashless_app
npx jest test/integration/vendors/vendor-pin-latency.spec.ts   # NFR-001, seule
cd ../../tools/edge-admin && npx jest                # OP-N116
node tools/contract-stability/check.mjs              # contrat inchangé : 0 refus, 71 admises
```

## Ce que chaque point doit montrer

| Point | Preuve de levée | Mutation qui doit faire échouer la preuve |
|---|---|---|
| OP-N60 | `INSERT`/`UPDATE` directs sur `media_batch` et `UPDATE (status)` de `media` refusés depuis `cashless_app` (42501) | `GRANT UPDATE ON media_batch TO cashless_app` |
| OP-N79 | attribution à un autre vendeur que celui de la session : 23503 | retrait de la clé étrangère composite |
| OP-N76 | `cashless_app` n'exécute plus les deux fonctions ; PIN ouvert seulement par `vendor-pin` ; processus arrêté : refus | `GRANT EXECUTE … TO cashless_app` ; client sans signature accepté |
| OP-N145 | `INSERT` en `PAID` ou `CANCELLED` refusé depuis `cashless_app` | `GRANT INSERT (status, …)` ; déclencheur désactivé |
| OP-N137 | mauvais rôle : `403`, demande `PENDING` ; rejeu de `confirm` audité ; auto-approbation `409 APPROVAL_INVALID` | crochet `guardDecision` retiré |
| OP-N141 | écart `brut + 1` refusé, `brut` accepté | plafond retiré |
| OP-N140 | IBAN masqué au journal ; si décision 1 : aucun IBAN en clair en base, CSV exact | champ `iban` retiré du masque ; `CHECK` retiré |
| OP-N116 | fichier d'enrôlement porte le grand livre de l'événement ; `--ledger` refusé | grand livre non rendu |
| OP-N64 | si décision 3 : keyId gardé ; assertion valide acceptée ; rejouée ou d'une autre clé refusée | comparaison du compteur en `<=` |
